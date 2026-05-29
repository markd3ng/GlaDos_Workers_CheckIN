import { describe, expect, it, vi } from "vitest";
import { getNextScheduledCheckin, markScheduledCheckinExecuted, shouldRunScheduledCheckin } from "../src/schedule";
import type { CheckinLogDatabase } from "../src/types";

describe("random scheduled checkin", () => {
  it("creates a Beijing-date random target and skips before that target", async () => {
    const db = createScheduleDb();

    const decision = await shouldRunScheduledCheckin(db, {
      now: new Date("2026-05-29T00:00:00.000Z"),
      randomInt: () => 60
    });

    expect(decision).toMatchObject({
      shouldRun: false,
      runDate: "2026-05-29",
      targetTime: "2026-05-29T01:00:00.000Z"
    });
    expect(db.rows.get("2026-05-29")?.target_time).toBe("2026-05-29T01:00:00.000Z");
  });

  it("runs after the saved random target and then skips once marked executed", async () => {
    const db = createScheduleDb([
      {
        run_date: "2026-05-29",
        target_time: "2026-05-29T01:00:00.000Z",
        executed_at: null,
        created_at: "2026-05-29T00:00:00.000Z"
      }
    ]);

    const decision = await shouldRunScheduledCheckin(db, { now: new Date("2026-05-29T01:30:00.000Z") });

    expect(decision.shouldRun).toBe(true);
    await markScheduledCheckinExecuted(db, "2026-05-29", "2026-05-29T01:30:00.000Z");

    const skipped = await shouldRunScheduledCheckin(db, { now: new Date("2026-05-29T02:00:00.000Z") });

    expect(skipped).toMatchObject({ shouldRun: false, reason: "already_executed" });
  });

  it("falls back to running immediately when D1 is unavailable", async () => {
    await expect(shouldRunScheduledCheckin(undefined)).resolves.toMatchObject({
      shouldRun: true,
      reason: "missing_db"
    });
  });

  it("returns the next pending schedule for dashboard display", async () => {
    const db = createScheduleDb();

    const schedule = await getNextScheduledCheckin(db, {
      now: new Date("2026-05-29T00:00:00.000Z"),
      randomInt: () => 90
    });

    expect(schedule).toEqual({
      available: true,
      runDate: "2026-05-29",
      targetTime: "2026-05-29T01:30:00.000Z",
      status: "pending"
    });
  });

  it("shows tomorrow schedule after today's schedule has executed", async () => {
    const db = createScheduleDb([
      {
        run_date: "2026-05-29",
        target_time: "2026-05-29T01:00:00.000Z",
        executed_at: "2026-05-29T01:30:00.000Z",
        created_at: "2026-05-29T00:00:00.000Z"
      }
    ]);

    const schedule = await getNextScheduledCheckin(db, {
      now: new Date("2026-05-29T02:00:00.000Z"),
      randomInt: () => 120
    });

    expect(schedule).toEqual({
      available: true,
      runDate: "2026-05-30",
      targetTime: "2026-05-30T02:00:00.000Z",
      status: "pending"
    });
  });
});

function createScheduleDb(rows: Array<Record<string, unknown>> = []) {
  const state = new Map(rows.map((row) => [String(row.run_date), { ...row }]));
  const db = {
    rows: state,
    prepare: vi.fn((sql: string) => ({
      bind: (...values: unknown[]) => ({
        all: vi.fn(async () => {
          if (sql.includes("SELECT")) {
            const row = state.get(String(values[0]));
            return { results: row ? [row] : [] };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (sql.includes("INSERT")) {
            state.set(String(values[0]), {
              run_date: values[0],
              target_time: values[1],
              executed_at: null,
              created_at: values[2]
            });
          }
          if (sql.includes("UPDATE")) {
            const row = state.get(String(values[1]));
            if (row) {
              row.executed_at = values[0];
            }
          }
          return { success: true };
        })
      })
    }))
  };
  return db as unknown as CheckinLogDatabase & { rows: Map<string, Record<string, unknown>> };
}
