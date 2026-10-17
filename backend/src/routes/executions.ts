// routes/executions.ts — lượt thực hiện quy trình (Task 1.6).
// Khớp SRS v1.6: EXE-001–009, EXE-011–013; §7.2; AC-04 (thứ tự bắt buộc).
//
// Máy trạng thái Execution: CREATED -> IN_PROGRESS -> COMPLETED | CANCELLED
//                           IN_PROGRESS <-> PAUSED
// Máy trạng thái ExecutionStep: NOT_STARTED -> IN_PROGRESS -> PASSED | FAILED | SKIPPED
// AC-04: không cho bắt đầu bước sau khi bước trước chưa PASSED/SKIPPED hợp lệ.

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission, type SessionInfo } from "./auth";
import type { Ctx } from "./context";

type ExecutionRow = {
  id: string;
  code: string;
  process_id: string;
  version_id: string;
  title: string | null;
  status: string;
  assignee_id: string | null;
  due_at: string | null;
  execution_date: string | null;
  execution_time: string | null;
  shift: string | null;
  supervisor_id: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type ExecStepRow = {
  id: string;
  execution_id: string;
  sort_order: number;
  code: string;
  title: string;
  instruction: string | null;
  role: string | null;
  position_id: string | null;
  prerequisite: string | null;
  input_desc: string | null;
  expected_result: string | null;
  output_desc: string | null;
  target_duration_min: number | null;
  warning: string | null;
  is_required: number;
  completion_req: string | null;
  status: string;
  completed_by: string | null;
  completed_at: string | null;
  note: string | null;
  skip_reason: string | null;
};

function toPublicExec(e: ExecutionRow, processName?: string, progress?: { total: number; done: number }) {
  return {
    id: e.id,
    code: e.code,
    process_id: e.process_id,
    version_id: e.version_id,
    title: e.title,
    status: e.status,
    assignee_id: e.assignee_id,
    due_at: e.due_at,
    execution_date: e.execution_date,
    execution_time: e.execution_time,
    shift: e.shift,
    supervisor_id: e.supervisor_id,
    creator_id: (e as unknown as Record<string, unknown>).creator_id as string | null ?? null,
    cancel_reason: e.cancel_reason,
    created_at: e.created_at,
    started_at: e.started_at,
    completed_at: e.completed_at,
    process_name: processName ?? null,
    progress: progress ?? null,
  };
}

function toPublicStep(s: ExecStepRow) {
  return {
    id: s.id,
    execution_id: s.execution_id,
    sort_order: s.sort_order,
    code: s.code,
    title: s.title,
    instruction: s.instruction,
    role: s.role,
    position_id: s.position_id,
    prerequisite: s.prerequisite,
    input_desc: s.input_desc,
    expected_result: s.expected_result,
    output_desc: s.output_desc,
    target_duration_min: s.target_duration_min,
    warning: s.warning,
    is_required: s.is_required === 1,
    completion_req: s.completion_req,
    status: s.status,
    completed_by: s.completed_by,
    completed_at: s.completed_at,
    note: s.note,
    skip_reason: s.skip_reason,
  };
}

async function getProgress(db: D1Database, executionId: string): Promise<{ total: number; done: number }> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('PASSED','SKIPPED') THEN 1 ELSE 0 END) AS done
       FROM execution_steps WHERE execution_id = ?`
    )
    .bind(executionId)
    .first<{ total: number; done: number }>();
  return { total: r?.total ?? 0, done: r?.done ?? 0 };
}

// GET /api/v1/executions — danh sách lượt (EXE-011: hỗ trợ lọc mine).
export async function handleListExecutions(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const url = new URL(ctx.request.url);
  const mine = url.searchParams.get("mine") === "1";
  const status = (url.searchParams.get("status") ?? "").trim();

  const conds: string[] = [];
  const binds: unknown[] = [];
  if (mine) {
    conds.push(`e.assignee_id = ?`);
    binds.push(me.user.id);
  }
  if (status) {
    conds.push(`e.status = ?`);
    binds.push(status);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await db
    .prepare(
      `SELECT e.*, p.name AS process_name,
              ua.display_name AS assignee_name, uc.display_name AS creator_name,
              us.display_name AS supervisor_name,
              ucr.display_name AS creator_display_name, pos.name AS creator_position_name
       FROM executions e
       LEFT JOIN processes p ON p.id = e.process_id
       LEFT JOIN users ua ON ua.id = e.assignee_id
       LEFT JOIN users uc ON uc.id = e.created_by
       LEFT JOIN users us ON us.id = e.supervisor_id
       LEFT JOIN users ucr ON ucr.id = e.creator_id
       LEFT JOIN positions pos ON pos.id = ucr.position_id
       ${where} ORDER BY e.created_at DESC LIMIT 100`
    )
    .bind(...binds)
    .all<ExecutionRow & { process_name: string; assignee_name: string | null; creator_name: string | null; supervisor_name: string | null; creator_display_name: string | null; creator_position_name: string | null }>();

  const items = [];
  for (const r of rows.results) {
    const progress = await getProgress(db, r.id);
    items.push({ ...toPublicExec(r, r.process_name, progress), assignee_name: r.assignee_name, creator_name: r.creator_name, supervisor_name: r.supervisor_name });
  }
  return ok({ items, total: items.length });
}

// POST /api/v1/executions — tạo lượt mới từ phiên bản đang hiệu lực (EXE-001, EXE-002).
export async function handleCreateExecution(ctx: Ctx): Promise<Response> {
  const s = requirePermission(ctx, "executions.perform");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const processId = String(body?.process_id ?? "").trim();
  if (!processId) {
    return apiError("VALIDATION_ERROR", "Thiếu process_id.", ctx.requestId);
  }
  // EXE-001: chỉ dùng phiên bản đang hiệu lực.
  const version = await db
    .prepare(`SELECT * FROM process_versions WHERE process_id = ? AND status = 'ACTIVE' LIMIT 1`)
    .bind(processId)
    .first<{ id: string; version_number: number }>();
  if (!version) {
    return apiError("VALIDATION_ERROR", "Quy trình chưa có phiên bản đang hiệu lực.", ctx.requestId);
  }
  // Snapshot các bước từ phiên bản.
  const steps = await db
    .prepare(`SELECT * FROM process_steps WHERE version_id = ? ORDER BY sort_order ASC`)
    .bind(version.id)
    .all<{
      code: string;
      title: string;
      instruction: string | null;
      role: string | null;
      is_required: number;
      completion_req: string | null;
    }>();
  if (steps.results.length === 0) {
    return apiError("VALIDATION_ERROR", "Phiên bản hiệu lực chưa có bước nào.", ctx.requestId);
  }

  const now = nowIso();
  const execId = newId();
  // Tạo mã lượt duy nhất: EXE-YYYYMMDD-XXX
  const datePart = now.slice(0, 10).replace(/-/g, "");
  const countR = await db
    .prepare(`SELECT COUNT(*) AS c FROM executions WHERE code LIKE ?`)
    .bind(`EXE-${datePart}-%`)
    .first<{ c: number }>();
  const seq = String((countR?.c ?? 0) + 1).padStart(3, "0");
  const code = `EXE-${datePart}-${seq}`;

  const title = typeof body?.title === "string" ? body.title.trim() || null : null;
  const assigneeId = typeof body?.assignee_id === "string" && body.assignee_id.trim()
    ? body.assignee_id.trim()
    : me.user.id;
  const dueAt = typeof body?.due_at === "string" ? body.due_at.trim() || null : null;
  // Ngày thực hiện là bắt buộc (yêu cầu khách hàng).
  const executionDate = typeof body?.execution_date === "string" ? body.execution_date.trim() : "";
  if (!executionDate || !/^\d{4}-\d{2}-\d{2}$/.test(executionDate)) {
    return apiError("VALIDATION_ERROR", "Thiếu ngày thực hiện (định dạng YYYY-MM-DD).", ctx.requestId);
  }
  const executionTime = typeof body?.execution_time === "string" && /^\d{2}:\d{2}$/.test(body.execution_time.trim())
    ? body.execution_time.trim()
    : null;
  const shift = typeof body?.shift === "string" && ["MORNING", "NOON", "AFTERNOON", "NIGHT"].includes(body.shift)
    ? body.shift
    : null;
  const supervisorId = typeof body?.supervisor_id === "string" && body.supervisor_id.trim()
    ? body.supervisor_id.trim()
    : null;
  // Người tạo: bắt buộc chọn, mặc định là chính người đang đăng nhập.
  const creatorId = typeof body?.creator_id === "string" && body.creator_id.trim()
    ? body.creator_id.trim()
    : me.user.id;
  const creator = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(creatorId).first();
  if (!creator) return apiError("VALIDATION_ERROR", "Người tạo không tồn tại.", ctx.requestId);
  if (supervisorId) {
    const sup = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(supervisorId).first();
    if (!sup) return apiError("VALIDATION_ERROR", "Người giám sát không tồn tại.", ctx.requestId);
  }

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO executions (id, code, process_id, version_id, title, status, assignee_id, supervisor_id, creator_id, due_at, execution_date, execution_time, shift, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(execId, code, processId, version.id, title, assigneeId, supervisorId, creatorId, dueAt, executionDate, executionTime, shift, now, me.user.id),
  ];
  for (const [idx, st] of steps.results.entries()) {
    const s = st as unknown as Record<string, unknown>;
    stmts.push(
      db.prepare(
        `INSERT INTO execution_steps (id, execution_id, sort_order, code, title, instruction, role, position_id,
          prerequisite, input_desc, expected_result, output_desc, target_duration_min, warning,
          is_required, completion_req, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?)`
      ).bind(newId(), execId, idx + 1, st.code, st.title, st.instruction, st.role, s.position_id ?? null,
        s.prerequisite ?? null, s.input_desc ?? null, s.expected_result ?? null, s.output_desc ?? null,
        s.target_duration_min ?? null, s.warning ?? null,
        st.is_required, st.completion_req, now)
    );
  }
  await db.batch(stmts);
  await audit(db, {
    event_type: "EXECUTION_CREATED",
    actor_id: me.user.id,
    object_type: "execution",
    object_id: execId,
    request_id: ctx.requestId,
    diff: { code, process_id: processId, version_id: version.id, steps: steps.results.length },
  });

  const created = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(execId).first<ExecutionRow>();
  const pname = await db.prepare(`SELECT name FROM processes WHERE id = ?`).bind(processId).first<{ name: string }>();
  return ok(toPublicExec(created!, pname?.name, { total: steps.results.length, done: 0 }), 201);
}

// GET /api/v1/executions/{id} — chi tiết lượt kèm các bước (EXE-012).
export async function handleGetExecution(ctx: Ctx, id: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  const pname = await db.prepare(`SELECT name, code FROM processes WHERE id = ?`).bind(e.process_id).first<{
    name: string;
    code: string;
  }>();
  const users = await db.prepare(`SELECT id, display_name, position_id FROM users WHERE id IN (?, ?, ?, ?)`).bind(e.assignee_id, e.created_by, e.supervisor_id, (e as unknown as Record<string, unknown>).creator_id).all<{ id: string; display_name: string; position_id: string | null }>();
  const nameById: Record<string, string> = {};
  const posById: Record<string, string | null> = {};
  for (const u of users.results ?? []) {
    nameById[u.id] = u.display_name;
    posById[u.id] = u.position_id;
  }
  // Lấy tên chức vụ của người tạo.
  const creatorId = (e as unknown as Record<string, unknown>).creator_id as string | null;
  let creatorPositionName: string | null = null;
  if (creatorId && posById[creatorId]) {
    const pos = await db.prepare(`SELECT name FROM positions WHERE id = ?`).bind(posById[creatorId]).first<{ name: string }>();
    creatorPositionName = pos?.name ?? null;
  }
  const steps = await db
    .prepare(`SELECT es.*, p.name as position_name FROM execution_steps es LEFT JOIN positions p ON p.id = es.position_id WHERE execution_id = ? ORDER BY sort_order ASC`)
    .bind(id)
    .all<ExecStepRow & { position_name: string | null }>();
  const progress = await getProgress(db, id);
  return ok({
    ...toPublicExec(e, pname?.name, progress),
    process_code: pname?.code ?? null,
    assignee_name: e.assignee_id ? nameById[e.assignee_id] ?? null : null,
    creator_name: creatorId ? nameById[creatorId] ?? null : null,
    creator_position_name: creatorPositionName,
    supervisor_name: e.supervisor_id ? nameById[e.supervisor_id] ?? null : null,
    steps: steps.results.map(toPublicStep),
  });
}

/** GET /executions/{eid}/steps/{sid}/assignees — danh sách người được phân công. */
export async function handleListStepAssignees(ctx: Ctx, execId: string, stepId: string) {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const rows = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.position, a.assigned_at
    FROM execution_step_assignees a
    JOIN users u ON u.id = a.user_id
    WHERE a.execution_step_id = ?
    ORDER BY a.assigned_at ASC
  `).bind(stepId).all();
  return ok({ items: rows.results ?? [] });
}

