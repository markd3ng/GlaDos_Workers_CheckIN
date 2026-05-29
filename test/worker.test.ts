import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

type JsonBody = {
  notifications?: unknown;
  results?: Array<{ accountStatus?: { leftDays?: string } }>;
};

const env = {
  GLADOS_ACCOUNTS: JSON.stringify([{ name: "main", cookie: "cookie=value" }]),
  CHECKIN_CONCURRENCY: "1",
  CHECKIN_RETRIES: "1",
  ENABLE_MANUAL_ENDPOINTS: "true",
  ADMIN_TOKEN: "secret"
};

describe("worker routes", () => {
  it("returns health JSON", async () => {
    const response = await worker.fetch(new Request("https://worker.test/health"), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, service: "glados-workers" });
  });

  it("renders an index page with log and manual trigger endpoints", async () => {
    const response = await worker.fetch(new Request("https://worker.test/"), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain("/log");
    expect(html).toContain("/trigger-checkin");
    expect(html).toContain("/status");
  });

  it("requires admin token when configured", async () => {
    const denied = await worker.fetch(new Request("https://worker.test/status"), env);
    const allowed = await worker.fetch(new Request("https://worker.test/status?token=secret"), env);

    expect(denied.status).toBe(401);
    expect(allowed.status).not.toBe(401);
  });

  it("keeps manual endpoints disabled by default", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/status"),
      {
        CHECKIN_CONCURRENCY: "1",
        CHECKIN_RETRIES: "1"
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Manual endpoints disabled" });
  });

  it("renders the D1 checkin log table when enabled and authorized", async () => {
    const response = await worker.fetch(new Request("https://worker.test/log?token=secret&year=2026&month=05"), {
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

    const response = await worker.fetch(new Request("https://worker.test/status?token=secret"), env);
    const body = (await response.json()) as JsonBody;

    expect(response.status).toBe(200);
    expect(body.results?.[0]?.accountStatus?.leftDays).toBe("30");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://glados.rocks/api/user/status");
  });

  it("runs checkin without notification on /checkin and /trigger-checkin, and with notification on /run", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const checkin = await worker.fetch(new Request("https://worker.test/checkin?token=secret", { method: "POST" }), env);
    const trigger = await worker.fetch(
      new Request("https://worker.test/trigger-checkin?token=secret", { method: "POST" }),
      env
    );
    const run = await worker.fetch(
      new Request("https://worker.test/run?token=secret", { method: "POST" }),
      { ...env, FEISHU_WEBHOOK: "https://example.invalid/feishu" }
    );

    expect(checkin.status).toBe(200);
    expect(((await checkin.json()) as JsonBody).notifications).toEqual([]);
    expect(trigger.status).toBe(200);
    expect(((await trigger.json()) as JsonBody).notifications).toEqual([]);
    expect(run.status).toBe(200);
    expect(((await run.json()) as JsonBody).notifications).toEqual([{ channel: "feishu", ok: true }]);
    expect(fetcher).toHaveBeenCalledTimes(7);
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
