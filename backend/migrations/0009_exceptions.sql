-- 0009_exceptions.sql — Quản lý ngoại lệ trong thực hiện công việc (SPEC §9.5).
-- Khi bước không đạt hoặc phát sinh sự cố, ghi nhận ngoại lệ để theo dõi xử lý.
-- Vòng đời: OPEN (mới) -> IN_PROGRESS (đang xử lý) -> RESOLVED (đã khắc phục) -> CLOSED (đóng).

CREATE TABLE exceptions (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  execution_step_id TEXT REFERENCES execution_steps(id) ON DELETE SET NULL,
  -- Tiêu đề ngắn gọn về sự cố.
  title TEXT NOT NULL,
  -- Mô tả chi tiết sự cố.
  description TEXT NOT NULL,
  -- Mức độ: LOW, MEDIUM, HIGH, CRITICAL.
  severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Thông tin xử lý.
  assigned_to TEXT REFERENCES users(id),
  resolution TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  -- Thông tin đóng.
  close_note TEXT,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  updated_at TEXT
);

CREATE INDEX idx_exceptions_exec ON exceptions(execution_id);
CREATE INDEX idx_exceptions_step ON exceptions(execution_step_id);
CREATE INDEX idx_exceptions_status ON exceptions(status);
