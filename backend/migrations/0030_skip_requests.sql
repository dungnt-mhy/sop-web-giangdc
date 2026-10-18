-- 0030: Yêu cầu xin bỏ qua bước.

CREATE TABLE IF NOT EXISTS skip_requests (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  step_id       TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  requested_by  TEXT NOT NULL REFERENCES users(id),
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by   TEXT REFERENCES users(id),
  reviewed_at   TEXT,
  reject_reason TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (execution_id, step_id, status)
);
