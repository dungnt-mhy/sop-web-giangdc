-- 0033: Gán người giám sát/duyệt cụ thể cho từng bước (không bắt buộc).

CREATE TABLE IF NOT EXISTS execution_step_supervisor_assignees (
  execution_step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at       TEXT NOT NULL,
  assigned_by       TEXT REFERENCES users(id),
  PRIMARY KEY (execution_step_id, user_id)
);
