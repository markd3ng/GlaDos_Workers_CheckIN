import { describe, expect, it, vi } from "vitest";
import {
  buildGladosHeaders,
  checkAccountStatus,
  classifyCheckinResponse,
  extractPoints,
  performAccountRun,
  runAccounts
} from "../src/glados";
import type { AccountConfig } from "../src/types";

const account: AccountConfig = { name: "main", cookie: "koa:sess=abc; koa:sess.sig=def" };

describe("buildGladosHeaders", () => {
  it("uses browser-like headers with the account cookie and no fake authorization", () => {
    const headers = buildGladosHeaders(account.cookie);

    expect(headers["User-Agent"]).toContain("Chrome");
    expect(headers["Accept"]).toBe("application/json, text/plain, */*");
    expect(headers["Accept-Language"]).toBe("zh-CN,zh;q=0.9,en;q=0.8");
    expect(headers["Content-Type"]).toBe("application/json;charset=UTF-8");
    expect(headers["Origin"]).toBe("https://glados.rocks");
    expect(headers["Referer"]).toBe("https://glados.rocks/console/checkin");
    expect(headers["Cookie"]).toBe(account.cookie);
    expect(headers).not.toHaveProperty("Authorization");
  });
});

describe("classifyCheckinResponse", () => {
  it("classifies success, repeat, expired, and unknown responses", () => {
    expect(classifyCheckinResponse(200, { code: 0, message: "Checkin! Got 1 Points" })).toMatchObject({
      status: "success"
    });
    expect(classifyCheckinResponse(200, { code: 1, message: "Checkin Repeats! Please Try Tomorrow" })).toMatchObject({
      status: "already_checked_in"
    });
    expect(classifyCheckinResponse(403, { message: "Forbidden" })).toMatchObject({ status: "expired" });
    expect(classifyCheckinResponse(200, { message: "Please login first" })).toMatchObject({ status: "expired" });
    expect(classifyCheckinResponse(200, { message: "Something else" })).toMatchObject({ status: "failed" });
  });
});

describe("extractPoints", () => {
  it("extracts earned points from GLaDOS messages", () => {
    expect(extractPoints("Checkin! Got 2 Points")).toBe(2);
    expect(extractPoints("Checkin! Got 10.5 Points")).toBe(10.5);
    expect(extractPoints("Checkin Repeats! Please Try Tomorrow")).toBe(0);
  });
});

describe("GLaDOS account operations", () => {
  it("queries remaining days and account points from status responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "12.3400" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { points: "88.5000" } }));

    const status = await checkAccountStatus(account, fetcher);

    expect(status?.leftDays).toBe("12.34");
    expect(status?.points).toBe("88.5");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://glados.rocks/api/user/status",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Cookie: account.cookie }) })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://glados.rocks/api/user/points",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Cookie: account.cookie }) })
    );
  });

  it("retries transient checkin failures and then returns success", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "server down" }, 500))
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "20" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { points: 100 } }));

    const result = await performAccountRun(account, { retries: 2, fetcher, sleep: async () => undefined });

    expect(result.checkin.status).toBe("success");
    expect(result.checkin.earnedPoints).toBe(1);
    expect(result.accountStatus?.leftDays).toBe("20");
    expect(result.accountStatus?.points).toBe("100");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not retry expired cookies", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ message: "Forbidden" }, 403));

    const result = await performAccountRun(account, { retries: 3, fetcher, sleep: async () => undefined });

    expect(result.checkin.status).toBe("expired");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("isolates failures across multiple accounts", async () => {
    const accounts: AccountConfig[] = [
      { name: "ok", cookie: "ok-cookie" },
      { name: "expired", cookie: "expired-cookie" }
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, message: "Checkin! Got 1 Points" }))
      .mockResolvedValueOnce(jsonResponse({ data: { leftDays: "10" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { points: 9 } }))
      .mockResolvedValueOnce(jsonResponse({ message: "Please login first" }));

    const results = await runAccounts(accounts, { concurrency: 1, retries: 1, fetcher, sleep: async () => undefined });

    expect(results.map((result) => result.checkin.status)).toEqual(["success", "expired"]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
