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

/** POST /api/v1/admin/seed-test-data — Tạo 50 dữ liệu test (chỉ admin). TẠM THỜI. */
export async function handleSeedTestData(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as unknown as { user: { id: string }; permissions: string[] };
  if (!me.permissions.includes("*")) {
    return apiError("FORBIDDEN", "Chỉ admin mới được tạo dữ liệu test.", ctx.requestId);
  }
  const db = ctx.env.sop_demo_db;

  // Lấy processes có version ACTIVE.
  const procs = await db.prepare(
    `SELECT p.id, p.code, p.name FROM processes p
     JOIN process_versions pv ON pv.process_id = p.id AND pv.status = 'ACTIVE'
     LIMIT 5`
  ).all<{ id: string; code: string; name: string }>();
  const procList = procs.results ?? [];
  if (procList.length === 0) {
    return apiError("VALIDATION_ERROR", "Chưa có quy trình nào đang hiệu lực.", ctx.requestId);
  }

  // Lấy users.
  const users = await db.prepare(`SELECT id, display_name FROM users WHERE is_active = 1 LIMIT 10`)
    .all<{ id: string; display_name: string }>();
  const userList = users.results ?? [];
  if (userList.length === 0) {
    return apiError("VALIDATION_ERROR", "Chưa có user nào.", ctx.requestId);
  }

  // Lấy version ACTIVE và steps cho từng process.
  const procData: { proc: { id: string; code: string; name: string }; versionId: string; steps: { id: string }[] }[] = [];
  for (const p of procList) {
    const v = await db.prepare(
      `SELECT id FROM process_versions WHERE process_id = ? AND status = 'ACTIVE' LIMIT 1`
    ).bind(p.id).first<{ id: string }>();
    if (!v) continue;
    const st = await db.prepare(`SELECT id FROM process_steps WHERE version_id = ? ORDER BY sort_order`)
      .bind(v.id).all<{ id: string }>();
    procData.push({ proc: p, versionId: v.id, steps: st.results ?? [] });
  }

  const shifts = ["MORNING", "AFTERNOON", "NIGHT", null, null];
  const statuses = ["COMPLETED", "COMPLETED", "COMPLETED", "IN_PROGRESS", "IN_PROGRESS", "CREATED", "PENDING_CONFIRMATION", "CANCELLED"];
  const now = new Date();
  let created = 0;

  for (let i = 0; i < 50; i++) {
    const pd = procData[i % procData.length];
    const user = userList[i % userList.length];
    // Ngày ngẫu nhiên trong 30 ngày qua.
    const daysAgo = Math.floor(Math.random() * 30);
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    const dateStr = d.toISOString().slice(0, 10);
    const datePart = dateStr.replace(/-/g, "");
    const status = statuses[i % statuses.length];
    const shift = shifts[i % shifts.length];

    const execId = crypto.randomUUID();
    const code = `EXE-${datePart}-${String(created + 1).padStart(3, "0")}`;
    const createdAt = `${dateStr}T${String(8 + (i % 10)).padStart(2, "0")}:00:00.000Z`;
    const startedAt = status !== "CREATED" ? createdAt : null;
    const completedAt = status === "COMPLETED" ? `${dateStr}T${String(10 + (i % 8)).padStart(2, "0")}:30:00.000Z` : null;

    await db.prepare(
      `INSERT INTO executions (id, code, process_id, version_id, title, assignee_id, creator_id, created_by,
        execution_date, execution_time, shift, status, created_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      execId, code, pd.proc.id, pd.versionId,
      `Test ${pd.proc.name} #${i + 1}`,
      user.id, me.user.id, me.user.id,
      dateStr, "08:00", shift, status, createdAt, startedAt, completedAt
    ).run();

    // Tạo steps snapshot đơn giản.
    for (let si = 0; si < pd.steps.length; si++) {
      const stepStatus = status === "COMPLETED" ? "DONE" : status === "IN_PROGRESS" && si < 2 ? "DONE" : "NOT_STARTED";
      await db.prepare(
        `INSERT INTO execution_steps (id, execution_id, step_id, sort_order, status)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), execId, pd.steps[si].id, si, stepStatus).run();
    }
    created++;
  }

  return ok({ created });
}
