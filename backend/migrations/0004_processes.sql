-- 0004_processes.sql — Danh mục quy trình + phiên bản (Task 1.4).
-- Khớp SRS v1.6 §7.1 (máy trạng thái ProcessVersion), PRC-001–003, PRC-009.
-- Quy ước: forward-only — không sửa file đã áp dụng.
--
-- Máy trạng thái: DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> SUPERSEDED -> RETIRED
--                 APPROVED -> SCHEDULED -> ACTIVE (khi effective_from trong tương lai)
--                 IN_REVIEW -> DRAFT (trả sửa)
-- Bất biến: mỗi Process tối đa 1 ACTIVE và 1 SCHEDULED chưa kích hoạt tại một thời điểm.

CREATE TABLE IF NOT EXISTS processes (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,       -- mã quy trình, ví dụ "XUAT-HANG-DL"
  name               TEXT NOT NULL,              -- tên quy trình
  purpose            TEXT,                        -- mục đích
  scope              TEXT,                        -- phạm vi áp dụng
  applicable_objects TEXT,                        -- đối tượng áp dụng
  start_condition    TEXT,                        -- điều kiện bắt đầu
  end_condition      TEXT,                        -- điều kiện kết thúc
  owner_id           TEXT REFERENCES users(id),  -- chủ sở hữu (user id)
  applying_unit      TEXT,                        -- đơn vị áp dụng
  review_trigger     TEXT,                        -- tác nhân kích hoạt xem xét lại
  group_name         TEXT,                        -- nhóm quy trình (để lọc)
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  created_by         TEXT REFERENCES users(id),
  updated_by         TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_processes_code ON processes(code);
CREATE INDEX IF NOT EXISTS idx_processes_name ON processes(name);
CREATE INDEX IF NOT EXISTS idx_processes_group ON processes(group_name);
CREATE INDEX IF NOT EXISTS idx_processes_owner ON processes(owner_id);

CREATE TABLE IF NOT EXISTS process_versions (
  id                 TEXT PRIMARY KEY,
  process_id         TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  version_number     INTEGER NOT NULL,           -- 1, 2, 3...
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','SCHEDULED','ACTIVE','SUPERSEDED','RETIRED')),
  effective_from     TEXT,                        -- ISO 8601 UTC; NULL = hiệu lực ngay khi duyệt
  effective_to       TEXT,                        -- ISO 8601 UTC; không tự retire trong MVP
  change_summary     TEXT,                        -- tóm tắt thay đổi so với bản trước
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  created_by         TEXT REFERENCES users(id),
  submitted_at       TEXT,                        -- lúc gửi duyệt (DRAFT -> IN_REVIEW)
  submitted_by       TEXT REFERENCES users(id),
  approved_at        TEXT,                        -- lúc phê duyệt (IN_REVIEW -> APPROVED)
  approved_by        TEXT REFERENCES users(id),
  activated_at       TEXT,                        -- lúc kích hoạt (APPROVED/SCHEDULED -> ACTIVE)
  activated_by       TEXT REFERENCES users(id),
  UNIQUE (process_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_pv_process ON process_versions(process_id, version_number);
CREATE INDEX IF NOT EXISTS idx_pv_status ON process_versions(process_id, status);

-- Bất biến: mỗi Process tối đa 1 ACTIVE tại một thời điểm (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pv_one_active
  ON process_versions(process_id) WHERE status = 'ACTIVE';
-- Bất biến: mỗi Process tối đa 1 SCHEDULED chưa kích hoạt tại một thời điểm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pv_one_scheduled
  ON process_versions(process_id) WHERE status = 'SCHEDULED';
