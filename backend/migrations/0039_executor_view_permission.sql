-- 0039_executor_view_permission.sql — Bổ sung quyền xem cho role Thực hiện.
-- Bug 2026-10-19: nhân viên (executor) không xem được bằng chứng vì thiếu quyền executions.view.

INSERT INTO role_permissions (role_id, permission)
SELECT id, 'executions.view' FROM roles WHERE code = 'executor'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  WHERE r.code = 'executor' AND rp.permission = 'executions.view'
);
