-- 0031: Snapshot vai trò người kiểm duyệt/giám sát vào bước thực hiện.

CREATE TABLE IF NOT EXISTS execution_step_supervisors (
  execution_step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  PRIMARY KEY (execution_step_id, position_id)
);
