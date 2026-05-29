CREATE TABLE IF NOT EXISTS checkin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  left_days TEXT,
  trigger TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkin_logs_checked_at ON checkin_logs (checked_at);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_account_name ON checkin_logs (account_name);
