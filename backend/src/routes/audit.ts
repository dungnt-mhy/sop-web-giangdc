import type { Ctx } from "./context";
import { ok, apiError } from "../errors.js";
import { requirePermission } from "./auth";

// GET /api/v1/audit — xem nhật ký audit (cần quyền audit.view).
export async function handleListAudit(ctx: Ctx): Promise<Response> {
  const s = requirePermission(ctx, "audit.view");
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const url = new URL(ctx.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
  const eventType = (url.searchParams.get("event_type") ?? "").trim();
  const objectType = (url.searchParams.get("object_type") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const fromDate = (url.searchParams.get("from_date") ?? "").trim();
  const toDate = (url.searchParams.get("to_date") ?? "").trim();
  const actorId = (url.searchParams.get("actor_id") ?? "").trim();

  const conds: string[] = [];
  const binds: unknown[] = [];
  if (eventType) { conds.push("a.event_type = ?"); binds.push(eventType); }
  if (objectType) { conds.push("a.object_type = ?"); binds.push(objectType); }
  if (q) { conds.push("(a.event_type LIKE ? OR u.display_name LIKE ?)"); binds.push(`%${q}%`, `%${q}%`); }
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) { conds.push("date(a.occurred_at) >= ?"); binds.push(fromDate); }
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) { conds.push("date(a.occurred_at) <= ?"); binds.push(toDate); }
  if (actorId) { conds.push("a.actor_id = ?"); binds.push(actorId); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db.prepare(
    `SELECT a.id, a.event_type, a.object_type, a.object_id, a.occurred_at,
            u.display_name AS actor_name, a.diff_json
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
     ${where} ORDER BY a.occurred_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();

  const totalR = await db.prepare(
    `SELECT COUNT(*) AS c FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ${where}`
  ).bind(...binds).first<{ c: number }>();

  return ok({ items: rows.results ?? [], total: totalR?.c ?? 0, limit, offset });
}

// GET /api/v1/audit/event-types — danh sách loại sự kiện (cho filter).
export async function handleAuditEventTypes(ctx: Ctx): Promise<Response> {
  const s = requirePermission(ctx, "audit.view");
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const rows = await db.prepare(
    `SELECT DISTINCT event_type FROM audit_events ORDER BY event_type`
  ).all<{ event_type: string }>();
  return ok({ items: (rows.results ?? []).map((r) => r.event_type) });
}

/** POST /api/v1/admin/clear-test-data — XOÁ TRẮNG dữ liệu test (chỉ admin). TẠM THỜI. */
export async function handleClearTestData(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as unknown as { user: { id: string }; permissions: string[] };
  // Chỉ admin tuyệt đối.
  if (!me.permissions.includes("*")) {
    return apiError("FORBIDDEN", "Chỉ admin mới được xoá dữ liệu.", ctx.requestId);
  }
  const db = ctx.env.sop_demo_db;
  // Xoá theo thứ tự FK.
  const tables = [
    "execution_step_assignees", "execution_step_positions", "execution_steps",
    "evidence", "exceptions", "notifications", "executions",
  ];
  for (const t of tables) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  return ok({ cleared: tables });
}
