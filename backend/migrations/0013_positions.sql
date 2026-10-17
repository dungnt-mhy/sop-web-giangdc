-- 0013_positions.sql — Bảng chức vụ dùng chung cho nhân viên và bước quy trình.
-- Luồng: bước quy trình gắn chức vụ (VD: Kế toán) → khi phân công ở lượt,
-- hệ thống ưu tiên gợi ý người có đúng chức vụ đó.

CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT REFERENCES users(id)
);

-- Thêm FK vào users và process_steps (giữ cột text cũ để không mất dữ liệu).
ALTER TABLE users ADD COLUMN position_id TEXT REFERENCES positions(id);
ALTER TABLE process_steps ADD COLUMN position_id TEXT REFERENCES positions(id);

-- Chuyển đổi dữ liệu text cũ sang bảng mới (distinct, chuẩn hoá).
INSERT INTO positions (id, name)
SELECT lower(hex(randomblob(16))), name FROM (
  SELECT DISTINCT trim(position) AS name FROM users WHERE position IS NOT NULL AND trim(position) != ''
  UNION
  SELECT DISTINCT trim(role) AS name FROM process_steps WHERE role IS NOT NULL AND trim(role) != ''
);

UPDATE users SET position_id = (SELECT id FROM positions WHERE positions.name = trim(users.position))
WHERE position IS NOT NULL AND trim(position) != '';

UPDATE process_steps SET position_id = (SELECT id FROM positions WHERE positions.name = trim(process_steps.role))
WHERE role IS NOT NULL AND trim(role) != '';
