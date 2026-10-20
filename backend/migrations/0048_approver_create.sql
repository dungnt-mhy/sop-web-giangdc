-- 0048: Cấp quyền executions.create cho vai trò approver (quản lý) —
-- quản lý phải tạo được lượt trực tiếp và duyệt đề xuất (duyệt = tạo lượt).
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'executions.create' FROM roles r
WHERE r.code = 'approver'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = 'executions.create'
  );
