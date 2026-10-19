-- 0034: Thêm trạng thái PENDING_REVIEW cho bước (chờ giám sát duyệt).

CREATE TABLE execution_steps_new (
  id                 TEXT PRIMARY KEY,
  execution_id       TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL,
  code               TEXT NOT NULL,
  title              TEXT NOT NULL,
  instruction        TEXT,
  role               TEXT,
  is_required        INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'NOT_STARTED'
                     CHECK (status IN ('NOT_STARTED','IN_PROGRESS','PENDING_REVIEW','PASSED','FAILED','SKIPPED','CANCELLED')),
  completed_by       TEXT REFERENCES users(id),
  completed_at       TEXT,
  note               TEXT,
  skip_reason        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  completion_req     TEXT,
  position_id        TEXT REFERENCES positions(id),
  prerequisite       TEXT,
  input_desc         TEXT,
  expected_result    TEXT,
  output_desc        TEXT,
  target_duration_min INTEGER,
  warning            TEXT,
  skip_policy        TEXT,
  failure_policy     TEXT,
  redo_count         INTEGER NOT NULL DEFAULT 0,
  redo_reason        TEXT,
  redo_by            TEXT REFERENCES users(id),
  redo_at            TEXT,
  UNIQUE (execution_id, sort_order),
  UNIQUE (execution_id, code)
);

INSERT INTO execution_steps_new
  (id, execution_id, sort_order, code, title, instruction, role, is_required, status,
   completed_by, completed_at, note, skip_reason, created_at, updated_at,
   completion_req, position_id, prerequisite, input_desc, expected_result, output_desc,
   target_duration_min, warning, skip_policy, failure_policy,
   redo_count, redo_reason, redo_by, redo_at)
SELECT
  id, execution_id, sort_order, code, title, instruction, role, is_required, status,
  completed_by, completed_at, note, skip_reason, created_at, updated_at,
  completion_req, position_id, prerequisite, input_desc, expected_result, output_desc,
  target_duration_min, warning, skip_policy, failure_policy,
  redo_count, redo_reason, redo_by, redo_at
FROM execution_steps;

DROP TABLE execution_steps;
ALTER TABLE execution_steps_new RENAME TO execution_steps;
CREATE INDEX IF NOT EXISTS idx_exstep_exec ON execution_steps(execution_id, sort_order);
