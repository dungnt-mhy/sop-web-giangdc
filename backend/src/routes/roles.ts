// routes/roles.ts — Quản lý vai trò ứng dụng (phân quyền).
//
// Phân biệt với positions (chức vụ công ty):
// - roles: ai được làm gì trong app — gán quyền qua checkbox.
// - positions: anh làm gì ở công ty — dùng để gắn bước và gợi ý phân công.

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission } from "./auth";
import type { Ctx } from "./context";

/** Danh mục quyền có sẵn trong hệ thống (để hiển thị checkbox). */
export const PERMISSION_CATALOG: { code: string; label: string; group: string }[] = [
  { code: "users.manage", label: "Quản lý tài khoản", group: "Quản trị" },
  { code: "processes.manage", label: "Quản lý quy trình (tạo/sửa)", group: "Quy trình" },
  { code: "processes.review", label: "Thẩm định quy trình", group: "Quy trình" },
  { code: "processes.approve", label: "Phê duyệt quy trình", group: "Quy trình" },
  { code: "executions.view", label: "Xem lượt công việc", group: "Thực hiện" },
  { code: "executions.perform", label: "Thực hiện công việc", group: "Thực hiện" },
  { code: "executions.create", label: "Tạo lượt công việc", group: "Thực hiện" },
  { code: "executions.manage", label: "Quản lý lượt thực hiện", group: "Thực hiện" },
  { code: "exceptions.handle", label: "Xử lý ngoại lệ", group: "Ngoại lệ" },
  { code: "reports.view", label: "Xem báo cáo", group: "Báo cáo" },
  { code: "audit.view", label: "Xem nhật ký", group: "Báo cáo" },
];

type RoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: number;
  created_at: string;
};

/** GET /roles — danh sách vai trò kèm quyền. */
export async function handleListRoles(ctx: Ctx) {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;

  const roles = await db.prepare(`SELECT * FROM roles ORDER BY is_system DESC, name ASC`).all<RoleRow>();
  const perms = await db.prepare(`SELECT role_id, permission FROM role_permissions`).all<{ role_id: string; permission: string }>();

  const permMap = new Map<string, string[]>();
  for (const p of perms.results ?? []) {
    if (!permMap.has(p.role_id)) permMap.set(p.role_id, []);
    permMap.get(p.role_id)!.push(p.permission);
  }

  const items = (roles.results ?? []).map((r) => ({
    ...r,
    is_system: r.is_system === 1,
    permissions: (permMap.get(r.id) ?? []).sort(),
  }));
  return ok({ items, total: items.length, catalog: PERMISSION_CATALOG });
}

/** POST /roles — tạo vai trò mới. */
export async function handleCreateRole(ctx: Ctx) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  const permissions = Array.isArray(body?.permissions) ? body.permissions.filter((p): p is string => typeof p === "string") : [];

  if (!name) return apiError("VALIDATION_ERROR", "Thiếu tên vai trò.", ctx.requestId);
  if (name.length > 100) return apiError("VALIDATION_ERROR", "Tên vai trò quá dài.", ctx.requestId);

  // Kiểm tra quyền hợp lệ.
  const validPerms = new Set(PERMISSION_CATALOG.map((p) => p.code));
  for (const p of permissions) {
    if (!validPerms.has(p) && p !== "*") {
      return apiError("VALIDATION_ERROR", `Quyền không hợp lệ: ${p}`, ctx.requestId);
    }
  }

  const code = "custom_" + newId().slice(0, 8);
  const id = newId();
  const stmts = [
    db.prepare(`INSERT INTO roles (id, code, name, description, is_system, created_at, created_by) VALUES (?, ?, ?, ?, 0, ?, ?)`)
      .bind(id, code, name, description, nowIso(), me.user.id),
  ];
  for (const p of permissions) {
    stmts.push(db.prepare(`INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`).bind(id, p));
  }
  await db.batch(stmts);

  await audit(db, { event_type: "ROLE_CREATED", actor_id: me.user.id, object_type: "role", object_id: id, request_id: ctx.requestId });
  return ok({ id, code, name, description, is_system: false, permissions: permissions.sort() }, 201);
}

