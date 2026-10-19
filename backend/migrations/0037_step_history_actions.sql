-- 0037: Mở rộng action cho lịch sử bước (thêm phân công, ghi chú...).
-- SQLite không sửa được CHECK trực tiếp → tạo lại bảng.

CREATE TABLE execution_step_history_new (
  id               TEXT PRIMARY KEY,
  execution_id     TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  step_id          TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  action           TEXT NOT NULL CHECK (action IN ('STARTED','REPORTED','APPROVED','REJECTED','ASSIGNED','NOTE_UPDATED','SKIPPED','SKIP_REQUESTED','SKIP_APPROVED','SKIP_REJECTED')),
  actor_id         TEXT REFERENCES users(id),
  reason           TEXT,
  created_at       TEXT NOT NULL
);

INSERT INTO execution_step_history_new (id, execution_id, step_id, action, actor_id, reason, created_at)
SELECT id, execution_id, step_id, action, actor_id, reason, created_at FROM execution_step_history;

DROP TABLE execution_step_history;
ALTER TABLE execution_step_history_new RENAME TO execution_step_history;
CREATE INDEX IF NOT EXISTS idx_step_hist_step ON execution_step_history(step_id, created_at);
