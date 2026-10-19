// routes/org_units.ts — Quản lý đơn vị tổ chức (khu vực, chi nhánh, cửa hàng, kho).

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission } from "./auth";
import type { Ctx } from "./context";

type OrgUnitRow = {
  id: string;
  code: string | null;
  name: string;
  type: string;
  parent_id: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  manager_id: string | null;
  status: string;
  approver_scope: string | null;
  create_scope: string | null;
  created_at: string;
};

export const ORG_UNIT_TYPES = ["REGION", "BRANCH", "STORE", "WAREHOUSE"] as const;

export const ORG_UNIT_TYPE_LABELS: Record<string, string> = {
  REGION: "Khu vực",
  BRANCH: "Chi nhánh",
  STORE: "Cửa hàng",
  WAREHOUSE: "Kho",
};

function toPublicUnit(r: OrgUnitRow, parentName?: string | null, managerName?: string | null) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    type_label: ORG_UNIT_TYPE_LABELS[r.type] ?? r.type,
    parent_id: r.parent_id,
    parent_name: parentName ?? null,
    description: r.description,
    address: r.address,
    phone: r.phone,
    email: r.email,
    manager_id: r.manager_id,
    manager_name: managerName ?? null,
    status: r.status,
    status_label: r.status === "active" ? "Đang hoạt động" : "Ngừng hoạt động",
    approver_scope: r.approver_scope ?? "UP_HIERARCHY",
    create_scope: r.create_scope ?? "SELF_AND_CHILDREN",
    created_at: r.created_at,
  };
}

async function enrichUnit(db: D1Database, r: OrgUnitRow) {
  let parentName: string | null = null;
  let managerName: string | null = null;
  if (r.parent_id) {
    const p = await db.prepare(`SELECT name FROM org_units WHERE id = ?`).bind(r.parent_id).first<{ name: string }>();
    parentName = p?.name ?? null;
  }
  if (r.manager_id) {
    const m = await db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(r.manager_id).first<{ display_name: string }>();
    managerName = m?.display_name ?? null;
  }
  return toPublicUnit(r, parentName, managerName);
}

/** GET /org-units — danh sách đơn vị. */
export async function handleListOrgUnits(ctx: Ctx) {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const rows = await db.prepare(`SELECT * FROM org_units ORDER BY type ASC, name ASC`).all<OrgUnitRow>();
  const items = [];
  for (const r of rows.results ?? []) {
    items.push(await enrichUnit(db, r));
  }
  return ok({ items, total: items.length });
}

