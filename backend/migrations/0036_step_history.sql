-- 0036: Lịch sử thao tác trên bước (báo hoàn thành, duyệt, yêu cầu làm lại...).
CREATE TABLE IF NOT EXISTS execution_step_history (
  id               TEXT PRIMARY KEY,
  execution_id     TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  step_id          TEXT NOT NULL REFERENCES execution_steps(id) ON DELETE CASCADE,
  action           TEXT NOT NULL CHECK (action IN ('REPORTED','APPROVED','REJECTED','STARTED','SKIPPED','SKIP_REQUESTED')),
  actor_id         TEXT REFERENCES users(id),
  reason           TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_hist_step ON execution_step_history(step_id, created_at);
