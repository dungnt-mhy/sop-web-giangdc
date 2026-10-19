-- 0042: Bảng đề xuất lượt công việc (nhân viên đề xuất → người phê duyệt duyệt 1 chạm → tạo lượt).
CREATE TABLE IF NOT EXISTS execution_proposals (
  id TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id),
  title TEXT,
  reason TEXT NOT NULL,
  proposer_id TEXT NOT NULL REFERENCES users(id),
  approver_id TEXT NOT NULL REFERENCES users(id),
  expected_start_at TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reject_reason TEXT,
  execution_id TEXT REFERENCES executions(id),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON execution_proposals(proposer_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_approver ON execution_proposals(approver_id, status);
