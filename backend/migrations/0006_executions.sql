-- 0006_executions.sql — Lượt thực hiện quy trình (Task 1.6).
-- Khớp SRS v1.6: EXE-001–009, EXE-011–013; §7.2 (máy trạng thái Execution); AC-04.
-- Quy ước: forward-only — không sửa file đã áp dụng.
--
-- Execution: CREATED -> IN_PROGRESS -> COMPLETED | CANCELLED
--            IN_PROGRESS <-> PAUSED (tạm dừng/tiếp tục)
-- ExecutionStep: NOT_STARTED -> IN_PROGRESS -> PASSED | FAILED | SKIPPED
-- Snapshot: khi tạo lượt, sao chép cấu trúc bước từ phiên bản để lượt bất biến
--           dù phiên bản sau này có bản mới (AC-02).

CREATE TABLE IF NOT EXISTS executions (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,       -- mã lượt duy nhất, VD: EXE-20261017-001
  process_id         TEXT NOT NULL REFERENCES processes(id),
  version_id         TEXT NOT NULL REFERENCES process_versions(id),
  title              TEXT,                        -- tiêu đề lượt (tùy chọn)
  status             TEXT NOT NULL DEFAULT 'CREATED'
                     CHECK (status IN ('CREATED','IN_PROGRESS','PAUSED','COMPLETED','CANCELLED')),
  assignee_id        TEXT REFERENCES users(id),  -- người được giao
  due_at             TEXT,                        -- hạn xử lý (ISO 8601 UTC)
  cancel_reason      TEXT,                        -- lý do hủy (bắt buộc khi hủy)
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  created_by         TEXT REFERENCES users(id),
  started_at         TEXT,
  completed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_exec_process ON executions(process_id);
CREATE INDEX IF NOT EXISTS idx_exec_assignee ON executions(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_exec_status ON executions(status);

-- Bước trong lượt thực hiện — snapshot từ process_steps tại thời điểm tạo lượt.
CREATE TABLE IF NOT EXISTS execution_steps (
  id                 TEXT PRIMARY KEY,
  execution_id       TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL,
  code               TEXT NOT NULL,
  title              TEXT NOT NULL,
  instruction        TEXT,
  role               TEXT,
  is_required        INTEGER NOT NULL DEFAULT 1,
  -- Trạng thái thực hiện của bước
  status             TEXT NOT NULL DEFAULT 'NOT_STARTED'
                     CHECK (status IN ('NOT_STARTED','IN_PROGRESS','PASSED','FAILED','SKIPPED')),
  -- Kết quả
  completed_by       TEXT REFERENCES users(id),
  completed_at       TEXT,
  note               TEXT,                        -- ghi chú khi hoàn thành/bỏ qua
  skip_reason        TEXT,                        -- lý do bỏ qua (nếu SKIPPED)
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  UNIQUE (execution_id, sort_order),
  UNIQUE (execution_id, code)
);
CREATE INDEX IF NOT EXISTS idx_exstep_exec ON execution_steps(execution_id, sort_order);
