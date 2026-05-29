import { extractPoints } from "./glados";
import type { AccountRunResult, CheckinLogDatabase, CheckinLogRow, RunReport } from "./types";

type RawLogRow = {
  id: number;
  account_name: string;
  checked_at: string;
  status: CheckinLogRow["status"];
  message: string;
  points: number;
  left_days: string | null;
  trigger: RunReport["trigger"];
};

export async function recordSuccessfulCheckins(
  db: CheckinLogDatabase | undefined,
  results: AccountRunResult[],
  trigger: RunReport["trigger"],
  checkedAt: string
): Promise<void> {
  if (!db) {
    return;
  }

  for (const result of results) {
    if (result.checkin.status !== "success" && result.checkin.status !== "already_checked_in") {
      continue;
    }

    const statement = db
      .prepare(
        `INSERT INTO checkin_logs (account_name, checked_at, status, message, points, left_days, trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        result.accountName,
        checkedAt,
        result.checkin.status,
        result.checkin.message,
        extractPoints(result.checkin.message),
        result.accountStatus?.leftDays ?? null,
        trigger
      );

    await statement.run?.();
  }
}

export async function listCheckinLogs(
  db: CheckinLogDatabase,
  filters: { year?: string | null; month?: string | null }
): Promise<{ rows: CheckinLogRow[]; totalPoints: number }> {
  const range = buildRange(filters.year, filters.month);
  let sql =
    "SELECT id, account_name, checked_at, status, message, points, left_days, trigger FROM checkin_logs";
  const values: string[] = [];

  if (range) {
    sql += " WHERE checked_at >= ? AND checked_at < ?";
    values.push(range.start, range.end);
  }
  sql += " ORDER BY checked_at DESC, id DESC LIMIT 500";

  const statement = db.prepare(sql);
  const response =
    values.length > 0 ? await statement.bind(...values).all?.<RawLogRow>() : await statement.all?.<RawLogRow>();
  const rows = (response?.results ?? []).map(mapRow);
  return {
    rows,
    totalPoints: rows.reduce((total, row) => total + row.points, 0)
  };
}

export function buildLogHtml(logs: { rows: CheckinLogRow[]; totalPoints: number }): string {
  const rows = logs.rows
    .map(
      (row) => `<tr>
<td class="col-time">${escapeHtml(formatShanghaiTime(row.checkedAt))}</td>
<td class="col-account">${escapeHtml(row.accountName)}</td>
<td class="col-status">${escapeHtml(row.status)}</td>
<td class="col-points">${escapeHtml(String(row.points))}</td>
<td class="col-days">${escapeHtml(row.leftDays ?? "")}</td>
<td class="col-trigger">${escapeHtml(row.trigger)}</td>
<td class="col-message">${escapeHtml(row.message)}</td>
</tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GLaDOS 签到日志</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;color:#172033;background:#f7f8fb}
main{max-width:1760px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 12px}
.summary{margin:0 0 18px;font-weight:600}
.table-wrap{width:100%;overflow-x:auto;border:1px solid #d8deea;border-radius:8px;background:#fff}
table{width:100%;min-width:1320px;border-collapse:collapse;background:#fff;table-layout:fixed}
th,td{border-bottom:1px solid #d8deea;border-right:1px solid #d8deea;padding:10px;text-align:center;font-size:14px;vertical-align:middle;overflow-wrap:anywhere;word-break:normal}
th:last-child,td:last-child{border-right:0}
tbody tr:last-child td{border-bottom:0}
th{background:#eef2f8}
.col-time{width:140px;white-space:normal}
.col-account{width:260px}
.col-status{width:150px;white-space:normal}
.col-points{width:72px;white-space:nowrap}
.col-days{width:84px;white-space:nowrap}
.col-trigger{width:92px;white-space:nowrap}
.col-message{width:auto;min-width:320px;line-height:1.45;text-align:left}
@media (max-width:760px){main{padding:16px}.table-wrap{border-radius:6px}th,td{font-size:13px;padding:9px}}
</style>
</head>
<body>
<main>
<h1>GLaDOS 签到日志</h1>
<p class="summary">累计 Point：${escapeHtml(String(logs.totalPoints))}</p>
<div class="table-wrap">
<table>
<thead><tr><th class="col-time">日期时间</th><th class="col-account">账号</th><th class="col-status">状态</th><th class="col-points">Point</th><th class="col-days">剩余天数</th><th class="col-trigger">触发</th><th class="col-message">消息</th></tr></thead>
<tbody>${rows || `<tr><td colspan="7">暂无记录</td></tr>`}</tbody>
</table>
</div>
</main>
</body>
</html>`;
}

function buildRange(year?: string | null, month?: string | null): { start: string; end: string } | undefined {
  if (!year) {
    return undefined;
  }
  const yearNumber = Number.parseInt(year, 10);
  if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2100) {
    return undefined;
  }
  if (!month) {
    return {
      start: `${yearNumber}-01-01T00:00:00.000Z`,
      end: `${yearNumber + 1}-01-01T00:00:00.000Z`
    };
  }
  const monthNumber = Number.parseInt(month, 10);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return undefined;
  }
  const nextYear = monthNumber === 12 ? yearNumber + 1 : yearNumber;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    start: `${yearNumber}-${pad2(monthNumber)}-01T00:00:00.000Z`,
    end: `${nextYear}-${pad2(nextMonth)}-01T00:00:00.000Z`
  };
}

function mapRow(row: RawLogRow): CheckinLogRow {
  return {
    id: row.id,
    accountName: row.account_name,
    checkedAt: row.checked_at,
    status: row.status,
    message: row.message,
    points: row.points,
    leftDays: row.left_days ?? undefined,
    trigger: row.trigger
  };
}

function formatShanghaiTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
