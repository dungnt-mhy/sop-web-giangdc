-- 0041: Tách quyền tạo lượt (executions.create) khỏi quyền thực hiện (executions.perform).
-- Nhân viên (executor): chỉ thực hiện bước, KHÔNG được tạo lượt trực tiếp (dùng Đề xuất).
-- Tổ trưởng/giám sát (monitor): được tạo lượt.
-- Admin: đã có '*' nên không cần thêm.

INSERT INTO role_permissions (role_id, permission)
SELECT id, 'executions.create' FROM roles WHERE code = 'monitor'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = roles.id AND rp.permission = 'executions.create'
  );
