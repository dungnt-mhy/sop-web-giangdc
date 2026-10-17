-- 0005_process_steps.sql — Bước công việc trong phiên bản quy trình (Task 1.5).
-- Khớp SRS v1.6: PRC-004–009; §7.1 (chỉ bản DRAFT được sửa cấu trúc).
-- Quy ước: forward-only — không sửa file đã áp dụng.
--
-- Bước gắn với process_versions (không gắn trực tiếp với processes) vì phiên bản
-- từ IN_REVIEW trở đi là bất biến — mỗi phiên bản có tập bước riêng (snapshot).

CREATE TABLE IF NOT EXISTS process_steps (
  id                 TEXT PRIMARY KEY,
  version_id         TEXT NOT NULL REFERENCES process_versions(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL,           -- thứ tự bước trong quy trình
  -- PRC-005: thông tin bước
  code               TEXT NOT NULL,              -- mã bước, duy nhất trong phiên bản
  title              TEXT NOT NULL,              -- tiêu đề hành động
  prerequisite       TEXT,                        -- điều kiện tiên quyết
  input_desc         TEXT,                        -- đầu vào
  instruction        TEXT,                        -- hướng dẫn thực hiện
  expected_result    TEXT,                        -- kết quả mong đợi
  output_desc        TEXT,                        -- đầu ra / bàn giao
  note               TEXT,                        -- ghi chú
  role               TEXT,                        -- vai trò thực hiện (vai trò nghiệp vụ, text tự do ở MVP)
  is_required        INTEGER NOT NULL DEFAULT 1, -- 1 = bắt buộc, 0 = tùy chọn
  target_duration_min INTEGER,                    -- thời lượng mục tiêu (phút)
  warning            TEXT,                        -- cảnh báo
  -- PRC-006: yêu cầu hoàn thành (lưu JSON: {fields, forms, photos, confirmations, scan_codes, notes})
  completion_req     TEXT,                        -- JSON, NULL = không yêu cầu đặc biệt
  -- PRC-007: cấu hình bỏ qua (lưu JSON: {allowed, allowed_roles, reason_required, approval_level})
  skip_policy        TEXT,                        -- JSON, NULL = không cho bỏ qua
  -- PRC-008: hướng xử lý khi không đạt (lưu JSON: {on_fail: stop|retry|escalate|cancel})
  failure_policy     TEXT,                        -- JSON, NULL = mặc định (dừng)
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  created_by         TEXT REFERENCES users(id),
  updated_by         TEXT REFERENCES users(id),
  UNIQUE (version_id, code),
  UNIQUE (version_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_steps_version ON process_steps(version_id, sort_order);
