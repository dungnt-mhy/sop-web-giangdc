-- 0021_org_units.sql — Bảng đơn vị tổ chức (khu vực, chi nhánh, cửa hàng, kho).
CREATE TABLE IF NOT EXISTS org_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'BRANCH',
  parent_id TEXT REFERENCES org_units(id),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_type ON org_units(type);

-- Bảng liên kết quy trình - đơn vị áp dụng (chọn nhiều).
CREATE TABLE IF NOT EXISTS process_org_units (
  process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  org_unit_id TEXT NOT NULL REFERENCES org_units(id),
  PRIMARY KEY (process_id, org_unit_id)
);
