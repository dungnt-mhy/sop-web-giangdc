-- 0024_reactivation_approval.sql — Duyệt kích hoạt lại phiên bản đã ngừng.
ALTER TABLE process_versions ADD COLUMN reactivation_status TEXT;
ALTER TABLE process_versions ADD COLUMN reactivation_requested_by TEXT REFERENCES users(id);
ALTER TABLE process_versions ADD COLUMN reactivation_requested_at TEXT;
ALTER TABLE process_versions ADD COLUMN reactivation_reviewed_by TEXT REFERENCES users(id);
ALTER TABLE process_versions ADD COLUMN reactivation_reviewed_at TEXT;
ALTER TABLE process_versions ADD COLUMN reactivation_reject_reason TEXT;
