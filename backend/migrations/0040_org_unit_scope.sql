-- 0040: Gán đơn vị công tác cho nhân viên + cấu hình phạm vi phê duyệt/tạo lượt.
-- users.org_unit_id: đơn vị công tác của nhân viên (1 nhân viên = 1 đơn vị).
-- org_units.approver_scope: phạm vi nhân viên được chọn người phê duyệt.
-- org_units.create_scope: phạm vi quản lý được tạo lượt.

ALTER TABLE users ADD COLUMN org_unit_id TEXT REFERENCES org_units(id);
CREATE INDEX IF NOT EXISTS idx_users_org_unit ON users(org_unit_id);

ALTER TABLE org_units ADD COLUMN approver_scope TEXT NOT NULL DEFAULT 'UP_HIERARCHY'
  CHECK (approver_scope IN ('SAME_UNIT', 'UP_HIERARCHY', 'DIRECT_MANAGER', 'ANY_APPROVER'));
ALTER TABLE org_units ADD COLUMN create_scope TEXT NOT NULL DEFAULT 'SELF_AND_CHILDREN'
  CHECK (create_scope IN ('SELF_ONLY', 'SELF_AND_CHILDREN', 'ANY'));
