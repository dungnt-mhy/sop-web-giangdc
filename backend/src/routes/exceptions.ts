// routes/exceptions.ts — Quản lý ngoại lệ (SPEC §9.5).
// Vòng đời: OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED.

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission } from "./auth";
import type { Ctx } from "./context";

type ExceptionRow = {
  id: string;
  execution_id: string;
  execution_step_id: string | null;
  title: string;
  description: string;
  severity: string;
  status: string;
  created_by: string;
  created_at: string;
  assigned_to: string | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  close_note: string | null;
  closed_by: string | null;
  closed_at: string | null;
  updated_at: string | null;
};

function toPublic(e: ExceptionRow, extra?: Record<string, unknown>) {
  return {
    id: e.id,
    execution_id: e.execution_id,
    execution_step_id: e.execution_step_id,
    title: e.title,
    description: e.description,
    severity: e.severity,
    status: e.status,
    created_by: e.created_by,
    created_at: e.created_at,
    assigned_to: e.assigned_to,
    resolution: e.resolution,
    resolved_by: e.resolved_by,
    resolved_at: e.resolved_at,
    close_note: e.close_note,
    closed_by: e.closed_by,
    closed_at: e.closed_at,
    updated_at: e.updated_at,
    ...extra,
  };
}

const SEVERITY_LABELS: Record<string, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  CRITICAL: "Nghiêm trọng",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Mới",
  IN_PROGRESS: "Đang xử lý",
  RESOLVED: "Đã khắc phục",
  CLOSED: "Đã đóng",
};