/** PATCH /roles/{id} — sửa vai trò (đổi tên, mô tả, quyền). */
export async function handleUpdateRole(ctx: Ctx, id: string) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;

  const role = await db.prepare(`SELECT * FROM roles WHERE id = ?`).bind(id).first<RoleRow>();
  if (!role) return apiError("NOT_FOUND", "Không tìm thấy vai trò.", ctx.requestId);

  const updates: string[] = [];
  const binds: unknown[] = [];
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError("VALIDATION_ERROR", "Tên vai trò không được trống.", ctx.requestId);
    updates.push("name = ?");
    binds.push(name);
  }
  if (body?.description !== undefined) {
    const d = typeof body.description === "string" ? body.description.trim() || null : null;
    updates.push("description = ?");
    binds.push(d);
  }

  const stmts = [];
  if (updates.length > 0) {
    binds.push(id);
    stmts.push(db.prepare(`UPDATE roles SET ${updates.join(", ")} WHERE id = ?`).bind(...binds));
  }

  // Cập nhật quyền (cho cả vai trò hệ thống — admin có thể điều chỉnh).
  if (body?.permissions !== undefined) {
    if (!Array.isArray(body.permissions)) {
      return apiError("VALIDATION_ERROR", "Danh sách quyền không hợp lệ.", ctx.requestId);
    }
    const permissions = (body.permissions as unknown[]).filter((p): p is string => typeof p === "string");
    const validPerms = new Set(PERMISSION_CATALOG.map((p) => p.code));
    for (const p of permissions) {
      if (!validPerms.has(p) && p !== "*") {
        return apiError("VALIDATION_ERROR", `Quyền không hợp lệ: ${p}`, ctx.requestId);
      }
    }
    // Không cho phép gỡ quyền users.manage khỏi vai trò admin cuối cùng.
    if (role.code === "admin") {
      const adminCount = await db.prepare(
        `SELECT COUNT(DISTINCT ur.user_id) as n FROM user_roles ur WHERE ur.role = 'admin'`
      ).first<{ n: number }>();
      if ((adminCount?.n ?? 0) <= 1 && !permissions.includes("*") && !permissions.includes("users.manage")) {
        return apiError("VALIDATION_ERROR", "Không thể gỡ quyền quản lý khỏi vai trò admin cuối cùng.", ctx.requestId);
      }
    }
    stmts.push(db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).bind(id));
    for (const p of permissions) {
      stmts.push(db.prepare(`INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`).bind(id, p));
    }
  }

  if (stmts.length > 0) await db.batch(stmts);
  await audit(db, { event_type: "ROLE_UPDATED", actor_id: me.user.id, object_type: "role", object_id: id, request_id: ctx.requestId });

  const updated = await db.prepare(`SELECT * FROM roles WHERE id = ?`).bind(id).first<RoleRow>();
  const perms = await db.prepare(`SELECT permission FROM role_permissions WHERE role_id = ?`).bind(id).all<{ permission: string }>();
  return ok({
    ...updated,
    is_system: (updated?.is_system ?? 0) === 1,
    permissions: (perms.results ?? []).map((p) => p.permission).sort(),
  });
}

/** DELETE /roles/{id} — xoá vai trò tuỳ chỉnh (không xoá được vai trò hệ thống). */
export async function handleDeleteRole(ctx: Ctx, id: string) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const role = await db.prepare(`SELECT * FROM roles WHERE id = ?`).bind(id).first<RoleRow>();
  if (!role) return apiError("NOT_FOUND", "Không tìm thấy vai trò.", ctx.requestId);
  if (role.is_system === 1) {
    return apiError("VALIDATION_ERROR", "Không thể xoá vai trò hệ thống.", ctx.requestId);
  }

  const used = await db.prepare(`SELECT user_id FROM user_roles WHERE role = ? LIMIT 1`).bind(role.code).first();
  if (used) {
    return apiError("VALIDATION_ERROR", "Vai trò đang được gán cho người dùng, không thể xoá.", ctx.requestId);
  }

  await db.batch([
    db.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).bind(id),
    db.prepare(`DELETE FROM roles WHERE id = ?`).bind(id),
  ]);
  await audit(db, { event_type: "ROLE_DELETED", actor_id: me.user.id, object_type: "role", object_id: id, request_id: ctx.requestId });
  return ok({ deleted: true });
}
