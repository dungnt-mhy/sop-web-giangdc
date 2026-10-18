-- 0022_org_units_full.sql — Bổ sung thông tin đầy đủ cho đơn vị tổ chức.
ALTER TABLE org_units ADD COLUMN code TEXT;
ALTER TABLE org_units ADD COLUMN address TEXT;
ALTER TABLE org_units ADD COLUMN phone TEXT;
ALTER TABLE org_units ADD COLUMN email TEXT;
ALTER TABLE org_units ADD COLUMN manager_id TEXT REFERENCES users(id);
ALTER TABLE org_units ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_org_units_status ON org_units(status);
