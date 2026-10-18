-- 0028: Cho phép chọn nhiều người giám sát và nhiều người phê duyệt cho mỗi lượt.

CREATE TABLE IF NOT EXISTS execution_supervisors (
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (execution_id, user_id)
);

CREATE TABLE IF NOT EXISTS execution_approvers (
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (execution_id, user_id)
);

-- Chuyển dữ liệu cũ (1 người) sang bảng mới.
INSERT OR IGNORE INTO execution_supervisors (execution_id, user_id)
  SELECT id, supervisor_id FROM executions WHERE supervisor_id IS NOT NULL;

INSERT OR IGNORE INTO execution_approvers (execution_id, user_id)
  SELECT id, approver_id FROM executions WHERE approver_id IS NOT NULL;
