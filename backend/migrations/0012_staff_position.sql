-- 0012_staff_position.sql — Bổ sung chức vụ cho nhân viên + người giám sát + phân công theo bước.
-- 1. Thêm chức vụ vào bảng users.
-- 2. Thêm người giám sát cho lượt công việc.
-- 3. Bảng phân công nhiều người cho từng bước thực hiện.

ALTER TABLE users ADD COLUMN position TEXT;

ALTER TABLE executions ADD COLUMN supervisor_id TEXT REFERENCES users(id);

-- Phân công người thực hiện cho từng bước (hỗ trợ nhiều người/bước).
CREATE TABLE execution_step_assignees (
  execution_step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  assigned_by TEXT REFERENCES users(id),
  PRIMARY KEY (execution_step_id, user_id)
);

CREATE INDEX idx_step_assignees_user ON execution_step_assignees(user_id);
