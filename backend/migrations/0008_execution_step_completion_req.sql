-- 0008_execution_step_completion_req.sql — Bổ sung completion_req vào snapshot bước.
-- Phục vụ EXE-007: chặn hoàn thành bước khi thiếu yêu cầu bắt buộc (ảnh/tệp).

ALTER TABLE execution_steps ADD COLUMN completion_req TEXT;
