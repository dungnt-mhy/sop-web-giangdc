-- 0047: Mở rộng đề xuất lượt — nhiều người duyệt (tối đa 2), giám sát lượt,
-- và phân công theo từng bước (người làm + giám sát/duyệt bước).
CREATE TABLE IF NOT EXISTS proposal_approvers (
  proposal_id TEXT NOT NULL REFERENCES execution_proposals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (proposal_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_proposal_approvers_user ON proposal_approvers(user_id);

-- Chi tiết bổ sung dạng JSON: { supervisor_ids: string[],
--   steps: [{ process_step_id, assignee_ids: string[], supervisor_ids: string[] }] }
ALTER TABLE execution_proposals ADD COLUMN detail TEXT;
