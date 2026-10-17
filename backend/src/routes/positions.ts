// routes/positions.ts — Quản lý danh mục chức vụ (dùng chung cho nhân viên và bước quy trình).

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission } from "./auth";
import type { Ctx } from "./context";

type PositionRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

/** GET /positions — danh sách chức vụ. */
export async function handleListPositions(ctx: Ctx) {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const rows = await db.prepare(`SELECT * FROM positions ORDER BY name ASC`).all<PositionRow>();
  return ok({ items: rows.results ?? [], total: (rows.results ?? []).length });
}

/** POST /positions — tạo chức vụ mới. */
export async function handleCreatePosition(ctx: Ctx) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  if (!name) return apiError("VALIDATION_ERROR", "Thiếu tên chức vụ.", ctx.requestId);

  const exists = await db.prepare(`SELECT id FROM positions WHERE name = ?`).bind(name).first();
  if (exists) return apiError("VALIDATION_ERROR", "Chức vụ đã tồn tại.", ctx.requestId);

  const id = newId();
  await db.prepare(`INSERT INTO positions (id, name, description, created_at, created_by) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, name, description, nowIso(), me.user.id).run();

  await audit(db, { event_type: "POSITION_CREATED", actor_id: me.user.id, object_type: "position", object_id: id, request_id: ctx.requestId });
  const row = await db.prepare(`SELECT * FROM positions WHERE id = ?`).bind(id).first<PositionRow>();
  return ok(row, 201);
}

/** PATCH /positions/{id} — sửa chức vụ. */
export async function handleUpdatePosition(ctx: Ctx, id: string) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;

  const updates: string[] = [];
  const binds: unknown[] = [];
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError("VALIDATION_ERROR", "Tên chức vụ không được trống.", ctx.requestId);
    const dup = await db.prepare(`SELECT id FROM positions WHERE name = ? AND id != ?`).bind(name, id).first();
    if (dup) return apiError("VALIDATION_ERROR", "Chức vụ đã tồn tại.", ctx.requestId);
    updates.push("name = ?");
    binds.push(name);
  }
  if (body?.description !== undefined) {
    const d = typeof body.description === "string" ? body.description.trim() || null : null;
    updates.push("description = ?");
    binds.push(d);
  }
  if (updates.length === 0) return apiError("VALIDATION_ERROR", "Không có gì để cập nhật.", ctx.requestId);
  binds.push(id);
  const r = await db.prepare(`UPDATE positions SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
  if (r.meta.changes === 0) return apiError("NOT_FOUND", "Không tìm thấy chức vụ.", ctx.requestId);

  await audit(db, { event_type: "POSITION_UPDATED", actor_id: me.user.id, object_type: "position", object_id: id, request_id: ctx.requestId });
  const row = await db.prepare(`SELECT * FROM positions WHERE id = ?`).bind(id).first<PositionRow>();
  return ok(row);
}

/** DELETE /positions/{id} — xoá chức vụ (chỉ khi chưa được dùng). */
export async function handleDeletePosition(ctx: Ctx, id: string) {
  const me = await requirePermission(ctx, "users.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const usedUser = await db.prepare(`SELECT id FROM users WHERE position_id = ? LIMIT 1`).bind(id).first();
  const usedStep = await db.prepare(`SELECT id FROM process_steps WHERE position_id = ? LIMIT 1`).bind(id).first();
  if (usedUser || usedStep) {
    return apiError("VALIDATION_ERROR", "Chức vụ đang được sử dụng, không thể xoá.", ctx.requestId);
  }
  const r = await db.prepare(`DELETE FROM positions WHERE id = ?`).bind(id).run();
  if (r.meta.changes === 0) return apiError("NOT_FOUND", "Không tìm thấy chức vụ.", ctx.requestId);

  await audit(db, { event_type: "POSITION_DELETED", actor_id: me.user.id, object_type: "position", object_id: id, request_id: ctx.requestId });
  return ok({ deleted: true });
}
