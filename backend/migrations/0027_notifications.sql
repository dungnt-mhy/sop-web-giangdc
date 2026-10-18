-- 0027_notifications.sql — Bảng thông báo trong app.
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,  -- VD: EXECUTION_REPORTED, EXECUTION_CONFIRMED, EXECUTION_REJECTED, ...
  title      TEXT NOT NULL,
  message    TEXT,
  link       TEXT,           -- VD: #/executions/abc123 để bấm vào đi tới
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);
