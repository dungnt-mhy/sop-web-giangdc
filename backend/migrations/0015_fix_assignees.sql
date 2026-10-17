-- 0015_fix_assignees.sql — Đảm bảo bảng execution_step_assignees tồn tại
-- (0012 có thể đã bị đánh dấu applied nhưng bảng chưa được tạo).

CREATE TABLE IF NOT EXISTS execution_step_assignees (
  execution_step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  assigned_by TEXT REFERENCES users(id),
  PRIMARY KEY (execution_step_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_step_assignees_user ON execution_step_assignees(user_id);
