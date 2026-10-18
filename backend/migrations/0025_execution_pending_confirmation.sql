-- 0025_execution_pending_confirmation.sql — Thêm trạng thái PENDING_CONFIRMATION vào CHECK constraint.
-- SQLite không sửa được CHECK trực tiếp → tạo bảng mới, copy dữ liệu, đổi tên (như migration 0016).

CREATE TABLE executions_new (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  process_id         TEXT NOT NULL REFERENCES processes(id),
  version_id         TEXT NOT NULL REFERENCES process_versions(id),
  title              TEXT,
  status             TEXT NOT NULL DEFAULT 'CREATED'
                     CHECK (status IN ('CREATED','IN_PROGRESS','PAUSED','PENDING_CONFIRMATION','COMPLETED','CANCELLED')),
  assignee_id        TEXT REFERENCES users(id),
  due_at             TEXT,
  cancel_reason      TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  created_by         TEXT REFERENCES users(id),
  started_at         TEXT,
  completed_at       TEXT,
  execution_date     TEXT,
  execution_time     TEXT,
  shift              TEXT,
  supervisor_id      TEXT REFERENCES users(id),
  creator_id         TEXT REFERENCES users(id),
  approver_id        TEXT REFERENCES users(id),
  approved_by        TEXT REFERENCES users(id),
  approved_at        TEXT
);

INSERT INTO executions_new SELECT * FROM executions;
DROP TABLE executions;
ALTER TABLE executions_new RENAME TO executions;
CREATE INDEX IF NOT EXISTS idx_exec_process ON executions(process_id);
CREATE INDEX IF NOT EXISTS idx_exec_assignee ON executions(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_exec_status ON executions(status);
