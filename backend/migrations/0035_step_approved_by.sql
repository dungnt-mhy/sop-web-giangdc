-- 0035: Lưu vết người duyệt bước.
ALTER TABLE execution_steps ADD COLUMN approved_by TEXT REFERENCES users(id);
ALTER TABLE execution_steps ADD COLUMN approved_at TEXT;
