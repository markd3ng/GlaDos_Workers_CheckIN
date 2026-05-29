import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("parses cookie-only account configuration and defaults", () => {
    const config = parseConfig({
      GLADOS_ACCOUNTS: JSON.stringify([{ name: "main", cookie: "koa:sess=abc; koa:sess.sig=def" }])
    });

    expect(config.accounts).toEqual([{ name: "main", cookie: "koa:sess=abc; koa:sess.sig=def" }]);
    expect(config.checkinConcurrency).toBe(2);
    expect(config.checkinRetries).toBe(3);
    expect(config.notifyOnStatusOnly).toBe(false);
    expect(config.adminUser).toBe("admin");
  });

  it("rejects missing, malformed, empty, and password-style account configuration", () => {
    expect(() => parseConfig({})).toThrow("GLADOS_ACCOUNTS is required");
    expect(() => parseConfig({ GLADOS_ACCOUNTS: "not-json" })).toThrow("GLADOS_ACCOUNTS must be a JSON array");
    expect(() => parseConfig({ GLADOS_ACCOUNTS: "[]" })).toThrow("GLADOS_ACCOUNTS must contain at least one account");
    expect(() =>
      parseConfig({ GLADOS_ACCOUNTS: JSON.stringify([{ name: "main", email: "user@example.com", password: "secret" }]) })
    ).toThrow("Account main must include a cookie");
  });

  it("detects enabled notification channels and numeric overrides", () => {
    const config = parseConfig({
      GLADOS_ACCOUNTS: JSON.stringify([{ name: "main", cookie: "cookie=value" }]),
      CHECKIN_CONCURRENCY: "5",
      CHECKIN_RETRIES: "4",
      ADMIN_USER: "owner",
      NOTIFY_ON_STATUS_ONLY: "true",
      DINGTALK_WEBHOOK: "https://example.invalid/dingtalk",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_CHAT_ID: "123",
      FEISHU_WEBHOOK: "https://example.invalid/feishu"
    });

    expect(config.checkinConcurrency).toBe(5);
    expect(config.checkinRetries).toBe(4);
    expect(config.adminUser).toBe("owner");
    expect(config.notifyOnStatusOnly).toBe(true);
    expect(config.notifications.map((channel) => channel.channel)).toEqual(["dingtalk", "telegram", "feishu"]);
  });
});
