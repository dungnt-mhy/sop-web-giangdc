-- 0026_step_redo_tracking.sql — Lưu vết yêu cầu làm lại bước.
ALTER TABLE execution_steps ADD COLUMN redo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execution_steps ADD COLUMN redo_reason TEXT;
ALTER TABLE execution_steps ADD COLUMN redo_by TEXT REFERENCES users(id);
ALTER TABLE execution_steps ADD COLUMN redo_at TEXT;
