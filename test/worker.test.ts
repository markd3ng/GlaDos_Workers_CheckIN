import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

type JsonBody = {
  notifications?: unknown;
  notificationSummary?: {
    configured: number;
    attempted: number;
    succeeded: number;
    failed: number;
  };
  results?: Array<{ accountStatus?: { leftDays?: string } }>;
};

const env = {
  GLADOS_ACCOUNTS: JSON.stringify([{ name: "main", cookie: "cookie=value" }]),
  CHECKIN_CONCURRENCY: "1",
  CHECKIN_RETRIES: "1",
  ADMIN_USER: "admin",
  ADMIN_TOKEN: "secret"
};

const basicAuth = `Basic ${btoa("admin:secret")}`;

describe("worker routes", () => {
  it("returns health JSON", async () => {
    const response = await worker.fetch(new Request("https://worker.test/health"), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, service: "glados-workers" });
  });

  it("renders an index page with log and test endpoints", async () => {
    const response = await worker.fetch(new Request("https://worker.test/", { headers: { Authorization: basicAuth } }), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain("/log");
    expect(html).toContain("/test");
    expect(html).toContain('data-action="/test"');
    expect(html).toContain('id="result-body"');
    expect(html).toContain("fetch(action");
    expect(html).toContain("renderRunReport");
    expect(html).toContain("账号结果");
    expect(html).toContain("通知结果");
    expect(html).toContain("max-width:1760px");
    expect(html).toContain("grid-template-columns:minmax(240px,320px) minmax(0,1fr)");
    expect(html).toContain("min-height:520px");
    expect(html).toContain("account-cell");
    expect(html).toContain("message-cell");
    expect(html).toContain('class="endpoint-link" data-method="GET" data-action="/health"');
    expect(html).toContain('class="endpoint-link" data-method="GET" data-action="/status"');
    expect(html).toContain('class="endpoint-link" data-method="POST" data-action="/test"');
    expect(html).toContain('class="endpoint-link" data-method="POST" data-action="/checkin"');
    expect(html).toContain('class="endpoint-link" data-method="POST" data-action="/run"');
    expect(html).toContain('class="endpoint-link" data-method="GET" data-action="/log"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("/trigger-checkin");
    expect(html).toContain("/status");
  });

  it("requires Basic Auth when admin token is configured", async () => {
    const denied = await worker.fetch(new Request("https://worker.test/status"), env);
    const allowed = await worker.fetch(new Request("https://worker.test/status", { headers: { Authorization: basicAuth } }), env);

    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(allowed.status).not.toBe(401);
  });

  it("disables manual endpoints when admin token is missing", async () => {
    const response = await worker.fetch(new Request("https://worker.test/status"), {
      CHECKIN_CONCURRENCY: "1",
      CHECKIN_RETRIES: "1"
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "ADMIN_TOKEN is required" });
  });

  it("renders the D1 checkin log table when enabled and authorized", async () => {
    const response = await worker.fetch(new Request("https://worker.test/log?year=2026&month=05", { headers: { Authorization: basicAuth } }), {
      ...env,
      CHECKIN_DB: createMockDb([
        {
          id: 1,
          account_name: "main",
          checked_at: "2026-05-28T08:00:00.000Z",
          status: "success",
          message: "Checkin! Got 2 Points",
          points: 2,
          left_days: "12",
          trigger: "scheduled"
        }
      ])
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain("累计 Point");
  });

  it("queries status without calling the checkin endpoint", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: { leftDays: "30" } }));

    const response = await worker.fetch(new Request("https://worker.test/status", { headers: { Authorization: basicAuth } }), env);
    const body = (await response.json()) as JsonBody;

    expect(response.status).toBe(200);
    expect(body.results?.[0]?.accountStatus?.leftDays).toBe("30");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://glados.rocks/api/user/status");
  });

  it("runs checkin without notification on /checkin, tests configured notifications on /test, and notifies on /run", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 500))
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const checkin = await worker.fetch(
      new Request("https://worker.test/checkin", { method: "POST", headers: { Authorization: basicAuth } }),
      env
    );
    const test = await worker.fetch(
      new Request("https://worker.test/test", { method: "POST", headers: { Authorization: basicAuth } }),
      {
        ...env,
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_CHAT_ID: "chat",
        FEISHU_WEBHOOK: "https://example.invalid/feishu"
      }
    );
    const run = await worker.fetch(
      new Request("https://worker.test/run", { method: "POST", headers: { Authorization: basicAuth } }),
      { ...env, FEISHU_WEBHOOK: "https://example.invalid/feishu" }
    );

    expect(checkin.status).toBe(200);
    expect(((await checkin.json()) as JsonBody).notifications).toEqual([]);
    expect(test.status).toBe(200);
    const testBody = (await test.json()) as JsonBody;
    expect(testBody.notifications).toEqual([
      { channel: "telegram", ok: true },
      { channel: "feishu", ok: false, error: "HTTP 500" }
    ]);
    expect(testBody.notificationSummary).toEqual({ configured: 2, attempted: 2, succeeded: 1, failed: 1 });
    expect(testBody.results?.[0]?.accountStatus?.leftDays).toBe("10");
    expect(run.status).toBe(200);
    expect(((await run.json()) as JsonBody).notifications).toEqual([{ channel: "feishu", ok: true }]);
    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  it("returns 404 JSON for unknown routes", async () => {
    const response = await worker.fetch(new Request("https://worker.test/missing"), env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Not found" });
  });

  it("scheduled handler executes the run flow", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }));

    await worker.scheduled({ cron: "0 0 * * *", scheduledTime: Date.now(), type: "scheduled" }, env, {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {}
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createMockDb(rows: Record<string, unknown>[] = []) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({ results: rows }),
        run: vi.fn().mockResolvedValue({ success: true })
      }))
    }))
  };
}
