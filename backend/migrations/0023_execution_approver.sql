-- 0023_execution_approver.sql — Người phê duyệt hoàn thành lượt công việc.
ALTER TABLE executions ADD COLUMN approver_id TEXT REFERENCES users(id);
ALTER TABLE executions ADD COLUMN approved_by TEXT REFERENCES users(id);
ALTER TABLE executions ADD COLUMN approved_at TEXT;
