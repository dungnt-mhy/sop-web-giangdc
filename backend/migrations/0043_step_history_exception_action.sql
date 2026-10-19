-- 0043: Thêm action ASSIGNED_EXCEPTION vào bảng execution_step_history (gán ngoại lệ khẩn cấp).
-- SQLite không sửa được CHECK constraint trực tiếp → tạo lại bảng.

CREATE TABLE execution_step_history_new (
  id               TEXT PRIMARY KEY,
  execution_id     TEXT NOT NULL REFERENCES executions(id),
  step_id          TEXT NOT NULL REFERENCES execution_steps(id),
  action           TEXT NOT NULL CHECK (action IN ('STARTED','REPORTED','APPROVED','REJECTED','ASSIGNED','ASSIGNED_EXCEPTION','NOTE_UPDATED','SKIPPED','SKIP_REQUESTED','SKIP_APPROVED','SKIP_REJECTED')),
  actor_id         TEXT REFERENCES users(id),
  reason           TEXT,
  created_at       TEXT NOT NULL
);
INSERT INTO execution_step_history_new SELECT * FROM execution_step_history;
DROP TABLE execution_step_history;
ALTER TABLE execution_step_history_new RENAME TO execution_step_history;
CREATE INDEX IF NOT EXISTS idx_step_history_step ON execution_step_history(step_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_step_history_exec ON execution_step_history(execution_id, created_at DESC);
