import { parseConfig } from "./config";
import { runAccounts, summarizeResults } from "./glados";
import { sendEnabledNotifications } from "./notify";
import { buildLogHtml, listCheckinLogs, recordSuccessfulCheckins } from "./storage";
import type { EnvLike, RunReport } from "./types";

type ExecutionContextLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
  props?: Record<string, unknown>;
};

const worker = {
  async fetch(request: Request, env: EnvLike): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json({ ok: false, error: safeError(error) }, 500);
    }
  },

  async scheduled(_controller: unknown, env: EnvLike, _ctx: ExecutionContextLike): Promise<void> {
    try {
      await executeRun(env, "scheduled", true);
    } catch (error) {
      console.error(JSON.stringify({ event: "scheduled_failed", error: safeError(error) }));
    }
  }
};

export default worker;

async function handleRequest(request: Request, env: EnvLike): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return json({
      ok: true,
      service: "glados-workers",
      endpoints: ["GET /health", "GET /status", "POST /checkin", "POST /run"]
    });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "glados-workers" });
  }

  if (!["/status", "/checkin", "/run", "/log"].includes(url.pathname)) {
    return json({ ok: false, error: "Not found" }, 404);
  }

  if (getEnvString(env, "ENABLE_MANUAL_ENDPOINTS")?.toLowerCase() !== "true") {
    return json({ ok: false, error: "Manual endpoints disabled" }, 404);
  }

  if (!(await isAuthorized(request, env))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (url.pathname === "/log" && request.method === "GET") {
    if (!env.CHECKIN_DB) {
      return json({ ok: false, error: "CHECKIN_DB binding is required" }, 500);
    }
    const logs = await listCheckinLogs(env.CHECKIN_DB, {
      year: url.searchParams.get("year"),
      month: url.searchParams.get("month")
    });
    return html(buildLogHtml(logs));
  }

  if (url.pathname === "/status" && request.method === "GET") {
    return json(await executeRun(env, "manual", getEnvString(env, "NOTIFY_ON_STATUS_ONLY")?.toLowerCase() === "true", true));
  }

  if (url.pathname === "/checkin" && request.method === "POST") {
    const shouldNotify = url.searchParams.get("notify") === "true";
    return json(await executeRun(env, "manual", shouldNotify));
  }

  if (url.pathname === "/run" && request.method === "POST") {
    return json(await executeRun(env, "manual", true));
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

async function executeRun(
  env: EnvLike,
  trigger: RunReport["trigger"],
  notify: boolean,
  statusOnly = false
): Promise<RunReport> {
  const config = parseConfig(env);
  const results = statusOnly
    ? await runAccounts(config.accounts, {
        concurrency: config.checkinConcurrency,
        retries: config.checkinRetries,
        fetcher: statusOnlyFetcher,
        sleep: async () => undefined
      })
    : await runAccounts(config.accounts, {
        concurrency: config.checkinConcurrency,
        retries: config.checkinRetries
      });

  const report: RunReport = {
    ok: results.every((result) => result.checkin.status !== "failed" && result.checkin.status !== "expired"),
    trigger,
    startedAt: new Date().toISOString(),
    summary: summarizeResults(results),
    results,
    notifications: []
  };

  await recordSuccessfulCheckins(env.CHECKIN_DB, results, trigger, report.startedAt);

  if (notify) {
    report.notifications = await sendEnabledNotifications(report, { channels: config.notifications });
  }

  console.log(
    JSON.stringify({
      event: "glados_run_completed",
      trigger,
      summary: report.summary,
      notifications: report.notifications
    })
  );

  return report;
}

async function statusOnlyFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.endsWith("/api/user/checkin")) {
    return new Response(JSON.stringify({ code: 0, message: "Status only" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  return fetch(input, init);
}

async function isAuthorized(request: Request, env: EnvLike): Promise<boolean> {
  const expected = getEnvString(env, "ADMIN_TOKEN")?.trim();
  if (!expected) {
    return true;
  }
  const url = new URL(request.url);
  const authorization = request.headers.get("Authorization");
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : url.searchParams.get("token");
  return timingSafeEqual(provided ?? "", expected);
}

function getEnvString(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" ? value : undefined;
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const leftDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(left)));
  const rightDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(right)));
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < leftDigest.length; index += 1) {
    diff |= (leftDigest[index] ?? 0) ^ (rightDigest[index] ?? 0);
  }
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8" }
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html;charset=UTF-8" }
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "Unknown error";
}
