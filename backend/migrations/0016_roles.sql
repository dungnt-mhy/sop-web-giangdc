-- 0016_roles.sql — Bảng vai trò ứng dụng (phân quyền) tách bạch với chức vụ công ty.
--
-- Hai khái niệm:
-- - roles (vai trò ỨNG DỤNG): ai được làm gì trong app — Quản trị, Người dùng...
--   Quyền được gán qua bảng role_permissions, chỉnh bằng checkbox trên giao diện.
-- - positions (chức vụ CÔNG TY): anh làm gì ở công ty — Giám đốc, Kế toán, Thủ kho...
--   Dùng để gắn vào bước quy trình và gợi ý phân công.

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,              -- "admin", "custom_xxx" — định danh ổn định
  name TEXT NOT NULL,                     -- "Quản trị viên", "Thủ kho kho A"
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,   -- 1 = vai trò hệ thống mặc định, không xoá
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

-- Seed 8 vai trò hệ thống từ SPEC §5.
INSERT INTO roles (id, code, name, description, is_system) VALUES
  (lower(hex(randomblob(16))), 'admin', 'Quản trị viên', 'Toàn quyền hệ thống', 1),
  (lower(hex(randomblob(16))), 'process_owner', 'Chủ quy trình', 'Quản lý quy trình, xử lý ngoại lệ', 1),
  (lower(hex(randomblob(16))), 'editor', 'Soạn thảo', 'Tạo và sửa bản nháp quy trình', 1),
  (lower(hex(randomblob(16))), 'reviewer', 'Thẩm định', 'Thẩm định và góp ý quy trình', 1),
  (lower(hex(randomblob(16))), 'approver', 'Phê duyệt', 'Phê duyệt và phát hành quy trình', 1),
  (lower(hex(randomblob(16))), 'executor', 'Thực hiện', 'Thực hiện công việc theo lượt', 1),
  (lower(hex(randomblob(16))), 'monitor', 'Giám sát', 'Giám sát, quản lý lượt và ngoại lệ', 1),
  (lower(hex(randomblob(16))), 'viewer', 'Xem', 'Chỉ xem báo cáo', 1);

-- Gán quyền cho từng vai trò hệ thống.
INSERT INTO role_permissions (role_id, permission)
SELECT id, '*' FROM roles WHERE code = 'admin';

INSERT INTO role_permissions (role_id, permission)
SELECT id, p FROM roles, (VALUES ('processes.manage'), ('processes.review'), ('exceptions.handle'), ('reports.view')) AS v(p)
WHERE code = 'process_owner';

INSERT INTO role_permissions (role_id, permission)
SELECT id, 'processes.manage' FROM roles WHERE code = 'editor';

INSERT INTO role_permissions (role_id, permission)
SELECT id, p FROM roles, (VALUES ('processes.review'), ('reports.view')) AS v(p)
WHERE code = 'reviewer';

INSERT INTO role_permissions (role_id, permission)
SELECT id, p FROM roles, (VALUES ('processes.approve'), ('exceptions.handle'), ('reports.view')) AS v(p)
WHERE code = 'approver';

INSERT INTO role_permissions (role_id, permission)
SELECT id, p FROM roles, (VALUES ('executions.perform'), ('reports.view')) AS v(p)
WHERE code = 'executor';

INSERT INTO role_permissions (role_id, permission)
SELECT id, p FROM roles, (VALUES ('executions.perform'), ('executions.manage'), ('exceptions.handle'), ('reports.view'), ('audit.view')) AS v(p)
WHERE code = 'monitor';

INSERT INTO role_permissions (role_id, permission)
SELECT id, 'reports.view' FROM roles WHERE code = 'viewer';

-- Bỏ CHECK constraint cũ của user_roles để chấp nhận vai trò tuỳ chỉnh.
-- SQLite không DROP CONSTRAINT được → tạo bảng mới, copy dữ liệu, đổi tên.
CREATE TABLE user_roles_new (
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  PRIMARY KEY (user_id, role)
);
INSERT INTO user_roles_new (user_id, role, created_at, created_by)
SELECT user_id, role, created_at, created_by FROM user_roles;
DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;