/** PUT /executions/{eid}/steps/{sid}/assignees — gán danh sách người (thay thế toàn bộ). */
export async function handleSetStepAssignees(ctx: Ctx, execId: string, stepId: string) {
  const me = await requirePermission(ctx, "executions.execute");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const step = await db.prepare(`SELECT id, execution_id FROM execution_steps WHERE id = ?`).bind(stepId).first<{ id: string; execution_id: string }>();
  if (!step || step.execution_id !== execId) {
    return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const userIds = Array.isArray(body?.user_ids) ? body.user_ids.filter((x): x is string => typeof x === "string") : [];
  // Kiểm tra tất cả user tồn tại.
  for (const uid of userIds) {
    const u = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(uid).first();
    if (!u) return apiError("VALIDATION_ERROR", `Người dùng không tồn tại: ${uid}`, ctx.requestId);
  }

  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM execution_step_assignees WHERE execution_step_id = ?`).bind(stepId),
  ];
  for (const uid of [...new Set(userIds)]) {
    stmts.push(
      db.prepare(`INSERT INTO execution_step_assignees (execution_step_id, user_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)`)
        .bind(stepId, uid, now, me.user.id)
    );
  }
  await db.batch(stmts);

  await audit(db, {
    event_type: "STEP_ASSIGNEES_SET",
    actor_id: me.user.id,
    object_type: "execution_step",
    object_id: stepId,
    request_id: ctx.requestId,
    diff: { user_ids: userIds },
  });
  return ok({ assigned: [...new Set(userIds)].length });
}

// Chuyển trạng thái execution — dùng chung.
async function transitionExecution(
  ctx: Ctx,
  id: string,
  from: string[],
  to: string,
  requiredPerm: string | null,
  eventType: string,
  extra?: { cancel_reason?: string }
): Promise<Response> {
  let me: SessionInfo;
  if (requiredPerm) {
    const s = requirePermission(ctx, requiredPerm);
    if (s instanceof Response) return s;
    me = s as SessionInfo;
  } else {
    const s = ctx.requireAuth();
    if (s instanceof Response) return s;
    me = s as SessionInfo;
  }
  const db = ctx.env.sop_demo_db;
  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  if (!from.includes(e.status)) {
    return apiError("VALIDATION_ERROR", `Không thể chuyển từ trạng thái ${e.status}.`, ctx.requestId);
  }
  // Người được giao hoặc người có quyền executions.manage mới được thao tác.
  const canManage = me.permissions.includes("*") || me.permissions.includes("executions.manage");
  if (!canManage && e.assignee_id !== me.user.id) {
    return apiError("FORBIDDEN", "Bạn không được giao lượt này.", ctx.requestId);
  }

  const now = nowIso();
  const updates = [`status = ?`, `updated_at = ?`];
  const binds: unknown[] = [to, now];
  if (to === "IN_PROGRESS" && e.status === "CREATED") {
    updates.push("started_at = ?");
    binds.push(now);
  }
  if (to === "COMPLETED") {
    // EXE-009: chỉ hoàn thành khi mọi bước bắt buộc đã PASSED/SKIPPED hợp lệ.
    const incomplete = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM execution_steps
         WHERE execution_id = ? AND is_required = 1 AND status NOT IN ('PASSED','SKIPPED')`
      )
      .bind(id)
      .first<{ c: number }>();
    if ((incomplete?.c ?? 0) > 0) {
      return apiError("VALIDATION_ERROR", "Còn bước bắt buộc chưa hoàn thành.", ctx.requestId);
    }
    updates.push("completed_at = ?");
    binds.push(now);
  }
  if (to === "CANCELLED") {
    const reason = extra?.cancel_reason?.trim();
    if (!reason) {
      return apiError("VALIDATION_ERROR", "Hủy lượt bắt buộc phải có lý do.", ctx.requestId);
    }
    updates.push("cancel_reason = ?");
    binds.push(reason);
  }
  binds.push(id);
  await db.prepare(`UPDATE executions SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
  await audit(db, {
    event_type: eventType,
    actor_id: me.user.id,
    object_type: "execution",
    object_id: id,
    request_id: ctx.requestId,
    diff: { from: e.status, to },
  });
  const updated = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  const progress = await getProgress(db, id);
  return ok(toPublicExec(updated!, undefined, progress));
}

export const handleStartExecution = (ctx: Ctx, id: string) =>
  transitionExecution(ctx, id, ["CREATED"], "IN_PROGRESS", null, "EXECUTION_STARTED");
export const handlePauseExecution = (ctx: Ctx, id: string) =>
  transitionExecution(ctx, id, ["IN_PROGRESS"], "PAUSED", null, "EXECUTION_PAUSED");
export const handleResumeExecution = (ctx: Ctx, id: string) =>
  transitionExecution(ctx, id, ["PAUSED"], "IN_PROGRESS", null, "EXECUTION_RESUMED");
export async function handleCancelExecution(ctx: Ctx, id: string): Promise<Response> {
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const reason = typeof body?.cancel_reason === "string" ? body.cancel_reason : "";
  return transitionExecution(ctx, id, ["CREATED", "IN_PROGRESS", "PAUSED"], "CANCELLED", null, "EXECUTION_CANCELLED", {
    cancel_reason: reason,
  });
}
export const handleCompleteExecution = (ctx: Ctx, id: string) =>
  transitionExecution(ctx, id, ["IN_PROGRESS"], "COMPLETED", null, "EXECUTION_COMPLETED");

// POST .../{id}/steps/{sid}:start — bắt đầu bước (AC-04: kiểm tra bước trước).
export async function handleStartStep(ctx: Ctx, execId: string, stepId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(execId).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  if (e.status !== "IN_PROGRESS") {
    return apiError("VALIDATION_ERROR", "Lượt chưa ở trạng thái đang thực hiện.", ctx.requestId);
  }
  const canManage = me.permissions.includes("*") || me.permissions.includes("executions.manage");
  if (!canManage && e.assignee_id !== me.user.id) {
    return apiError("FORBIDDEN", "Bạn không được giao lượt này.", ctx.requestId);
  }

  const step = await db
    .prepare(`SELECT * FROM execution_steps WHERE id = ? AND execution_id = ?`)
    .bind(stepId, execId)
    .first<ExecStepRow>();
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  if (step.status !== "NOT_STARTED") {
    return apiError("VALIDATION_ERROR", "Bước đã được bắt đầu.", ctx.requestId);
  }
  // AC-04: bước trước phải PASSED hoặc SKIPPED hợp lệ.
  if (step.sort_order > 1) {
    const prev = await db
      .prepare(`SELECT status FROM execution_steps WHERE execution_id = ? AND sort_order = ?`)
      .bind(execId, step.sort_order - 1)
      .first<{ status: string }>();
    if (!prev || !["PASSED", "SKIPPED"].includes(prev.status)) {
      return apiError("VALIDATION_ERROR", "Bước trước chưa hoàn thành — không thể bắt đầu bước này.", ctx.requestId, {
        code: "PREVIOUS_STEP_INCOMPLETE",
      });
    }
  }

  const now = nowIso();
  await db
    .prepare(`UPDATE execution_steps SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?`)
    .bind(now, stepId)
    .run();
  await audit(db, {
    event_type: "EXECUTION_STEP_STARTED",
    actor_id: me.user.id,
    object_type: "execution_step",
    object_id: stepId,
    request_id: ctx.requestId,
    diff: { execution_id: execId, code: step.code },
  });
  const updated = await db.prepare(`SELECT * FROM execution_steps WHERE id = ?`).bind(stepId).first<ExecStepRow>();
  return ok(toPublicStep(updated!));
}

// POST .../{id}/steps/{sid}:complete — hoàn thành bước (EXE-007).
export async function handleCompleteStep(ctx: Ctx, execId: string, stepId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(execId).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  if (e.status !== "IN_PROGRESS") {
    return apiError("VALIDATION_ERROR", "Lượt chưa ở trạng thái đang thực hiện.", ctx.requestId);
  }
  const canManage = me.permissions.includes("*") || me.permissions.includes("executions.manage");
  if (!canManage && e.assignee_id !== me.user.id) {
    return apiError("FORBIDDEN", "Bạn không được giao lượt này.", ctx.requestId);
  }

  const step = await db
    .prepare(`SELECT * FROM execution_steps WHERE id = ? AND execution_id = ?`)
    .bind(stepId, execId)
    .first<ExecStepRow>();
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  if (step.status !== "IN_PROGRESS") {
    return apiError("VALIDATION_ERROR", "Bước chưa được bắt đầu.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const note = typeof body?.note === "string" ? body.note.trim() || null : null;

  // EXE-007: chặn hoàn thành bước khi thiếu yêu cầu bắt buộc.
  // completion_req là JSON: { require_photo?: boolean, min_photos?: number, require_note?: boolean }
  if (step.completion_req) {
    try {
      const req = JSON.parse(step.completion_req) as {
        require_photo?: boolean; min_photos?: number; require_note?: boolean;
      };
      const minPhotos = req.min_photos ?? (req.require_photo ? 1 : 0);
      if (minPhotos > 0) {
        const { countVerifiedEvidence } = await import("./evidence");
        const photoCount = await countVerifiedEvidence(db, stepId);
        if (photoCount < minPhotos) {
          return apiError("VALIDATION_ERROR", `Bước yêu cầu ít nhất ${minPhotos} ảnh bằng chứng (đã có ${photoCount}).`, ctx.requestId, {
            code: "EVIDENCE_REQUIRED",
            required: minPhotos,
            provided: photoCount,
          });
        }
      }
      if (req.require_note && !note) {
        return apiError("VALIDATION_ERROR", "Bước yêu cầu ghi chú khi hoàn thành.", ctx.requestId, {
          code: "NOTE_REQUIRED",
        });
      }
    } catch {
      // completion_req không phải JSON hợp lệ — bỏ qua.
    }
  }

  const now = nowIso();
  await db
    .prepare(
      `UPDATE execution_steps SET status = 'PASSED', completed_by = ?, completed_at = ?, note = ?, updated_at = ? WHERE id = ?`
    )
    .bind(me.user.id, now, note, now, stepId)
    .run();
  await audit(db, {
    event_type: "EXECUTION_STEP_COMPLETED",
    actor_id: me.user.id,
    object_type: "execution_step",
    object_id: stepId,
    request_id: ctx.requestId,
    diff: { execution_id: execId, code: step.code },
  });
  const updated = await db.prepare(`SELECT * FROM execution_steps WHERE id = ?`).bind(stepId).first<ExecStepRow>();
  return ok(toPublicStep(updated!));
}

// POST .../{id}/steps/{sid}:skip — bỏ qua bước (chỉ bước không bắt buộc).
export async function handleSkipStep(ctx: Ctx, execId: string, stepId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(execId).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  if (e.status !== "IN_PROGRESS") {
    return apiError("VALIDATION_ERROR", "Lượt chưa ở trạng thái đang thực hiện.", ctx.requestId);
  }
  const canManage = me.permissions.includes("*") || me.permissions.includes("executions.manage");
  if (!canManage && e.assignee_id !== me.user.id) {
    return apiError("FORBIDDEN", "Bạn không được giao lượt này.", ctx.requestId);
  }

  const step = await db
    .prepare(`SELECT * FROM execution_steps WHERE id = ? AND execution_id = ?`)
    .bind(stepId, execId)
    .first<ExecStepRow>();
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  if (step.status !== "NOT_STARTED" && step.status !== "IN_PROGRESS") {
    return apiError("VALIDATION_ERROR", "Bước đã kết thúc.", ctx.requestId);
  }
  if (step.is_required === 1) {
    return apiError("VALIDATION_ERROR", "Không được bỏ qua bước bắt buộc.", ctx.requestId);
  }
  // AC-04 cũng áp dụng cho skip: bước trước phải xong.
  if (step.sort_order > 1) {
    const prev = await db
      .prepare(`SELECT status FROM execution_steps WHERE execution_id = ? AND sort_order = ?`)
      .bind(execId, step.sort_order - 1)
      .first<{ status: string }>();
    if (!prev || !["PASSED", "SKIPPED"].includes(prev.status)) {
      return apiError("VALIDATION_ERROR", "Bước trước chưa hoàn thành.", ctx.requestId, {
        code: "PREVIOUS_STEP_INCOMPLETE",
      });
    }
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const skipReason = typeof body?.skip_reason === "string" ? body.skip_reason.trim() || null : null;
  if (!skipReason) {
    return apiError("VALIDATION_ERROR", "Bỏ qua bước bắt buộc phải có lý do.", ctx.requestId);
  }
  const now = nowIso();
  await db
    .prepare(
      `UPDATE execution_steps SET status = 'SKIPPED', completed_by = ?, completed_at = ?, skip_reason = ?, updated_at = ? WHERE id = ?`
    )
    .bind(me.user.id, now, skipReason, now, stepId)
    .run();
  await audit(db, {
    event_type: "EXECUTION_STEP_SKIPPED",
    actor_id: me.user.id,
    object_type: "execution_step",
    object_id: stepId,
    request_id: ctx.requestId,
    diff: { execution_id: execId, code: step.code, skip_reason: skipReason },
  });
  const updated = await db.prepare(`SELECT * FROM execution_steps WHERE id = ?`).bind(stepId).first<ExecStepRow>();
  return ok(toPublicStep(updated!));
}
