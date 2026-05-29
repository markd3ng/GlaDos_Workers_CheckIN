import { describe, expect, it, vi } from "vitest";
import { createDingTalkUrl, createFeishuPayload, sendEnabledNotifications } from "../src/notify";
import { formatPlainReport } from "../src/format";
import type { RunReport } from "../src/types";

const report: RunReport = {
  ok: true,
  trigger: "manual",
  startedAt: "2026-05-28T00:00:00.000Z",
  summary: { total: 1, ok: 1, failed: 0, expired: 0 },
  results: [
    {
      accountName: "main",
      checkin: { status: "success", message: "Checkin! Got 1 Points" },
      accountStatus: { leftDays: "12.34" }
    }
  ],
  notifications: []
};

describe("notification helpers", () => {
  it("formats a readable Chinese plain-text report", () => {
    const text = formatPlainReport(report);

    expect(text).toContain("GLaDOS 签到报告");
    expect(text).toContain("成功/已签到：1");
    expect(text).toContain("main：成功");
    expect(text).toContain("剩余 12.34 天");
  });

  it("creates signed DingTalk URLs", async () => {
    const url = await createDingTalkUrl("https://example.invalid/robot?access_token=token", "secret", 1000);

    expect(url).toContain("timestamp=1000");
    expect(url).toContain("sign=");
  });

  it("creates signed Feishu payloads", async () => {
    const payload = await createFeishuPayload("hello", "secret", 1000);

    expect(payload).toMatchObject({
      timestamp: "1000",
      msg_type: "text",
      content: { text: "hello" }
    });
    expect(typeof payload.sign).toBe("string");
  });

  it("skips incomplete channels and reports notification failures safely", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("bad", { status: 500 }));
    const results = await sendEnabledNotifications(report, {
      channels: [
        { channel: "telegram", botToken: "token", chatId: "chat" },
        { channel: "dingtalk", webhook: "" }
      ],
      fetcher
    });

    expect(results).toEqual([{ channel: "telegram", ok: false, error: "HTTP 500" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
