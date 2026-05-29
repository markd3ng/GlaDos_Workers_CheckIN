import type { AccountConfig, AccountRunResult, CheckinStatus, Fetcher } from "./types";

const CHECKIN_URL = "https://glados.rocks/api/user/checkin";
const STATUS_URL = "https://glados.rocks/api/user/status";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function buildGladosHeaders(cookie: string): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Content-Type": "application/json;charset=UTF-8",
    Cookie: cookie,
    Origin: "https://glados.rocks",
    Referer: "https://glados.rocks/console/checkin",
    "User-Agent": USER_AGENT
  };
}

export function classifyCheckinResponse(httpStatus: number, data: unknown): AccountRunResult["checkin"] {
  const message = safeMessage(data);
  const lowerMessage = message.toLowerCase();
  const code = isRecord(data) ? data.code : undefined;

  if (httpStatus === 401 || httpStatus === 403 || lowerMessage.includes("login") || lowerMessage.includes("unauthorized")) {
    return { status: "expired", message: message || `Cookie expired (HTTP ${httpStatus})`, httpStatus };
  }

  if (code === 0 || lowerMessage.includes("checkin! got")) {
    return { status: "success", message: message || "Check-in succeeded", httpStatus };
  }

  if (
    lowerMessage.includes("already") ||
    lowerMessage.includes("tomorrow") ||
    lowerMessage.includes("repeats") ||
    lowerMessage.includes("today")
  ) {
    return { status: "already_checked_in", message: message || "Already checked in", httpStatus };
  }

  return { status: "failed", message: message || `Unexpected response (HTTP ${httpStatus})`, httpStatus };
}

export function extractPoints(message: string): number {
  const match = /Got\s+([0-9]+(?:\.[0-9]+)?)\s+Points/i.exec(message);
  return match?.[1] ? Number.parseFloat(match[1]) : 0;
}

export async function checkAccountStatus(
  account: AccountConfig,
  fetcher: Fetcher = fetch
): Promise<AccountRunResult["accountStatus"]> {
  const response = await fetcher(STATUS_URL, {
    method: "GET",
    headers: buildGladosHeaders(account.cookie)
  });
  const data = await readJson(response);

  if (!response.ok) {
    return { message: safeMessage(data) || `Status request failed (HTTP ${response.status})` };
  }

  const leftDays = extractLeftDays(data);
  if (!leftDays) {
    return { message: safeMessage(data) || "Status response did not include remaining days" };
  }

  return { leftDays };
}

export async function performAccountRun(
  account: AccountConfig,
  options: {
    retries: number;
    fetcher?: Fetcher;
    sleep?: (milliseconds: number) => Promise<void>;
  }
): Promise<AccountRunResult> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const retries = Math.max(1, options.retries);
  let checkin: AccountRunResult["checkin"] = { status: "failed", message: "Check-in did not run" };

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetcher(CHECKIN_URL, {
        method: "POST",
        headers: buildGladosHeaders(account.cookie),
        body: JSON.stringify({ token: "glados.one" })
      });
      const data = await readJson(response);
      checkin = classifyCheckinResponse(response.status, data);

      if (!shouldRetry(checkin.status, response.status) || attempt === retries) {
        break;
      }
    } catch (error) {
      checkin = { status: "failed", message: safeError(error) };
      if (attempt === retries) {
        break;
      }
    }

    await sleep(attempt * 2000);
  }

  const result: AccountRunResult = {
    accountName: account.name,
    checkin
  };

  if (checkin.status === "success" || checkin.status === "already_checked_in") {
    result.accountStatus = await checkAccountStatus(account, fetcher);
  }

  return result;
}

export async function runAccounts(
  accounts: AccountConfig[],
  options: {
    concurrency: number;
    retries: number;
    fetcher?: Fetcher;
    sleep?: (milliseconds: number) => Promise<void>;
  }
): Promise<AccountRunResult[]> {
  const results: AccountRunResult[] = new Array<AccountRunResult>(accounts.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(options.concurrency, accounts.length));

  async function runNext(): Promise<void> {
    while (nextIndex < accounts.length) {
      const index = nextIndex;
      nextIndex += 1;
      const account = accounts[index];
      if (!account) {
        continue;
      }
      results[index] = await performAccountRun(account, {
        retries: options.retries,
        fetcher: options.fetcher,
        sleep: options.sleep
      });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

export function summarizeResults(results: AccountRunResult[]) {
  return results.reduce(
    (summary, result) => {
      summary.total += 1;
      if (result.checkin.status === "expired") {
        summary.expired += 1;
      } else if (result.checkin.status === "failed") {
        summary.failed += 1;
      } else {
        summary.ok += 1;
      }
      return summary;
    },
    { total: 0, ok: 0, failed: 0, expired: 0 }
  );
}

function shouldRetry(status: CheckinStatus, httpStatus: number | undefined): boolean {
  if (status !== "failed") {
    return false;
  }
  return httpStatus === 429 || (typeof httpStatus === "number" && httpStatus >= 500);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function extractLeftDays(data: unknown): string | undefined {
  if (!isRecord(data) || !isRecord(data.data)) {
    return undefined;
  }
  const value = data.data.leftDays;
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const numeric = Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(8).replace(/\.?0+$/, "");
}

function safeMessage(data: unknown): string {
  if (!isRecord(data) || typeof data.message !== "string") {
    return "";
  }
  return data.message.slice(0, 160);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
