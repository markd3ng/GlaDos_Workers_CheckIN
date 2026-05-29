import type { AccountRunResult, RunReport } from "./types";

export function formatPlainReport(report: RunReport): string {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(report.startedAt));

  const lines = [
    "GLaDOS 签到报告",
    `时间：${time}`,
    `触发方式：${report.trigger === "scheduled" ? "定时任务" : "手动触发"}`,
    `总账号：${report.summary.total}`,
    `成功/已签到：${report.summary.ok}`,
    `失败：${report.summary.failed}`,
    `Cookie 失效：${report.summary.expired}`,
    "",
    "账号明细：",
    ...report.results.map(formatAccountLine)
  ];

  return lines.join("\n");
}

function formatAccountLine(result: AccountRunResult): string {
  const label = statusLabel(result.checkin.status);
  const days = result.accountStatus?.leftDays ? `，剩余 ${result.accountStatus.leftDays} 天` : "";
  return `${result.accountName}：${label}，${result.checkin.message}${days}，Cookie 状态：${cookieStatusLabel(
    result.checkin.status
  )}，Cookie 到期时间：未知`;
}

function statusLabel(status: AccountRunResult["checkin"]["status"]): string {
  switch (status) {
    case "success":
      return "成功";
    case "already_checked_in":
      return "已签到";
    case "expired":
      return "Cookie 失效";
    case "failed":
      return "失败";
  }
}

function cookieStatusLabel(status: AccountRunResult["checkin"]["status"]): string {
  switch (status) {
    case "success":
    case "already_checked_in":
      return "当前有效";
    case "expired":
      return "已失效";
    case "failed":
      return "未知";
  }
}