/** POST /org-units — tạo đơn vị mới. */
export async function handleCreateOrgUnit(ctx: Ctx) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() || null : null;
  const type = typeof body?.type === "string" ? body.type.trim().toUpperCase() : "BRANCH";
  const parentId = typeof body?.parent_id === "string" && body.parent_id ? body.parent_id : null;
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  const address = typeof body?.address === "string" ? body.address.trim() || null : null;
  const phone = typeof body?.phone === "string" ? body.phone.trim() || null : null;
  const email = typeof body?.email === "string" ? body.email.trim() || null : null;
  const managerId = typeof body?.manager_id === "string" && body.manager_id ? body.manager_id : null;
  const status = typeof body?.status === "string" && ["active", "inactive"].includes(body.status) ? body.status : "active";
  const approverScope = typeof body?.approver_scope === "string" &&
    ["SAME_UNIT", "UP_HIERARCHY", "DIRECT_MANAGER", "ANY_APPROVER"].includes(body.approver_scope)
    ? body.approver_scope : "UP_HIERARCHY";
  const createScope = typeof body?.create_scope === "string" &&
    ["SELF_ONLY", "SELF_AND_CHILDREN", "ANY"].includes(body.create_scope)
    ? body.create_scope : "SELF_AND_CHILDREN";
  if (!name) return apiError("VALIDATION_ERROR", "Thiếu tên đơn vị.", ctx.requestId);
  if (!(ORG_UNIT_TYPES as readonly string[]).includes(type)) {
    return apiError("VALIDATION_ERROR", "Loại đơn vị không hợp lệ.", ctx.requestId);
  }
  if (code) {
    const dup = await db.prepare(`SELECT id FROM org_units WHERE code = ?`).bind(code).first();
    if (dup) return apiError("VALIDATION_ERROR", "Mã đơn vị đã tồn tại.", ctx.requestId);
  }
  if (parentId) {
    const p = await db.prepare(`SELECT id FROM org_units WHERE id = ?`).bind(parentId).first();
    if (!p) return apiError("VALIDATION_ERROR", "Đơn vị cha không tồn tại.", ctx.requestId);
  }
  if (managerId) {
    const m = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(managerId).first();
    if (!m) return apiError("VALIDATION_ERROR", "Người quản lý không tồn tại.", ctx.requestId);
  }

  const id = newId();
  await db.prepare(`INSERT INTO org_units (id, code, name, type, parent_id, description, address, phone, email, manager_id, status, approver_scope, create_scope, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, code, name, type, parentId, description, address, phone, email, managerId, status, approverScope, createScope, nowIso(), me.user.id).run();

  await audit(db, { event_type: "ORG_UNIT_CREATED", actor_id: me.user.id, object_type: "org_unit", object_id: id, request_id: ctx.requestId });
  const row = await db.prepare(`SELECT * FROM org_units WHERE id = ?`).bind(id).first<OrgUnitRow>();
  return ok(await enrichUnit(db, row!), 201);
}

/** PATCH /org-units/{id} — sửa đơn vị. */
export async function handleUpdateOrgUnit(ctx: Ctx, id: string) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;

  const updates: string[] = [];
  const binds: unknown[] = [];
  if (body?.code !== undefined) {
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() || null : null;
    if (code) {
      const dup = await db.prepare(`SELECT id FROM org_units WHERE code = ? AND id != ?`).bind(code, id).first();
      if (dup) return apiError("VALIDATION_ERROR", "Mã đơn vị đã tồn tại.", ctx.requestId);
    }
    updates.push("code = ?");
    binds.push(code);
  }
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError("VALIDATION_ERROR", "Tên đơn vị không được trống.", ctx.requestId);
    updates.push("name = ?");
    binds.push(name);
  }
  if (body?.type !== undefined) {
    const type = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
    if (!(ORG_UNIT_TYPES as readonly string[]).includes(type)) {
      return apiError("VALIDATION_ERROR", "Loại đơn vị không hợp lệ.", ctx.requestId);
    }
    updates.push("type = ?");
    binds.push(type);
  }
  if (body?.parent_id !== undefined) {
    const parentId = typeof body.parent_id === "string" && body.parent_id ? body.parent_id : null;
    if (parentId === id) return apiError("VALIDATION_ERROR", "Đơn vị cha không thể là chính nó.", ctx.requestId);
    if (parentId) {
      const p = await db.prepare(`SELECT id FROM org_units WHERE id = ?`).bind(parentId).first();
      if (!p) return apiError("VALIDATION_ERROR", "Đơn vị cha không tồn tại.", ctx.requestId);
    }
    updates.push("parent_id = ?");
    binds.push(parentId);
  }
  for (const f of ["description", "address", "phone", "email"] as const) {
    if (body?.[f] !== undefined) {
      updates.push(`${f} = ?`);
      binds.push(typeof body[f] === "string" ? (body[f] as string).trim() || null : null);
    }
  }
  if (body?.manager_id !== undefined) {
    const managerId = typeof body.manager_id === "string" && body.manager_id ? body.manager_id : null;
    if (managerId) {
      const m = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(managerId).first();
      if (!m) return apiError("VALIDATION_ERROR", "Người quản lý không tồn tại.", ctx.requestId);
    }
    updates.push("manager_id = ?");
    binds.push(managerId);
  }
  if (body?.status !== undefined) {
    const status = typeof body.status === "string" ? body.status : "";
    if (!["active", "inactive"].includes(status)) return apiError("VALIDATION_ERROR", "Trạng thái không hợp lệ.", ctx.requestId);
    updates.push("status = ?");
    binds.push(status);
  }
  if (body?.approver_scope !== undefined) {
    const s = typeof body.approver_scope === "string" ? body.approver_scope : "";
    if (!["SAME_UNIT", "UP_HIERARCHY", "DIRECT_MANAGER", "ANY_APPROVER"].includes(s)) {
      return apiError("VALIDATION_ERROR", "Phạm vi phê duyệt không hợp lệ.", ctx.requestId);
    }
    updates.push("approver_scope = ?");
    binds.push(s);
  }
  if (body?.create_scope !== undefined) {
    const s = typeof body.create_scope === "string" ? body.create_scope : "";
    if (!["SELF_ONLY", "SELF_AND_CHILDREN", "ANY"].includes(s)) {
      return apiError("VALIDATION_ERROR", "Phạm vi tạo lượt không hợp lệ.", ctx.requestId);
    }
    updates.push("create_scope = ?");
    binds.push(s);
  }
  if (updates.length === 0) return apiError("VALIDATION_ERROR", "Không có gì để cập nhật.", ctx.requestId);

  const exists = await db.prepare(`SELECT id FROM org_units WHERE id = ?`).bind(id).first();
  if (!exists) return apiError("NOT_FOUND", "Không tìm thấy đơn vị.", ctx.requestId);

  await db.prepare(`UPDATE org_units SET ${updates.join(", ")} WHERE id = ?`).bind(...binds, id).run();
  await audit(db, { event_type: "ORG_UNIT_UPDATED", actor_id: me.user.id, object_type: "org_unit", object_id: id, request_id: ctx.requestId });
  const row = await db.prepare(`SELECT * FROM org_units WHERE id = ?`).bind(id).first<OrgUnitRow>();
  return ok(await enrichUnit(db, row!));
}

/** DELETE /org-units/{id} — xóa đơn vị. */
export async function handleDeleteOrgUnit(ctx: Ctx, id: string) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const exists = await db.prepare(`SELECT id FROM org_units WHERE id = ?`).bind(id).first();
  if (!exists) return apiError("NOT_FOUND", "Không tìm thấy đơn vị.", ctx.requestId);

  const hasChildren = await db.prepare(`SELECT id FROM org_units WHERE parent_id = ? LIMIT 1`).bind(id).first();
  if (hasChildren) return apiError("VALIDATION_ERROR", "Không thể xóa đơn vị đang có đơn vị con.", ctx.requestId);

  const inUse = await db.prepare(`SELECT process_id FROM process_org_units WHERE org_unit_id = ? LIMIT 1`).bind(id).first();
  if (inUse) return apiError("VALIDATION_ERROR", "Không thể xóa đơn vị đang được dùng trong quy trình.", ctx.requestId);

  await db.prepare(`DELETE FROM org_units WHERE id = ?`).bind(id).run();
  await audit(db, { event_type: "ORG_UNIT_DELETED", actor_id: me.user.id, object_type: "org_unit", object_id: id, request_id: ctx.requestId });
  return ok({ deleted: true });
}
