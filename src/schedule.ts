import type { CheckinLogDatabase, ScheduleInfo } from "./types";

type ScheduleRow = {
  run_date: string;
  target_time: string;
  executed_at: string | null;
  created_at: string;
};

export type ScheduleDecision = {
  shouldRun: boolean;
  reason: "missing_db" | "before_target" | "due" | "already_executed";
  runDate?: string;
  targetTime?: string;
};

type ScheduleOptions = {
  now?: Date;
  startHour?: number;
  endHour?: number;
  randomInt?: (maxExclusive: number) => number;
};

export async function shouldRunScheduledCheckin(
  db: CheckinLogDatabase | undefined,
  options: ScheduleOptions = {}
): Promise<ScheduleDecision> {
  if (!db) {
    return { shouldRun: true, reason: "missing_db" };
  }

  const now = options.now ?? new Date();
  const date = shanghaiDateParts(now);
  const runDate = formatRunDate(date);
  const row = (await readSchedule(db, runDate)) ?? (await createSchedule(db, runDate, date, now, options));

  if (row.executed_at) {
    return { shouldRun: false, reason: "already_executed", runDate, targetTime: row.target_time };
  }

  if (now.getTime() < Date.parse(row.target_time)) {
    return { shouldRun: false, reason: "before_target", runDate, targetTime: row.target_time };
  }

  return { shouldRun: true, reason: "due", runDate, targetTime: row.target_time };
}

export async function markScheduledCheckinExecuted(
  db: CheckinLogDatabase | undefined,
  runDate: string | undefined,
  executedAt: string
): Promise<void> {
  if (!db || !runDate) {
    return;
  }
  await db.prepare("UPDATE scheduled_checkins SET executed_at = ? WHERE run_date = ?").bind(executedAt, runDate).run?.();
}

export async function getNextScheduledCheckin(
  db: CheckinLogDatabase | undefined,
  options: ScheduleOptions = {}
): Promise<ScheduleInfo> {
  if (!db) {
    return { available: false, status: "missing_db" };
  }

  const now = options.now ?? new Date();
  const today = shanghaiDateParts(now);
  const todayRunDate = formatRunDate(today);
  const todayRow =
    (await readSchedule(db, todayRunDate)) ?? (await createSchedule(db, todayRunDate, today, now, options));

  if (!todayRow.executed_at) {
    return {
      available: true,
      status: now.getTime() >= Date.parse(todayRow.target_time) ? "due" : "pending",
      runDate: todayRunDate,
      targetTime: todayRow.target_time
    };
  }

  const tomorrow = addShanghaiDays(today, 1);
  const tomorrowRunDate = formatRunDate(tomorrow);
  const tomorrowRow =
    (await readSchedule(db, tomorrowRunDate)) ??
    (await createSchedule(db, tomorrowRunDate, tomorrow, now, options));

  return {
    available: true,
    status: "pending",
    runDate: tomorrowRunDate,
    targetTime: tomorrowRow.target_time
  };
}

async function readSchedule(db: CheckinLogDatabase, runDate: string): Promise<ScheduleRow | undefined> {
  const response = await db
    .prepare("SELECT run_date, target_time, executed_at, created_at FROM scheduled_checkins WHERE run_date = ? LIMIT 1")
    .bind(runDate)
    .all?.<ScheduleRow>();
  return response?.results?.[0];
}

async function createSchedule(
  db: CheckinLogDatabase,
  runDate: string,
  date: { year: number; month: number; day: number },
  now: Date,
  options: ScheduleOptions
): Promise<ScheduleRow> {
  const targetTime = randomTargetTime(date, options).toISOString();
  const row: ScheduleRow = {
    run_date: runDate,
    target_time: targetTime,
    executed_at: null,
    created_at: now.toISOString()
  };
  await db
    .prepare("INSERT OR IGNORE INTO scheduled_checkins (run_date, target_time, created_at) VALUES (?, ?, ?)")
    .bind(row.run_date, row.target_time, row.created_at)
    .run?.();
  return (await readSchedule(db, runDate)) ?? row;
}

function randomTargetTime(
  date: { year: number; month: number; day: number },
  options: ScheduleOptions
): Date {
  const startHour = clampHour(options.startHour ?? 8);
  const endHour = clampHour(options.endHour ?? 23);
  const windowMinutes = Math.max(1, (endHour - startHour) * 60);
  const offsetMinutes = options.randomInt?.(windowMinutes) ?? cryptoRandomInt(windowMinutes);
  return new Date(Date.UTC(date.year, date.month - 1, date.day, startHour - 8, offsetMinutes));
}

function cryptoRandomInt(maxExclusive: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) % maxExclusive;
}

function shanghaiDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function addShanghaiDays(
  date: { year: number; month: number; day: number },
  days: number
): { year: number; month: number; day: number } {
  return shanghaiDateParts(new Date(Date.UTC(date.year, date.month - 1, date.day + days, 0)));
}

function formatRunDate(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function clampHour(value: number): number {
  return Math.min(23, Math.max(0, Math.trunc(value)));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
