-- 0001_init.sql — Migration D1 khởi tạo tối thiểu (Task 01).
-- Quy ước: forward-only — không sửa file đã áp dụng, thay đổi mới viết file 0002_*.sql.
-- Task 01 chưa có bảng nghiệp vụ; chỉ tạo bảng meta để kiểm chứng pipeline migration.

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '0001');
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('seeded_at', '');
