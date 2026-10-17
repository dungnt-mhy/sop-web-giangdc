-- 0019_execution_step_policies.sql — Snapshot chính sách bỏ qua / xử lý lỗi vào lượt.
ALTER TABLE execution_steps ADD COLUMN skip_policy TEXT;
ALTER TABLE execution_steps ADD COLUMN failure_policy TEXT;
