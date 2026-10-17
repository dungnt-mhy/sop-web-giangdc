-- 0018_execution_step_details.sql — Snapshot đầy đủ chi tiết bước vào lượt thực hiện,
-- để người được phân công xem được toàn bộ thông tin cần làm.
ALTER TABLE execution_steps ADD COLUMN prerequisite TEXT;
ALTER TABLE execution_steps ADD COLUMN input_desc TEXT;
ALTER TABLE execution_steps ADD COLUMN expected_result TEXT;
ALTER TABLE execution_steps ADD COLUMN output_desc TEXT;
ALTER TABLE execution_steps ADD COLUMN target_duration_min INTEGER;
ALTER TABLE execution_steps ADD COLUMN warning TEXT;
