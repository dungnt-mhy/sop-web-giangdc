-- 0029: Vai trò người kiểm duyệt/giám sát cho từng bước.

CREATE TABLE IF NOT EXISTS process_step_supervisors (
  step_id     TEXT NOT NULL REFERENCES process_steps(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES positions(id),
  PRIMARY KEY (step_id, position_id)
);
