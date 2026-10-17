-- 0011_execution_time_shift.sql — Bổ sung giờ thực hiện và ca làm việc.
-- Ca: MORNING (sáng), NOON (trưa), AFTERNOON (chiều), NIGHT (đêm).

ALTER TABLE executions ADD COLUMN execution_time TEXT;
ALTER TABLE executions ADD COLUMN shift TEXT CHECK (shift IN ('MORNING', 'NOON', 'AFTERNOON', 'NIGHT'));
