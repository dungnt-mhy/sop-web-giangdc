// routes/org_units.ts — Quản lý đơn vị tổ chức (khu vực, chi nhánh, cửa hàng, kho).

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission } from "./auth";
import type { Ctx } from "./context";

type OrgUnitRow = {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  description: string | null;
  created_at: string;
};

export const ORG_UNIT_TYPES = ["REGION", "BRANCH", "STORE", "WAREHOUSE"] as const;

export const ORG_UNIT_TYPE_LABELS: Record<string, string> = {
  REGION: "Khu vực",
  BRANCH: "Chi nhánh",
  STORE: "Cửa hàng",
  WAREHOUSE: "Kho",
};

function toPublicUnit(r: OrgUnitRow, parentName?: string | null) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    type_label: ORG_UNIT_TYPE_LABELS[r.type] ?? r.type,
    parent_id: r.parent_id,
    parent_name: parentName ?? null,
    description: r.description,
    created_at: r.created_at,
  };
}

/** GET /org-units — danh sách đơn vị. */
export async function handleListOrgUnits(ctx: Ctx) {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const rows = await db.prepare(`SELECT * FROM org_units ORDER BY type ASC, name ASC`).all<OrgUnitRow>();
  const items = [];
  for (const r of rows.results ?? []) {
    let parentName: string | null = null;
    if (r.parent_id) {
      const p = await db.prepare(`SELECT name FROM org_units WHERE id = ?`).bind(r.parent_id).first<{ name: string }>();
      parentName = p?.name ?? null;
    }
    items.push(toPublicUnit(r, parentName));
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
  const type = typeof body?.type === "string" ? body.type.trim().toUpperCase() : "BRANCH";
  const parentId = typeof body?.parent_id === "string" && body.parent_id ? body.parent_id : null;
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  if (!name) return apiError("VALIDATION_ERROR", "Thiếu tên đơn vị.", ctx.requestId);
  if (!(ORG_UNIT_TYPES as readonly string[]).includes(type)) {
    return apiError("VALIDATION_ERROR", "Loại đơn vị không hợp lệ.", ctx.requestId);
  }
  if (parentId) {
    const p = await db.prepare(`SELECT id FROM org_units WHERE id = ?`).bind(parentId).first();
    if (!p) return apiError("VALIDATION_ERROR", "Đơn vị cha không tồn tại.", ctx.requestId);
  }

  const id = newId();
  await db.prepare(`INSERT INTO org_units (id, name, type, parent_id, description, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, name, type, parentId, description, nowIso(), me.user.id).run();

  await audit(db, { event_type: "ORG_UNIT_CREATED", actor_id: me.user.id, object_type: "org_unit", object_id: id, request_id: ctx.requestId });
  const row = await db.prepare(`SELECT * FROM org_units WHERE id = ?`).bind(id).first<OrgUnitRow>();
  return ok(toPublicUnit(row!), 201);
}

/** PATCH /org-units/{id} — sửa đơn vị. */
export async function handleUpdateOrgUnit(ctx: Ctx, id: string) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;

  const updates: string[] = [];
  const binds: unknown[] = [];
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
  if (body?.description !== undefined) {
    updates.push("description = ?");
    binds.push(typeof body.description === "string" ? body.description.trim() || null : null);
  }
  if (updates.length === 0) return apiError("VALIDATION_ERROR", "Không có gì để cập nhật.", ctx.requestId);

  const exists = await db.prepare(`SELECT id FROM org_units WHERE id = ?`).bind(id).first();
  if (!exists) return apiError("NOT_FOUND", "Không tìm thấy đơn vị.", ctx.requestId);

  await db.prepare(`UPDATE org_units SET ${updates.join(", ")} WHERE id = ?`).bind(...binds, id).run();
  await audit(db, { event_type: "ORG_UNIT_UPDATED", actor_id: me.user.id, object_type: "org_unit", object_id: id, request_id: ctx.requestId });
  const row = await db.prepare(`SELECT * FROM org_units WHERE id = ?`).bind(id).first<OrgUnitRow>();
  return ok(toPublicUnit(row!));
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
