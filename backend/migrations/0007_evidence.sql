-- 0007_evidence.sql — Bằng chứng ảnh/tệp cho từng bước thực hiện (EVD-001..013).
-- Metadata lưu trong D1, nội dung tệp lưu ở R2 (sop-demo-files).

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  execution_step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  -- Loại bằng chứng: PHOTO (ảnh), FILE (tệp khác).
  kind TEXT NOT NULL DEFAULT 'PHOTO' CHECK (kind IN ('PHOTO', 'FILE')),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  -- Khóa object trong R2 (ví dụ: evidence/<execution_id>/<step_id>/<uuid>.jpg).
  r2_key TEXT NOT NULL UNIQUE,
  -- Trạng thái xác minh: PENDING (đang chờ), VERIFIED (đã xác minh), REJECTED.
  -- Theo EVD-010/EVD-013: chỉ VERIFIED mới được tính là bằng chứng hợp lệ.
  -- Demo: server tự VERIFIED sau khi kiểm tra MIME/dung lượng (chưa có scanner).
  status TEXT NOT NULL DEFAULT 'VERIFIED' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_evidence_step ON evidence(execution_step_id);
CREATE INDEX idx_evidence_uploader ON evidence(uploaded_by);

-- Tài nguyên hướng dẫn của bước (EVD-011): ảnh/tệp minh họa chỉ đọc khi thực hiện,
-- tách biệt hoàn toàn với bằng chứng thực tế.
CREATE TABLE step_resources (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES process_steps(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'PHOTO' CHECK (kind IN ('PHOTO', 'FILE')),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_step_resources_step ON step_resources(step_id);