/** POST /executions/{eid}/exceptions — tạo ngoại lệ mới. */
export async function handleCreateException(ctx: Ctx, execId: string) {
  const me = await requirePermission(ctx, "executions.execute");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const exec = await db.prepare(`SELECT id, status FROM executions WHERE id = ?`).bind(execId).first<{ id: string; status: string }>();
  if (!exec) return apiError("NOT_FOUND", "Không tìm thấy lượt công việc.", ctx.requestId);
  if (!["IN_PROGRESS", "PAUSED"].includes(exec.status)) {
    return apiError("VALIDATION_ERROR", "Chỉ tạo ngoại lệ khi lượt đang thực hiện.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const stepId = typeof body?.execution_step_id === "string" ? body.execution_step_id : null;
  const severity = typeof body?.severity === "string" ? body.severity.toUpperCase() : "MEDIUM";

  if (!title) return apiError("VALIDATION_ERROR", "Thiếu tiêu đề ngoại lệ.", ctx.requestId);
  if (!description) return apiError("VALIDATION_ERROR", "Thiếu mô tả sự cố.", ctx.requestId);
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)) {
    return apiError("VALIDATION_ERROR", "Mức độ không hợp lệ.", ctx.requestId);
  }
  if (stepId) {
    const st = await db.prepare(`SELECT id FROM execution_steps WHERE id = ? AND execution_id = ?`).bind(stepId, execId).first();
    if (!st) return apiError("VALIDATION_ERROR", "Bước không thuộc lượt này.", ctx.requestId);
  }

  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO exceptions (id, execution_id, execution_step_id, title, description, severity, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`
    )
    .bind(id, execId, stepId, title, description, severity, me.user.id, now)
    .run();

  await audit(db, {
    event_type: "EXCEPTION_CREATED",
    actor_id: me.user.id,
    object_type: "exception",
    object_id: id,
    request_id: ctx.requestId,
    diff: { execution_id: execId, step_id: stepId, severity },
  });

  const row = await db.prepare(`SELECT * FROM exceptions WHERE id = ?`).bind(id).first<ExceptionRow>();
  return ok(toPublic(row!), 201);
}

/** GET /executions/{eid}/exceptions — danh sách ngoại lệ của lượt. */
export async function handleListExceptions(ctx: Ctx, execId: string) {
  const me = await requirePermission(ctx, "executions.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const rows = await db
    .prepare(
      `SELECT ex.*, u.display_name as creator_name, es.code as step_code
       FROM exceptions ex
       LEFT JOIN users u ON u.id = ex.created_by
       LEFT JOIN execution_steps es ON es.id = ex.execution_step_id
       WHERE ex.execution_id = ? ORDER BY ex.created_at DESC`
    )
    .bind(execId)
    .all<ExceptionRow & { creator_name: string | null; step_code: string | null }>();
  return ok({
    items: (rows.results ?? []).map((r) =>
      toPublic(r, { creator_name: r.creator_name, step_code: r.step_code })
    ),
    total: (rows.results ?? []).length,
  });
}

/** POST /exceptions/{id}:start — chuyển sang đang xử lý. */
export async function handleStartException(ctx: Ctx, exceptionId: string) {
  const me = await requirePermission(ctx, "exceptions.handle");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const ex = await db.prepare(`SELECT * FROM exceptions WHERE id = ?`).bind(exceptionId).first<ExceptionRow>();
  if (!ex) return apiError("NOT_FOUND", "Không tìm thấy ngoại lệ.", ctx.requestId);
  if (ex.status !== "OPEN") {
    return apiError("VALIDATION_ERROR", "Chỉ xử lý ngoại lệ đang ở trạng thái mới.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const assignedTo = typeof body?.assigned_to === "string" ? body.assigned_to : null;
  const now = nowIso();
  await db
    .prepare(`UPDATE exceptions SET status = 'IN_PROGRESS', assigned_to = ?, updated_at = ? WHERE id = ?`)
    .bind(assignedTo, now, exceptionId)
    .run();

  await audit(db, {
    event_type: "EXCEPTION_STARTED",
    actor_id: me.user.id,
    object_type: "exception",
    object_id: exceptionId,
    request_id: ctx.requestId,
  });
  const updated = await db.prepare(`SELECT * FROM exceptions WHERE id = ?`).bind(exceptionId).first<ExceptionRow>();
  return ok(toPublic(updated!));
}

/** POST /exceptions/{id}:resolve — ghi nhận cách khắc phục. */
export async function handleResolveException(ctx: Ctx, exceptionId: string) {
  const me = await requirePermission(ctx, "exceptions.handle");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const ex = await db.prepare(`SELECT * FROM exceptions WHERE id = ?`).bind(exceptionId).first<ExceptionRow>();
  if (!ex) return apiError("NOT_FOUND", "Không tìm thấy ngoại lệ.", ctx.requestId);
  if (!["OPEN", "IN_PROGRESS"].includes(ex.status)) {
    return apiError("VALIDATION_ERROR", "Ngoại lệ đã được xử lý.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const resolution = typeof body?.resolution === "string" ? body.resolution.trim() : "";
  if (!resolution) {
    return apiError("VALIDATION_ERROR", "Thiếu mô tả cách khắc phục.", ctx.requestId);
  }

  const now = nowIso();
  await db
    .prepare(
      `UPDATE exceptions SET status = 'RESOLVED', resolution = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`
    )
    .bind(resolution, me.user.id, now, now, exceptionId)
    .run();

  await audit(db, {
    event_type: "EXCEPTION_RESOLVED",
    actor_id: me.user.id,
    object_type: "exception",
    object_id: exceptionId,
    request_id: ctx.requestId,
  });
  const updated = await db.prepare(`SELECT * FROM exceptions WHERE id = ?`).bind(exceptionId).first<ExceptionRow>();
  return ok(toPublic(updated!));
}

/** POST /exceptions/{id}:close — đóng ngoại lệ. */
export async function handleCloseException(ctx: Ctx, exceptionId: string) {
  const me = await requirePermission(ctx, "exceptions.handle");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const ex = await db.prepare(`SELECT * FROM exceptions WHERE id = ?`).bind(exceptionId).first<ExceptionRow>();
  if (!ex) return apiError("NOT_FOUND", "Không tìm thấy ngoại lệ.", ctx.requestId);
  if (ex.status !== "RESOLVED") {
    return apiError("VALIDATION_ERROR", "Chỉ đóng ngoại lệ đã khắc phục.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const closeNote = typeof body?.close_note === "string" ? body.close_note.trim() || null : null;
  const now = nowIso();
  await db
    .prepare(
      `UPDATE exceptions SET status = 'CLOSED', close_note = ?, closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ?`
    )
    .bind(closeNote, me.user.id, now, now, exceptionId)
    .run();

  await audit(db, {
    event_type: "EXCEPTION_CLOSED",
    actor_id: me.user.id,
    object_type: "exception",
    object_id: exceptionId,
    request_id: ctx.requestId,
  });
  const updated = await db.prepare(`SELECT * FROM exceptions WHERE id = ?`).bind(exceptionId).first<ExceptionRow>();
  return ok(toPublic(updated!));
}

export { SEVERITY_LABELS, STATUS_LABELS };
