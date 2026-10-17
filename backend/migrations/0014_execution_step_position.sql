-- 0014_execution_step_position.sql — Snapshot chức vụ vào bước thực hiện.
ALTER TABLE execution_steps ADD COLUMN position_id TEXT REFERENCES positions(id);
