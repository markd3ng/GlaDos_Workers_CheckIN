import { describe, expect, it, vi } from "vitest";
import { buildLogHtml, listCheckinLogs, recordSuccessfulCheckins } from "../src/storage";
import type { AccountRunResult } from "../src/types";

describe("checkin log storage", () => {
  it("records successful checkins with points and skips failed or expired accounts", async () => {
    const db = createMockDb();
    const results: AccountRunResult[] = [
      {
        accountName: "main",
        checkin: { status: "success", message: "Checkin! Got 2 Points" },
        accountStatus: { leftDays: "12" }
      },
      {
        accountName: "expired",
        checkin: { status: "expired", message: "Please login first" }
      }
    ];

    await recordSuccessfulCheckins(db, results, "scheduled", "2026-05-28T08:00:00.000Z");

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO checkin_logs"));
    expect(db.binds[0]).toEqual(["main", "2026-05-28T08:00:00.000Z", "success", "Checkin! Got 2 Points", 2, "12", "scheduled"]);
  });

  it("lists logs filtered by year and month and returns total points", async () => {
    const db = createMockDb([
      {
        id: 1,
        account_name: "main",
        checked_at: "2026-05-28T08:00:00.000Z",
        status: "success",
        message: "Checkin! Got 2 Points",
        points: 2,
        left_days: "12",
        trigger: "scheduled"
      }
    ]);

    const result = await listCheckinLogs(db, { year: "2026", month: "05" });

    expect(result.totalPoints).toBe(2);
    expect(result.rows[0]?.accountName).toBe("main");
    expect(db.binds[0]).toEqual(["2026-05-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"]);
  });

  it("renders logs as a readable table with total points", () => {
    const html = buildLogHtml({
      totalPoints: 2,
      rows: [
        {
          id: 1,
          accountName: "main",
          checkedAt: "2026-05-28T08:00:00.000Z",
          status: "success",
          message: "Checkin! Got 2 Points",
          points: 2,
          leftDays: "12",
          trigger: "scheduled"
        }
      ]
    });

    expect(html).toContain("<table>");
    expect(html).toContain("累计 Point");
    expect(html).toContain("<td>main</td>");
    expect(html).toContain("<td>2</td>");
  });
});

function createMockDb(rows: Record<string, unknown>[] = []) {
  const db = {
    binds: [] as unknown[][],
    prepare: vi.fn((sql: string) => ({
      bind: (...values: unknown[]) => {
        db.binds.push(values);
        return {
          run: vi.fn().mockResolvedValue({ success: true }),
          all: vi.fn().mockResolvedValue({ results: rows })
        };
      },
      all: vi.fn().mockResolvedValue({ results: rows }),
      run: vi.fn().mockResolvedValue({ success: true }),
      sql
    }))
  };
  return db;
}
