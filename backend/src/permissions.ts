// permissions.ts — ma trận vai trò hệ thống → quyền thao tác (SPEC §5).
//
// Hai khái niệm tách bạch theo SPEC:
// - Vai trò HỆ THỐNG (bảng user_roles): cấp quyền thao tác — admin, process_owner, ...
// - Vai trò NGHIỆPVỤ (UserBusinessRole): trách nhiệm trong từng bước (Thủ kho, Bảo vệ...)
//   — thuộc Task sau, KHÔNG lẫn với bảng này.
//
// Backend kiểm tra quyền trên mọi API, không tin client (SPEC §5).

export const SYSTEM_ROLES = [
  "admin",
  "process_owner",
  "editor",
  "reviewer",
  "approver",
  "executor",
  "monitor",
  "viewer",
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Nhãn tiếng Việt hiển thị trên giao diện. */
export const ROLE_LABELS: Record<SystemRole, string> = {
  admin: "Quản trị viên",
  process_owner: "Chủ quy trình",
  editor: "Soạn thảo",
  reviewer: "Thẩm định",
  approver: "Phê duyệt",
  executor: "Thực hiện",
  monitor: "Giám sát",
  viewer: "Xem",
};

/**
 * Ma trận quyền rút gọn từ SPEC §5 (Task 1.2 chỉ thực thi `users.manage`;
 * các quyền còn lại được định nghĩa sẵn để các task sau dùng chung).
 */
export const ROLE_PERMISSIONS: Record<SystemRole, string[]> = {
  // Quản lý tài khoản/quyền; admin có mọi quyền ("*" bao phủ tất cả).
  admin: ["*"],
  // Tạo/sửa bản nháp/gửi thẩm định/xác nhận thẩm định/xử lý ngoại lệ/xem báo cáo.
  process_owner: [
    "processes.manage",
    "processes.review",
    "exceptions.handle",
    "reports.view",
  ],
  // Tạo/sửa bản nháp/gửi thẩm định.
  editor: ["processes.manage"],
  // Góp ý bản nháp/xác nhận thẩm định/xem báo cáo.
  reviewer: ["processes.review", "reports.view"],
  // Phê duyệt/phát hành, xử lý ngoại lệ theo ngưỡng.
  approver: ["processes.approve", "exceptions.handle", "reports.view"],
  // Tạo/nhận lượt, hoàn thành bước, xem báo cáo của mình (KHÔNG được tạo lượt trực tiếp).
  executor: ["executions.perform", "executions.view", "reports.view"],
  // Tạo lượt cho đơn vị mình, bỏ qua/mở lại/huỷ, xử lý ngoại lệ, xem báo cáo/audit theo quyền.
  monitor: [
    "executions.create",
    "executions.perform",
    "executions.manage",
    "exceptions.handle",
    "reports.view",
    "audit.view",
  ],
  // Chỉ xem báo cáo trong phạm vi.
  viewer: ["reports.view"],
};

/** Gộp quyền của nhiều vai trò thành danh sách duy nhất (đã sắp xếp). */
export function permissionsForRoles(roles: string[]): string[] {
  const set = new Set<string>();
  for (const r of roles) {
    const perms = ROLE_PERMISSIONS[r as SystemRole];
    if (perms) for (const p of perms) set.add(p);
  }
  return [...set].sort();
}

/** Kiểm tra một quyền; "admin" (dấu *) vượt qua mọi kiểm tra. */
export function hasPermission(permissions: string[], required: string): boolean {
  return permissions.includes("*") || permissions.includes(required);
}

export function isValidRole(role: string): role is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(role);
}
