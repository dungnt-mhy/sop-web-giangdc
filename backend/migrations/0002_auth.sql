-- 0002_auth.sql — Bảng xác thực, phiên đăng nhập, phân quyền vai trò hệ thống (Task 1.2).
-- Khớp SPEC §11 (User, LocalCredential, UserSession) + §5 (vai trò hệ thống).
-- Quy ước: forward-only — không sửa file đã áp dụng, thay đổi mới viết file 0003_*.sql trở đi.
--
-- Ghi chú thiết kế (ghi vào DECISIONS.md D-10..D-12):
-- - Thêm bảng `user_roles` cho VAI TRÒ HỆ THỐNG (admin, process_owner, ...) theo ma trận §5.
--   Tách khỏi `UserBusinessRole` (vai trò nghiệp vụ gắn vào bước) đúng yêu cầu SPEC §5.
-- - Thêm bảng `audit_events` tối thiểu theo §11 + ADM-002 (chỉ ghi sự kiện xác thực/quản trị user ở Task 1.2).
-- - `local_credentials` lưu salt riêng cột `password_salt` (SPEC chỉ liệt kê trường logic;
--   tách salt/hash giúp xoay vòng minh bạch, vẫn "chỉ lưu hash, không lưu mật khẩu").

CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  username           TEXT NOT NULL,              -- đã chuẩn hoá: trim + lowercase
  display_name       TEXT NOT NULL,
  email              TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_changed_at TEXT,                      -- ISO 8601 UTC
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until       TEXT,                        -- ISO 8601 UTC; NULL = không bị khoá tạm
  created_at         TEXT NOT NULL,
  created_by         TEXT,
  updated_at         TEXT,
  updated_by         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS local_credentials (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL UNIQUE REFERENCES users(id),
  password_hash        TEXT NOT NULL,            -- base64 của derived key (KHÔNG phải mật khẩu)
  password_salt        TEXT NOT NULL,            -- base64 của salt ngẫu nhiên riêng mỗi user
  hash_algorithm       TEXT NOT NULL,            -- 'PBKDF2-SHA256'
  hash_params          TEXT NOT NULL,            -- JSON: {"iterations":100000,"salt_len":16,"key_len":32}
  must_change_password INTEGER NOT NULL DEFAULT 0, -- 1 = bắt buộc đổi ở lần đăng nhập tới
  rotated_at           TEXT,                      -- lần đổi mật khẩu gần nhất
  created_at           TEXT NOT NULL,
  created_by           TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  session_hash   TEXT NOT NULL,                  -- SHA-256 hex của token (không lưu token thô)
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,                  -- trượt 12h mỗi lần dùng, tối đa tuyệt đối 7 ngày
  revoked_at     TEXT,                            -- NULL = còn hiệu lực
  device_summary TEXT                             -- user-agent rút gọn (tối đa 120 ký tự)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_hash ON user_sessions(session_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at);

-- Vai trò HỆ THỐNG cấp quyền thao tác (SPEC §5). Một user có thể mang nhiều vai trò.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN (
                'admin', 'process_owner', 'editor', 'reviewer',
                'approver', 'executor', 'monitor', 'viewer'
              )),
  created_at TEXT NOT NULL,
  created_by TEXT,
  PRIMARY KEY (user_id, role)
);

-- Nhật ký kiểm toán tối thiểu (SPEC §11 + ADM-002). Chỉ thêm, không sửa/xoá ở tầng ứng dụng.
CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,                     -- AUTH_LOGIN_OK, AUTH_LOGIN_FAIL, ...
  actor_id    TEXT,                               -- NULL với hành động ẩn danh (đăng nhập thất bại)
  object_type TEXT,                               -- 'user' | 'session' | NULL
  object_id   TEXT,
  occurred_at TEXT NOT NULL,
  request_id  TEXT,
  diff_json   TEXT                                -- JSON rút gọn, KHÔNG chứa secret/mật khẩu/token
);
CREATE INDEX IF NOT EXISTS idx_audit_events_object ON audit_events(object_type, object_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type, occurred_at);
