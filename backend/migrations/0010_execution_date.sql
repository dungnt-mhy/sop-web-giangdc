-- 0010_execution_date.sql — Bổ sung ngày thực hiện bắt buộc cho lượt công việc.
-- Khách hàng yêu cầu: mỗi lượt công việc phải có ngày thực hiện.

ALTER TABLE executions ADD COLUMN execution_date TEXT;

-- Dữ liệu cũ: lấy ngày tạo làm ngày thực hiện.
UPDATE executions SET execution_date = substr(created_at, 1, 10) WHERE execution_date IS NULL;
