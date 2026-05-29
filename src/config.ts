import type { AccountConfig, AppConfig, EnvLike, NotificationChannel } from "./types";

export function parseConfig(env: EnvLike): AppConfig {
  const rawAccounts = getString(env, "GLADOS_ACCOUNTS")?.trim();
  if (!rawAccounts) {
    throw new Error("GLADOS_ACCOUNTS is required");
  }

  const parsed = parseAccountsJson(rawAccounts);
  if (!Array.isArray(parsed)) {
    throw new Error("GLADOS_ACCOUNTS must be a JSON array");
  }
  if (parsed.length === 0) {
    throw new Error("GLADOS_ACCOUNTS must contain at least one account");
  }

  const accounts = parsed.map((entry, index) => parseAccount(entry, index));

  return {
    accounts,
    adminToken: nonEmpty(getString(env, "ADMIN_TOKEN")),
    checkinConcurrency: parsePositiveInteger(getString(env, "CHECKIN_CONCURRENCY"), 2),
    checkinRetries: parsePositiveInteger(getString(env, "CHECKIN_RETRIES"), 3),
    manualEndpointsEnabled: getString(env, "ENABLE_MANUAL_ENDPOINTS")?.toLowerCase() === "true",
    notifyOnStatusOnly: getString(env, "NOTIFY_ON_STATUS_ONLY")?.toLowerCase() === "true",
    notifications: parseNotifications(env)
  };
}

function parseAccountsJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GLADOS_ACCOUNTS must be a JSON array");
  }
}

function parseAccount(value: unknown, index: number): AccountConfig {
  if (!isRecord(value)) {
    throw new Error(`Account ${index + 1} must be an object`);
  }

  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : `account-${index + 1}`;
  const cookie = typeof value.cookie === "string" ? value.cookie.trim() : "";

  if (!cookie) {
    throw new Error(`Account ${name} must include a cookie`);
  }

  return { name, cookie };
}

function parseNotifications(env: EnvLike): NotificationChannel[] {
  const notifications: NotificationChannel[] = [];
  const dingtalkWebhook = nonEmpty(getString(env, "DINGTALK_WEBHOOK"));
  const telegramBotToken = nonEmpty(getString(env, "TELEGRAM_BOT_TOKEN"));
  const telegramChatId = nonEmpty(getString(env, "TELEGRAM_CHAT_ID"));
  const feishuWebhook = nonEmpty(getString(env, "FEISHU_WEBHOOK"));

  if (dingtalkWebhook) {
    notifications.push({ channel: "dingtalk", webhook: dingtalkWebhook, secret: nonEmpty(getString(env, "DINGTALK_SECRET")) });
  }
  if (telegramBotToken && telegramChatId) {
    notifications.push({ channel: "telegram", botToken: telegramBotToken, chatId: telegramChatId });
  }
  if (feishuWebhook) {
    notifications.push({ channel: "feishu", webhook: feishuWebhook, secret: nonEmpty(getString(env, "FEISHU_SECRET")) });
  }

  return notifications;
}

function getString(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" ? value : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
