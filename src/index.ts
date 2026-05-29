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

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "glados-workers" });
  }

  if (request.method === "GET" && url.pathname === "/") {
    const auth = await requireAdmin(request, env);
    if (auth) {
      return auth;
    }
    return html(renderIndexPage());
  }

  if (!["/status", "/checkin", "/test", "/run", "/log"].includes(url.pathname)) {
    return json({ ok: false, error: "Not found" }, 404);
  }

  const auth = await requireAdmin(request, env);
  if (auth) {
    return auth;
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

  if (url.pathname === "/test" && request.method === "POST") {
    return json(await executeRun(env, "manual", true));
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
    notifications: [],
    notificationSummary: {
      configured: config.notifications.length,
      attempted: 0,
      succeeded: 0,
      failed: 0
    }
  };

  await recordSuccessfulCheckins(env.CHECKIN_DB, results, trigger, report.startedAt);

  if (notify) {
    report.notifications = await sendEnabledNotifications(report, { channels: config.notifications });
    report.notificationSummary = summarizeNotifications(config.notifications.length, report.notifications);
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

function summarizeNotifications(configured: number, notifications: RunReport["notifications"]): RunReport["notificationSummary"] {
  return {
    configured,
    attempted: notifications.length,
    succeeded: notifications.filter((notification) => notification.ok).length,
    failed: notifications.filter((notification) => !notification.ok).length
  };
}

async function statusOnlyFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.endsWith("/api/user/checkin")) {
    return new Response(JSON.stringify({ code: 0, message: "Status only" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  return fetch(input, init);
}

async function requireAdmin(request: Request, env: EnvLike): Promise<Response | undefined> {
  const expectedUser = getEnvString(env, "ADMIN_USER")?.trim() || "admin";
  const expectedToken = getEnvString(env, "ADMIN_TOKEN")?.trim();
  if (!expectedToken) {
    return json({ ok: false, error: "ADMIN_TOKEN is required" }, 404);
  }

  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Basic ")) {
    const credentials = parseBasicCredentials(authorization);
    if (
      credentials &&
      (await timingSafeEqual(credentials.username, expectedUser)) &&
      (await timingSafeEqual(credentials.password, expectedToken))
    ) {
      return undefined;
    }
  }

  if (authorization?.startsWith("Bearer ")) {
    const provided = authorization.slice("Bearer ".length);
    if (await timingSafeEqual(provided, expectedToken)) {
      return undefined;
    }
  }

  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="GLaDOS Workers Check-In", charset="UTF-8"',
      "Content-Type": "text/plain;charset=UTF-8"
    }
  });
}

function parseBasicCredentials(authorization: string): { username: string; password: string } | undefined {
  try {
    const decoded = atob(authorization.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return undefined;
    }
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return undefined;
  }
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

function renderIndexPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GLaDOS Workers Check-In</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;color:#172033;background:#f7f8fb}
main{max-width:880px;margin:0 auto}
h1{font-size:24px;margin:0 0 8px}
p{line-height:1.6}
table{width:100%;border-collapse:collapse;background:#fff;margin-top:16px}
th,td{border:1px solid #d8deea;padding:10px;text-align:left;vertical-align:top}
th{background:#eef2f8}
code{background:#edf1f7;padding:2px 5px;border-radius:4px}
</style>
</head>
<body>
<main>
<h1>GLaDOS Workers Check-In</h1>
<p>定时签到由 Cloudflare Cron 自动执行。页面和手动端点使用 Basic Auth 保护；用户名来自 <code>ADMIN_USER</code>，密码来自 <code>ADMIN_TOKEN</code>。</p>
<section>
<h2>操作</h2>
<form method="get" action="/status"><button type="submit">查询状态</button></form>
<form method="post" action="/test"><button type="submit">测试签到、Cookie 和通知</button></form>
<form method="post" action="/checkin"><button type="submit">手动签到，不通知</button></form>
<form method="post" action="/run"><button type="submit">手动签到并通知</button></form>
<form method="get" action="/log"><button type="submit">查看日志</button></form>
</section>
<table>
<thead><tr><th>端点</th><th>作用</th><th>调用方式</th></tr></thead>
<tbody>
<tr><td><a href="/health">/health</a></td><td>健康检查。</td><td><code>GET /health</code></td></tr>
<tr><td>/status</td><td>只查询账号状态，用来检查 Cookie 当前是否有效和剩余天数。</td><td><code>GET /status</code></td></tr>
<tr><td>/test</td><td>一次性测试签到、Cookie 有效性、通知渠道数量和推送效果。</td><td><code>POST /test</code></td></tr>
<tr><td>/checkin</td><td>手动触发一次签到，不发送通知，除非加 <code>?notify=true</code>。</td><td><code>POST /checkin</code></td></tr>
<tr><td>/run</td><td>手动执行完整签到并发送已启用的通知。</td><td><code>POST /run</code></td></tr>
<tr><td><a href="/log">/log</a></td><td>查看 D1 签到日志。支持 <code>year</code> 和 <code>month</code> 筛选。</td><td><code>GET /log?year=2026&amp;month=05</code></td></tr>
</tbody>
</table>
</main>
</body>
</html>`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "Unknown error";
}
