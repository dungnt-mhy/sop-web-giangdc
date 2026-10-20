-- 0044: Thêm cột remember_me cho phiên đăng nhập ("Lưu đăng nhập" = 30 ngày).
ALTER TABLE user_sessions ADD COLUMN remember_me INTEGER NOT NULL DEFAULT 0;
