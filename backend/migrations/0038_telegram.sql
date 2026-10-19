-- 0038_telegram.sql — Liên kết Telegram để gửi thông báo (Task Telegram).
-- Thêm telegram_chat_id vào users; NULL = chưa liên kết.

ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_chat_id);
