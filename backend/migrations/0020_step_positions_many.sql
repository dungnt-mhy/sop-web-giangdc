-- 0020_step_positions_many.sql — Một bước có thể cần nhiều chức vụ (vai trò người thực hiện).
-- Chuyển từ process_steps.position_id (1-1) sang bảng trung gian (n-n).

CREATE TABLE process_step_positions (
  step_id TEXT NOT NULL REFERENCES process_steps(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  PRIMARY KEY (step_id, position_id)
);

CREATE TABLE execution_step_positions (
  execution_step_id TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  PRIMARY KEY (execution_step_id, position_id)
);

-- Chuyển dữ liệu cũ sang bảng mới.
INSERT INTO process_step_positions (step_id, position_id)
SELECT id, position_id FROM process_steps WHERE position_id IS NOT NULL;

INSERT INTO execution_step_positions (execution_step_id, position_id)
SELECT id, position_id FROM execution_steps WHERE position_id IS NOT NULL;
