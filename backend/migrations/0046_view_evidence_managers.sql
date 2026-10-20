-- 0046: Cấp quyền xem lượt/bằng chứng (executions.view) cho các vai trò quản lý:
-- Giám sát, Phê duyệt, Chủ quy trình — để mở được trang Bằng chứng và xem theo phạm vi.
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'executions.view' FROM roles WHERE code IN ('monitor', 'approver', 'process_owner')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = roles.id AND rp.permission = 'executions.view'
  );
