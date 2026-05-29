import { formatPlainReport } from "../format";
import type { Fetcher, NotificationChannel, NotificationResult, RunReport } from "../types";

export async function sendEnabledNotifications(
  report: RunReport,
  options: {
    channels: NotificationChannel[];
    fetcher?: Fetcher;
  }
): Promise<NotificationResult[]> {
  const fetcher = options.fetcher ?? fetch;
  const text = formatPlainReport(report);
  const results: NotificationResult[] = [];

  for (const channel of options.channels) {
    if (!isCompleteChannel(channel)) {
      continue;
    }
    try {
      const response = await sendChannel(channel, text, fetcher);
      if (response.ok) {
        results.push({ channel: channel.channel, ok: true });
      } else {
        results.push({ channel: channel.channel, ok: false, error: `HTTP ${response.status}` });
      }
    } catch (error) {
      results.push({ channel: channel.channel, ok: false, error: safeError(error) });
    }
  }

  return results;
}

export async function createDingTalkUrl(webhook: string, secret?: string, now = Date.now()): Promise<string> {
  if (!secret) {
    return webhook;
  }
  const timestamp = String(now);
  const sign = await hmacSha256Base64(secret, `${timestamp}\n${secret}`);
  const url = new URL(webhook);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  return url.toString();
}

export async function createFeishuPayload(text: string, secret?: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload: {
    timestamp?: string;
    sign?: string;
    msg_type: "text";
    content: { text: string };
  } = {
    msg_type: "text",
    content: { text }
  };

  if (secret) {
    const timestamp = String(nowSeconds);
    payload.timestamp = timestamp;
    payload.sign = await hmacSha256Base64(`${timestamp}\n${secret}`, "");
  }

  return payload;
}

async function sendChannel(channel: NotificationChannel, text: string, fetcher: Fetcher): Promise<Response> {
  switch (channel.channel) {
    case "dingtalk":
      return sendDingTalk(channel.webhook, text, fetcher, channel.secret);
    case "telegram":
      return sendTelegram(channel.botToken, channel.chatId, text, fetcher);
    case "feishu":
      return sendFeishu(channel.webhook, text, fetcher, channel.secret);
  }
}

async function sendDingTalk(webhook: string, text: string, fetcher: Fetcher, secret?: string): Promise<Response> {
  return fetcher(await createDingTalkUrl(webhook, secret), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        title: "GLaDOS 签到报告",
        text
      }
    })
  });
}

async function sendTelegram(botToken: string, chatId: string, text: string, fetcher: Fetcher): Promise<Response> {
  return fetcher(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}

async function sendFeishu(webhook: string, text: string, fetcher: Fetcher, secret?: string): Promise<Response> {
  return fetcher(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await createFeishuPayload(text, secret))
  });
}

function isCompleteChannel(channel: NotificationChannel): boolean {
  switch (channel.channel) {
    case "dingtalk":
    case "feishu":
      return Boolean(channel.webhook);
    case "telegram":
      return Boolean(channel.botToken && channel.chatId);
  }
}

async function hmacSha256Base64(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return base64(signature);
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "Unknown error";
}

