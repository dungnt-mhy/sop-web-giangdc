-- 0017_execution_creator.sql — Người tạo lượt công việc (có thể khác người bấm nút tạo).
ALTER TABLE executions ADD COLUMN creator_id TEXT REFERENCES users(id);
-- Dữ liệu cũ: người tạo = người bấm nút (created_by).
UPDATE executions SET creator_id = created_by WHERE creator_id IS NULL;
