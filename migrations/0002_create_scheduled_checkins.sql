CREATE TABLE IF NOT EXISTS scheduled_checkins (
  run_date TEXT PRIMARY KEY,
  target_time TEXT NOT NULL,
  executed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_checkins_target_time ON scheduled_checkins (target_time);
