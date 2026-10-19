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
import { createNotification, notifyUsers } from "./notifications";

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
  skip_policy: string | null;
  failure_policy: string | null;
  is_required: number;
  completion_req: string | null;
  status: string;
  completed_by: string | null;
  completed_at: string | null;
  note: string | null;
  skip_reason: string | null;
};

function toPublicExec(e: ExecutionRow, processName?: string, progress?: { total: number; done: number }, redoInfo?: { redo_steps: number; last_redo_by_name: string | null; last_redo_at: string | null; last_redo_reason: string | null }) {
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
    expected_start_at: (e as unknown as Record<string, unknown>).expected_start_at as string | null ?? null,
    expected_end_at: (e as unknown as Record<string, unknown>).expected_end_at as string | null ?? null,
    supervisor_id: e.supervisor_id,
    creator_id: (e as unknown as Record<string, unknown>).creator_id as string | null ?? null,
    cancel_reason: e.cancel_reason,
    created_at: e.created_at,
    started_at: e.started_at,
    completed_at: e.completed_at,
    process_name: processName ?? null,
    progress: progress ?? null,
    redo_steps: redoInfo?.redo_steps ?? 0,
    last_redo_by_name: redoInfo?.last_redo_by_name ?? null,
    last_redo_at: redoInfo?.last_redo_at ?? null,
    last_redo_reason: redoInfo?.last_redo_reason ?? null,
  };
}

/** Lấy thông tin làm lại của một lượt (số bước bị trả lại, người từ chối gần nhất...). */
async function getRedoInfo(db: D1Database, executionId: string): Promise<{ redo_steps: number; last_redo_by_name: string | null; last_redo_at: string | null; last_redo_reason: string | null }> {
  const r = await db.prepare(
    `SELECT COUNT(*) AS redo_steps, MAX(es.redo_at) AS last_redo_at
     FROM execution_steps es WHERE es.execution_id = ? AND es.redo_count > 0`
  ).bind(executionId).first<{ redo_steps: number; last_redo_at: string | null }>();
  if (!r || (r.redo_steps ?? 0) === 0) {
    return { redo_steps: 0, last_redo_by_name: null, last_redo_at: null, last_redo_reason: null };
  }
  const last = await db.prepare(
    `SELECT es.redo_reason AS last_redo_reason, u.display_name AS last_redo_by_name
     FROM execution_steps es LEFT JOIN users u ON u.id = es.redo_by
     WHERE es.execution_id = ? AND es.redo_count > 0
     ORDER BY es.redo_at DESC LIMIT 1`
  ).bind(executionId).first<{ last_redo_reason: string | null; last_redo_by_name: string | null }>();
  return {
    redo_steps: r.redo_steps ?? 0,
    last_redo_by_name: last?.last_redo_by_name ?? null,
    last_redo_at: r.last_redo_at,
    last_redo_reason: last?.last_redo_reason ?? null,
  };
}

/** Lấy toàn bộ lịch sử từ chối xác nhận của một lượt (từ audit log). */
async function getRejectHistory(db: D1Database, executionId: string): Promise<Array<{
  by_name: string | null;
  at: string;
  reason: string | null;
  action: string;
  step_count: number;
}>> {
  const rows = await db.prepare(
    `SELECT a.occurred_at AS at, a.diff_json, u.display_name AS by_name
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.object_type = 'execution' AND a.object_id = ?
       AND a.event_type IN ('EXECUTION_CONFIRM_REJECTED_REDO', 'EXECUTION_CONFIRM_REJECTED_CANCEL')
     ORDER BY a.occurred_at DESC`
  ).bind(executionId).all<{ at: string; diff_json: string | null; by_name: string | null }>();
  return (rows.results ?? []).map((r) => {
    let diff: Record<string, unknown> = {};
    try { diff = r.diff_json ? JSON.parse(r.diff_json) : {}; } catch { /* ignore */ }
    const stepIds = Array.isArray(diff.step_ids) ? diff.step_ids : [];
    return {
      by_name: r.by_name,
      at: r.at,
      reason: typeof diff.reason === "string" ? diff.reason : null,
      action: stepIds.length > 0 ? "redo" : "cancel",
      step_count: stepIds.length,
    };
  });
}

function parsePolicy(raw: string | null): { allowed?: boolean } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    // Dữ liệu cũ bị double-encode: parse thêm lần nữa nếu ra string.
    if (typeof v === "string") {
      try { return JSON.parse(v); } catch { return null; }
    }
    return v;
  } catch { return null; }
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
    skip_policy: parsePolicy(s.skip_policy),
    failure_policy: s.failure_policy,
    is_required: s.is_required === 1,
    completion_req: s.completion_req,
    status: s.status,
    completed_by: s.completed_by,
    completed_at: s.completed_at,
    note: s.note,
    skip_reason: s.skip_reason,
    redo_count: (s as unknown as Record<string, unknown>).redo_count ?? 0,
    redo_reason: (s as unknown as Record<string, unknown>).redo_reason ?? null,
    redo_at: (s as unknown as Record<string, unknown>).redo_at ?? null,
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
    conds.push(`(e.assignee_id = ? OR e.created_by = ? OR e.id IN (SELECT execution_id FROM execution_supervisors WHERE user_id = ?) OR e.id IN (SELECT execution_id FROM execution_approvers WHERE user_id = ?) OR e.id IN (SELECT es.execution_id FROM execution_step_assignees esa JOIN execution_steps es ON es.id = esa.execution_step_id WHERE esa.user_id = ?))`);
    binds.push(me.user.id, me.user.id, me.user.id, me.user.id, me.user.id);
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
    const redoInfo = await getRedoInfo(db, r.id);
    items.push({ ...toPublicExec(r, r.process_name, progress, redoInfo), assignee_name: r.assignee_name, creator_name: r.creator_name, supervisor_name: r.supervisor_name });
  }
  return ok({ items, total: items.length });
}

// POST /api/v1/executions — tạo lượt mới từ phiên bản đang hiệu lực (EXE-001, EXE-002).

/** Suy ca làm việc từ giờ (HH:MM). */
function deriveShift(time: string | null): string | null {
  if (!time) return null;
  const h = parseInt(time.slice(0, 2), 10);
  if (h >= 6 && h < 12) return "MORNING";
  if (h >= 12 && h < 14) return "NOON";
  if (h >= 14 && h < 18) return "AFTERNOON";
  return "NIGHT";
}
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
      id: string;
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
  // Tạo mã lượt duy nhất: EXE-YYYYMMDD-XXX (dùng MAX để tránh trùng khi có xóa).
  const datePart = now.slice(0, 10).replace(/-/g, "");
  const maxR = await db
    .prepare(`SELECT code FROM executions WHERE code LIKE ? ORDER BY code DESC LIMIT 1`)
    .bind(`EXE-${datePart}-%`)
    .first<{ code: string }>();
  let seqNum = 1;
  if (maxR?.code) {
    const m = /-(\d+)$/.exec(maxR.code);
    if (m) seqNum = parseInt(m[1], 10) + 1;
  }
  const seq = String(seqNum).padStart(3, "0");
  const code = `EXE-${datePart}-${seq}`;

  const title = typeof body?.title === "string" ? body.title.trim() || null : null;
  const assigneeId = typeof body?.assignee_id === "string" && body.assignee_id.trim()
    ? body.assignee_id.trim()
    : me.user.id;
  const dueAt = typeof body?.due_at === "string" ? body.due_at.trim() || null : null;
  // Thời gian bắt đầu (dự kiến) — bắt buộc, định dạng YYYY-MM-DDTHH:mm.
  const expectedStartAt = typeof body?.expected_start_at === "string" ? body.expected_start_at.trim() : "";
  if (!expectedStartAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(expectedStartAt)) {
    return apiError("VALIDATION_ERROR", "Thiếu thời gian bắt đầu (dự kiến).", ctx.requestId);
  }
  // Thời gian hoàn thành (dự kiến) — tùy chọn.
  const expectedEndAt = typeof body?.expected_end_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.expected_end_at.trim())
    ? body.expected_end_at.trim()
    : null;
  // Giữ tương thích: suy execution_date/execution_time từ expected_start_at.
  const executionDate = expectedStartAt.slice(0, 10);
  const executionTime = expectedStartAt.slice(11, 16);
  // Tự suy ca làm việc từ giờ (không cho chọn tay nữa).
  const shift = deriveShift(executionTime);
  // Người giám sát: chọn nhiều (mảng) hoặc 1 (chuỗi) để tương thích.
  const supervisorIds: string[] = [];
  const supRaw = body?.supervisor_ids ?? body?.supervisor_id;
  const supArr = Array.isArray(supRaw) ? supRaw : (supRaw ? [supRaw] : []);
  for (const s of supArr) {
    if (typeof s === "string" && s.trim()) supervisorIds.push(s.trim());
  }
  // Người tạo: luôn là người đang đăng nhập (không cho chọn).
  const creatorId = me.user.id;
  // Người phê duyệt (tùy chọn, chọn nhiều).
  const approverIds: string[] = [];
  const aprRaw = body?.approver_ids ?? body?.approver_id;
  const aprArr = Array.isArray(aprRaw) ? aprRaw : (aprRaw ? [aprRaw] : []);
  for (const a of aprArr) {
    if (typeof a === "string" && a.trim()) approverIds.push(a.trim());
  }
  for (const aid of approverIds) {
    const apr = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(aid).first();
    if (!apr) return apiError("VALIDATION_ERROR", "Người phê duyệt không tồn tại.", ctx.requestId);
  }
  for (const sid of supervisorIds) {
    const sup = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(sid).first();
    if (!sup) return apiError("VALIDATION_ERROR", "Người giám sát không tồn tại.", ctx.requestId);
  }

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO executions (id, code, process_id, version_id, title, status, assignee_id, supervisor_id, creator_id, approver_id, due_at, execution_date, execution_time, shift, expected_start_at, expected_end_at, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(execId, code, processId, version.id, title, assigneeId, supervisorIds[0] ?? null, creatorId, approverIds[0] ?? null, dueAt, executionDate, executionTime, shift, expectedStartAt, expectedEndAt, now, me.user.id),
  ];
  // Lưu nhiều giám sát / phê duyệt.
  for (const sid of supervisorIds) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO execution_supervisors (execution_id, user_id) VALUES (?, ?)`).bind(execId, sid));
  }
  for (const aid of approverIds) {
    stmts.push(db.prepare(`INSERT OR IGNORE INTO execution_approvers (execution_id, user_id) VALUES (?, ?)`).bind(execId, aid));
  }
  // Lấy danh sách chức vụ của các bước để snapshot.
  const stepIds = (steps.results ?? []).map((s) => s.id);
  const stepPosMap = new Map<string, string[]>();
  const stepSupMap = new Map<string, string[]>();
  if (stepIds.length > 0) {
    const placeholders = stepIds.map(() => "?").join(",");
    const posRows = await db.prepare(
      `SELECT step_id, position_id FROM process_step_positions WHERE step_id IN (${placeholders})`
    ).bind(...stepIds).all<{ step_id: string; position_id: string }>();
    for (const r of posRows.results ?? []) {
      if (!stepPosMap.has(r.step_id)) stepPosMap.set(r.step_id, []);
      stepPosMap.get(r.step_id)!.push(r.position_id);
    }
    const supRows = await db.prepare(
      `SELECT step_id, position_id FROM process_step_supervisors WHERE step_id IN (${placeholders})`
    ).bind(...stepIds).all<{ step_id: string; position_id: string }>();
    for (const r of supRows.results ?? []) {
      if (!stepSupMap.has(r.step_id)) stepSupMap.set(r.step_id, []);
      stepSupMap.get(r.step_id)!.push(r.position_id);
    }
  }
  for (const [idx, st] of steps.results.entries()) {
    const s = st as unknown as Record<string, unknown>;
    const execStepId = newId();
    stmts.push(
      db.prepare(
        `INSERT INTO execution_steps (id, execution_id, sort_order, code, title, instruction, role,
          prerequisite, input_desc, expected_result, output_desc, target_duration_min, warning,
          skip_policy, failure_policy,
          is_required, completion_req, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?)`
      ).bind(execStepId, execId, idx + 1, st.code, st.title, st.instruction, st.role,
        s.prerequisite ?? null, s.input_desc ?? null, s.expected_result ?? null, s.output_desc ?? null,
        s.target_duration_min ?? null, s.warning ?? null,
        s.skip_policy ?? null, s.failure_policy ?? null,
        st.is_required, st.completion_req, now)
    );
    // Snapshot các chức vụ.
    for (const pid of stepPosMap.get(st.id) ?? []) {
      stmts.push(
        db.prepare(`INSERT INTO execution_step_positions (execution_step_id, position_id) VALUES (?, ?)`)
          .bind(execStepId, pid)
      );
    }
    // Snapshot các chức vụ giám sát.
    for (const pid of stepSupMap.get(st.id) ?? []) {
      stmts.push(
        db.prepare(`INSERT INTO execution_step_supervisors (execution_step_id, position_id) VALUES (?, ?)`)
          .bind(execStepId, pid)
      );
    }
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
  // Thông báo cho người được giao (nếu khác người tạo).
  if (assigneeId !== me.user.id) {
    await createNotification(db, {
      user_id: assigneeId,
      type: "EXECUTION_ASSIGNED",
      title: `Bạn được giao lượt ${code}`,
      message: `${me.user.display_name} đã tạo lượt công việc "${pname?.name ?? ""}" và giao cho bạn.`,
      link: `#/executions/${execId}`,
    });
  }
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
  const vrow = await db.prepare(`SELECT version_number FROM process_versions WHERE id = ?`).bind(e.version_id).first<{ version_number: number }>();
  const users = await db.prepare(`SELECT id, display_name, position_id FROM users WHERE id IN (?, ?, ?, ?, ?, ?)`).bind(e.assignee_id, e.created_by, e.supervisor_id, (e as unknown as Record<string, unknown>).creator_id, (e as unknown as Record<string, unknown>).approver_id, (e as unknown as Record<string, unknown>).approved_by).all<{ id: string; display_name: string; position_id: string | null }>();
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
    .prepare(`SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY sort_order ASC`)
    .bind(id)
    .all<ExecStepRow>();
  // Lấy danh sách chức vụ cho từng bước thực hiện.
  const execStepIds = (steps.results ?? []).map((s) => s.id);
  const execPosMap = new Map<string, { id: string; name: string }[]>();
  const execSupMap = new Map<string, { id: string; name: string }[]>();
  if (execStepIds.length > 0) {
    const placeholders = execStepIds.map(() => "?").join(",");
    const posRows = await db.prepare(
      `SELECT esp.execution_step_id, p.id, p.name FROM execution_step_positions esp
       JOIN positions p ON p.id = esp.position_id
       WHERE esp.execution_step_id IN (${placeholders}) ORDER BY p.name ASC`
    ).bind(...execStepIds).all<{ execution_step_id: string; id: string; name: string }>();
    for (const r of posRows.results ?? []) {
      if (!execPosMap.has(r.execution_step_id)) execPosMap.set(r.execution_step_id, []);
      execPosMap.get(r.execution_step_id)!.push({ id: r.id, name: r.name });
    }
    const supRows = await db.prepare(
      `SELECT ess.execution_step_id, p.id, p.name FROM execution_step_supervisors ess
       JOIN positions p ON p.id = ess.position_id
       WHERE ess.execution_step_id IN (${placeholders}) ORDER BY p.name ASC`
    ).bind(...execStepIds).all<{ execution_step_id: string; id: string; name: string }>();
    for (const r of supRows.results ?? []) {
      if (!execSupMap.has(r.execution_step_id)) execSupMap.set(r.execution_step_id, []);
      execSupMap.get(r.execution_step_id)!.push({ id: r.id, name: r.name });
    }
    // Fallback cho lượt cũ (tạo trước khi có snapshot): đọc từ process_step_supervisors theo mã bước.
    const missingSupSteps = (steps.results ?? []).filter((s) => !execSupMap.has(s.id) || (execSupMap.get(s.id) ?? []).length === 0);
    const missingPosSteps = (steps.results ?? []).filter((s) => !execPosMap.has(s.id) || (execPosMap.get(s.id) ?? []).length === 0);
    if ((missingSupSteps.length > 0 || missingPosSteps.length > 0) && e.version_id) {
      const procSteps = await db.prepare(
        `SELECT id, code FROM process_steps WHERE version_id = ?`
      ).bind(e.version_id).all<{ id: string; code: string }>();
      const procStepIdByCode = new Map<string, string>();
      for (const ps of procSteps.results ?? []) procStepIdByCode.set(ps.code, ps.id);
      const procStepIds = [...procStepIdByCode.values()];
      if (procStepIds.length > 0) {
        const ph2 = procStepIds.map(() => "?").join(",");
        if (missingSupSteps.length > 0) {
          const fbRows = await db.prepare(
            `SELECT pss.step_id, p.id, p.name FROM process_step_supervisors pss
             JOIN positions p ON p.id = pss.position_id
             WHERE pss.step_id IN (${ph2}) ORDER BY p.name ASC`
          ).bind(...procStepIds).all<{ step_id: string; id: string; name: string }>();
          const fbByProcStep = new Map<string, { id: string; name: string }[]>();
          for (const r of fbRows.results ?? []) {
            if (!fbByProcStep.has(r.step_id)) fbByProcStep.set(r.step_id, []);
            fbByProcStep.get(r.step_id)!.push({ id: r.id, name: r.name });
          }
          for (const s of missingSupSteps) {
            const pid = procStepIdByCode.get(s.code);
            if (pid && fbByProcStep.has(pid)) execSupMap.set(s.id, fbByProcStep.get(pid)!);
          }
        }
        if (missingPosSteps.length > 0) {
          const fbPosRows = await db.prepare(
            `SELECT psp.step_id, p.id, p.name FROM process_step_positions psp
             JOIN positions p ON p.id = psp.position_id
             WHERE psp.step_id IN (${ph2}) ORDER BY p.name ASC`
          ).bind(...procStepIds).all<{ step_id: string; id: string; name: string }>();
          const fbPosByProcStep = new Map<string, { id: string; name: string }[]>();
          for (const r of fbPosRows.results ?? []) {
            if (!fbPosByProcStep.has(r.step_id)) fbPosByProcStep.set(r.step_id, []);
            fbPosByProcStep.get(r.step_id)!.push({ id: r.id, name: r.name });
          }
          for (const s of missingPosSteps) {
            const pid = procStepIdByCode.get(s.code);
            if (pid && fbPosByProcStep.has(pid)) execPosMap.set(s.id, fbPosByProcStep.get(pid)!);
          }
        }
      }
    }
  }
  const progress = await getProgress(db, id);
  const redoInfo = await getRedoInfo(db, id);
  const rejectHistory = await getRejectHistory(db, id);
  // Lấy danh sách người giám sát / phê duyệt của lượt (chọn nhiều).
  const execSupRows = await db.prepare(
    `SELECT u.display_name FROM execution_supervisors es JOIN users u ON u.id = es.user_id WHERE es.execution_id = ? ORDER BY u.display_name ASC`
  ).bind(id).all<{ display_name: string }>();
  const execAprRows = await db.prepare(
    `SELECT u.display_name FROM execution_approvers ea JOIN users u ON u.id = ea.user_id WHERE ea.execution_id = ? ORDER BY u.display_name ASC`
  ).bind(id).all<{ display_name: string }>();
  const execSupervisorNames = (execSupRows.results ?? []).map((r) => r.display_name);
  const execApproverNames = (execAprRows.results ?? []).map((r) => r.display_name);
  // Lấy người được phân công và số bằng chứng cho từng bước (cho tab sơ đồ).
  const assigneeMap = new Map<string, { display_name: string }[]>();
  const supAssigneeMap = new Map<string, { display_name: string }[]>();
  const evidenceMap = new Map<string, number>();
  if (execStepIds.length > 0) {
    const placeholders = execStepIds.map(() => "?").join(",");
    const asgRows = await db.prepare(
      `SELECT esa.execution_step_id, u.display_name
       FROM execution_step_assignees esa JOIN users u ON u.id = esa.user_id
       WHERE esa.execution_step_id IN (${placeholders})`
    ).bind(...execStepIds).all<{ execution_step_id: string; display_name: string }>();
    for (const r of asgRows.results ?? []) {
      if (!assigneeMap.has(r.execution_step_id)) assigneeMap.set(r.execution_step_id, []);
      assigneeMap.get(r.execution_step_id)!.push({ display_name: r.display_name });
    }
    const supAsgRows = await db.prepare(
      `SELECT essa.execution_step_id, u.display_name
       FROM execution_step_supervisor_assignees essa JOIN users u ON u.id = essa.user_id
       WHERE essa.execution_step_id IN (${placeholders})`
    ).bind(...execStepIds).all<{ execution_step_id: string; display_name: string }>();
    for (const r of supAsgRows.results ?? []) {
      if (!supAssigneeMap.has(r.execution_step_id)) supAssigneeMap.set(r.execution_step_id, []);
      supAssigneeMap.get(r.execution_step_id)!.push({ display_name: r.display_name });
    }
    const evRows = await db.prepare(
      `SELECT execution_step_id, COUNT(*) as cnt FROM evidence
       WHERE execution_step_id IN (${placeholders}) GROUP BY execution_step_id`
    ).bind(...execStepIds).all<{ execution_step_id: string; cnt: number }>();
    for (const r of evRows.results ?? []) evidenceMap.set(r.execution_step_id, r.cnt);
  }
  return ok({
    ...toPublicExec(e, pname?.name, progress, redoInfo),
    process_code: pname?.code ?? null,
    version_number: vrow?.version_number ?? null,
    assignee_name: e.assignee_id ? nameById[e.assignee_id] ?? null : null,
    creator_name: creatorId ? nameById[creatorId] ?? null : null,
    creator_position_name: creatorPositionName,
    supervisor_name: e.supervisor_id ? nameById[e.supervisor_id] ?? null : null,
    supervisor_names: execSupervisorNames,
    approver_names: execApproverNames,
    approver_id: (e as unknown as Record<string, unknown>).approver_id ?? null,
    approver_name: (e as unknown as Record<string, unknown>).approver_id ? nameById[(e as unknown as Record<string, unknown>).approver_id as string] ?? null : null,
    approved_by_name: (e as unknown as Record<string, unknown>).approved_by ? nameById[(e as unknown as Record<string, unknown>).approved_by as string] ?? null : null,
    approved_at: (e as unknown as Record<string, unknown>).approved_at ?? null,
    reject_history: rejectHistory,
    steps: (steps.results ?? []).map((s) => ({
      ...toPublicStep(s),
      positions: execPosMap.get(s.id) ?? [],
      supervisors: execSupMap.get(s.id) ?? [],
      assignees: assigneeMap.get(s.id) ?? [],
      supervisor_assignees: supAssigneeMap.get(s.id) ?? [],
      evidence_count: evidenceMap.get(s.id) ?? 0,
    })),
  });
}

// PATCH /api/v1/executions/{id} — sửa lượt ở trạng thái Mới tạo (CREATED).
export async function handleUpdateExecution(ctx: Ctx, id: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  if (e.status !== "CREATED") {
    return apiError("VALIDATION_ERROR", "Chỉ sửa được lượt ở trạng thái Mới tạo.", ctx.requestId);
  }
  // Chỉ người tạo hoặc người có quyền manage mới được sửa.
  const canManage = me.permissions.includes("*") || me.permissions.includes("executions.manage");
  const creatorId = (e as unknown as Record<string, unknown>).creator_id as string | null;
  if (!canManage && me.user.id !== creatorId && me.user.id !== e.created_by) {
    return apiError("FORBIDDEN", "Bạn không có quyền sửa lượt này.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const updates: string[] = [];
  const binds: unknown[] = [];
  const setIf = (col: string, val: unknown) => { updates.push(`${col} = ?`); binds.push(val); };

  if ("title" in (body ?? {})) {
    const v = typeof body?.title === "string" ? body.title.trim() || null : null;
    setIf("title", v);
  }
  if ("assignee_id" in (body ?? {})) {
    const v = typeof body?.assignee_id === "string" && body.assignee_id.trim() ? body.assignee_id.trim() : null;
    if (v) {
      const u = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(v).first();
      if (!u) return apiError("VALIDATION_ERROR", "Người thực hiện không tồn tại.", ctx.requestId);
    }
    setIf("assignee_id", v ?? me.user.id);
  }
  if ("expected_start_at" in (body ?? {})) {
    const v = typeof body?.expected_start_at === "string" ? body.expected_start_at.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      return apiError("VALIDATION_ERROR", "Thời gian bắt đầu (dự kiến) không hợp lệ.", ctx.requestId);
    }
    setIf("expected_start_at", v);
    // Giữ đồng bộ execution_date/execution_time/shift.
    setIf("execution_date", v.slice(0, 10));
    const t = v.slice(11, 16);
    setIf("execution_time", t);
    setIf("shift", deriveShift(t));
  }
  if ("expected_end_at" in (body ?? {})) {
    const v = typeof body?.expected_end_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.expected_end_at.trim())
      ? body.expected_end_at.trim() : null;
    setIf("expected_end_at", v);
  }
  if ("supervisor_id" in (body ?? {})) {
    const v = typeof body?.supervisor_id === "string" && body.supervisor_id.trim() ? body.supervisor_id.trim() : null;
    if (v) {
      const u = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(v).first();
      if (!u) return apiError("VALIDATION_ERROR", "Người giám sát không tồn tại.", ctx.requestId);
    }
    setIf("supervisor_id", v);
  }
  if ("approver_id" in (body ?? {})) {
    const v = typeof body?.approver_id === "string" && body.approver_id.trim() ? body.approver_id.trim() : null;
    if (v) {
      const u = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(v).first();
      if (!u) return apiError("VALIDATION_ERROR", "Người phê duyệt không tồn tại.", ctx.requestId);
    }
    setIf("approver_id", v);
  }
  if ("due_at" in (body ?? {})) {
    const v = typeof body?.due_at === "string" && body.due_at.trim() ? body.due_at.trim() : null;
    setIf("due_at", v);
  }
  if (updates.length === 0) {
    return apiError("VALIDATION_ERROR", "Không có gì để sửa.", ctx.requestId);
  }
  updates.push("updated_at = ?");
  binds.push(nowIso());
  binds.push(id);
  await db.prepare(`UPDATE executions SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
  await audit(db, {
    event_type: "EXECUTION_UPDATED",
    actor_id: me.user.id,
    object_type: "execution",
    object_id: id,
    request_id: ctx.requestId,
    diff: { updated_fields: updates.map((u) => u.split(" = ")[0]) },
  });
  const updated = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  const progress = await getProgress(db, id);
  const redoInfo = await getRedoInfo(db, id);
  return ok(toPublicExec(updated!, undefined, progress, redoInfo));
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

/** GET /executions/{eid}/steps/{sid}/supervisors — danh sách người giám sát được gán. */
export async function handleListStepSupervisors(ctx: Ctx, execId: string, stepId: string) {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const rows = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.position, a.assigned_at
    FROM execution_step_supervisor_assignees a
    JOIN users u ON u.id = a.user_id
    WHERE a.execution_step_id = ?
    ORDER BY a.assigned_at ASC
  `).bind(stepId).all();
  return ok({ items: rows.results ?? [] });
}

/** PUT /executions/{eid}/steps/{sid}/supervisors — gán danh sách người giám sát (thay thế toàn bộ). */
export async function handleSetStepSupervisors(ctx: Ctx, execId: string, stepId: string) {
  const me = await requirePermission(ctx, "executions.execute");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const step = await db.prepare(`SELECT id, execution_id, status FROM execution_steps WHERE id = ?`).bind(stepId).first<{ id: string; execution_id: string; status: string }>();
  if (!step || step.execution_id !== execId) {
    return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  }
  if (["PASSED", "SKIPPED", "CANCELLED"].includes(step.status)) {
    return apiError("VALIDATION_ERROR", "Bước đã hoàn thành — không thể thay đổi người giám sát.", ctx.requestId);
  }
  const pendingSkip = await db.prepare(
    `SELECT id FROM skip_requests WHERE execution_id = ? AND step_id = ? AND status = 'PENDING' LIMIT 1`
  ).bind(execId, stepId).first();
  if (pendingSkip) {
    return apiError("VALIDATION_ERROR", "Bước đang chờ duyệt yêu cầu bỏ qua — không thể thay đổi người giám sát.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const userIds = Array.isArray(body?.user_ids) ? body.user_ids.filter((x): x is string => typeof x === "string") : [];
  for (const uid of userIds) {
    const u = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(uid).first();
    if (!u) return apiError("VALIDATION_ERROR", `Người dùng không tồn tại: ${uid}`, ctx.requestId);
  }

  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM execution_step_supervisor_assignees WHERE execution_step_id = ?`).bind(stepId),
  ];
  for (const uid of [...new Set(userIds)]) {
    stmts.push(
      db.prepare(`INSERT INTO execution_step_supervisor_assignees (execution_step_id, user_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)`)
        .bind(stepId, uid, now, me.user.id)
    );
  }
  await db.batch(stmts);

  await audit(db, {
    event_type: "STEP_SUPERVISORS_SET",
    actor_id: me.user.id,
    object_type: "execution_step",
    object_id: stepId,
    request_id: ctx.requestId,
    diff: { user_ids: userIds },
  });
  return ok({ assigned: [...new Set(userIds)].length });
}

/** PUT /executions/{eid}/steps/{sid}/assignees — gán danh sách người (thay thế toàn bộ). */
export async function handleSetStepAssignees(ctx: Ctx, execId: string, stepId: string) {
  const me = await requirePermission(ctx, "executions.execute");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const step = await db.prepare(`SELECT id, execution_id, status FROM execution_steps WHERE id = ?`).bind(stepId).first<{ id: string; execution_id: string; status: string }>();
  if (!step || step.execution_id !== execId) {
    return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  }
  // Người thực hiện bị cố định khi bước đã hoàn thành/bỏ qua/hủy.
  if (["PASSED", "SKIPPED", "CANCELLED"].includes(step.status)) {
    return apiError("VALIDATION_ERROR", "Bước đã hoàn thành — không thể thay đổi người thực hiện.", ctx.requestId);
  }
  // Chặn đổi người thực hiện khi đang có yêu cầu xin bỏ qua chờ duyệt.
  const pendingSkipAssign = await db.prepare(
    `SELECT id FROM skip_requests WHERE execution_id = ? AND step_id = ? AND status = 'PENDING' LIMIT 1`
  ).bind(execId, stepId).first();
  if (pendingSkipAssign) {
    return apiError("VALIDATION_ERROR", "Bước đang chờ duyệt yêu cầu bỏ qua — không thể thay đổi người thực hiện.", ctx.requestId);
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
  if (to === "PENDING_CONFIRMATION") {
    // EXE-009: chỉ báo hoàn thành khi mọi bước bắt buộc đã PASSED/SKIPPED hợp lệ.
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
  }
  if (to === "COMPLETED") {
    updates.push("completed_at = ?");
    binds.push(now);
    // Kiểm tra quyền xác nhận hoàn thành (chỉ khi từ PENDING_CONFIRMATION).
    const approverRows = await db.prepare(`SELECT user_id FROM execution_approvers WHERE execution_id = ?`).bind(id).all<{ user_id: string }>();
    const approverIds = (approverRows.results ?? []).map((r) => r.user_id);
    // Fallback cột cũ.
    const legacyApprover = (e as unknown as Record<string, unknown>).approver_id as string | null;
    if (legacyApprover && !approverIds.includes(legacyApprover)) approverIds.push(legacyApprover);
    const supRows = await db.prepare(`SELECT user_id FROM execution_supervisors WHERE execution_id = ?`).bind(id).all<{ user_id: string }>();
    const supervisorIds = (supRows.results ?? []).map((r) => r.user_id);
    const legacySup = e.supervisor_id as string | null;
    if (legacySup && !supervisorIds.includes(legacySup)) supervisorIds.push(legacySup);
    const isAdmin = me.permissions.includes("*") || me.permissions.includes("executions.manage");
    let canApprove = false;
    if (approverIds.length > 0) {
      // Đã chỉ định người phê duyệt: bất kỳ ai trong danh sách hoặc admin mới xác nhận được.
      canApprove = approverIds.includes(me.user.id) || isAdmin;
      if (!canApprove) {
        return apiError("FORBIDDEN", "Chỉ người phê duyệt được chỉ định mới có thể xác nhận hoàn thành.", ctx.requestId);
      }
    } else {
      // Không chỉ định: người giám sát hoặc người có quyền quản lý lượt mới xác nhận được.
      canApprove = supervisorIds.includes(me.user.id) || isAdmin;
      if (!canApprove) {
        return apiError("FORBIDDEN", "Chỉ người giám sát hoặc quản lý mới có thể xác nhận hoàn thành.", ctx.requestId);
      }
    }
    updates.push("approved_by = ?");
    binds.push(me.user.id);
    updates.push("approved_at = ?");
    binds.push(now);
  }
  if (to === "CANCELLED") {
    const reason = extra?.cancel_reason?.trim();
    if (!reason) {
      return apiError("VALIDATION_ERROR", "Hủy lượt bắt buộc phải có lý do.", ctx.requestId);
    }
    updates.push("cancel_reason = ?");
    binds.push(reason);
    // Hủy tất cả các bước chưa hoàn thành.
    await db.prepare(
      `UPDATE execution_steps SET status = 'CANCELLED', updated_at = ? WHERE execution_id = ? AND status IN ('NOT_STARTED', 'IN_PROGRESS')`
    ).bind(now, id).run();
    // Hủy tất cả yêu cầu xin bỏ qua đang chờ duyệt.
    await db.prepare(
      `UPDATE skip_requests SET status = 'REJECTED', reject_reason = 'Lượt công việc bị hủy', reviewed_by = ?, reviewed_at = ? WHERE execution_id = ? AND status = 'PENDING'`
    ).bind(me.user.id, now, id).run();
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
  // Gửi thông báo theo trạng thái đích.
  const execCode = e.code;
  const execLink = `#/executions/${id}`;
  if (to === "IN_PROGRESS" && e.status === "CREATED") {
    // Bắt đầu lượt → thông báo cho giám sát và người phê duyệt.
    const supRows = await db.prepare(`SELECT user_id FROM execution_supervisors WHERE execution_id = ?`).bind(id).all<{ user_id: string }>();
    const aprRows = await db.prepare(`SELECT user_id FROM execution_approvers WHERE execution_id = ?`).bind(id).all<{ user_id: string }>();
    const notifyIds = [
      ...(supRows.results ?? []).map((r) => r.user_id),
      ...(aprRows.results ?? []).map((r) => r.user_id),
      e.supervisor_id as string | null,
      (e as unknown as Record<string, unknown>).approver_id as string | null,
    ].filter((x): x is string => !!x && x !== me.user.id);
    const uniqueIds = [...new Set(notifyIds)];
    if (uniqueIds.length > 0) {
      await notifyUsers(db, uniqueIds, {
        type: "EXECUTION_STARTED",
        title: `Lượt ${execCode} đã bắt đầu`,
        message: `${me.user.display_name} đã bắt đầu thực hiện lượt ${execCode}.`,
        link: execLink,
      });
    }
  }
  if (to === "PENDING_CONFIRMATION") {
    // Báo hoàn thành → thông báo cho người phê duyệt/giám sát.
    const approverId = (e as unknown as Record<string, unknown>).approver_id as string | null;
    const supervisorId = e.supervisor_id as string | null;
    const notifyIds = [approverId, supervisorId].filter((x): x is string => !!x && x !== me.user.id);
    if (notifyIds.length > 0) {
      await notifyUsers(db, notifyIds, {
        type: "EXECUTION_REPORTED",
        title: `Lượt ${execCode} chờ xác nhận hoàn thành`,
        message: `${me.user.display_name} đã báo hoàn thành lượt ${execCode}. Vui lòng vào xác nhận.`,
        link: execLink,
      });
    }
  } else if (to === "COMPLETED") {
    // Xác nhận hoàn thành → thông báo cho người tạo và người được giao.
    const notifyIds = [e.created_by, e.assignee_id, (e as unknown as Record<string, unknown>).creator_id as string | null]
      .filter((x): x is string => !!x && x !== me.user.id);
    if (notifyIds.length > 0) {
      await notifyUsers(db, notifyIds, {
        type: "EXECUTION_CONFIRMED",
        title: `Lượt ${execCode} đã hoàn thành`,
        message: `${me.user.display_name} đã xác nhận hoàn thành lượt ${execCode}.`,
        link: execLink,
      });
    }
  } else if (to === "CANCELLED") {
    // Hủy lượt → thông báo cho người tạo và người được giao.
    const notifyIds = [e.created_by, e.assignee_id, (e as unknown as Record<string, unknown>).creator_id as string | null]
      .filter((x): x is string => !!x && x !== me.user.id);
    if (notifyIds.length > 0) {
      await notifyUsers(db, notifyIds, {
        type: "EXECUTION_CANCELLED",
        title: `Lượt ${execCode} đã bị hủy`,
        message: `${me.user.display_name} đã hủy lượt ${execCode}. Lý do: ${extra?.cancel_reason ?? ""}`,
        link: execLink,
      });
    }
  }
  const updated = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  const progress = await getProgress(db, id);
  const redoInfo = await getRedoInfo(db, id);
  return ok(toPublicExec(updated!, undefined, progress, redoInfo));
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
  return transitionExecution(ctx, id, ["CREATED", "IN_PROGRESS", "PAUSED", "PENDING_CONFIRMATION"], "CANCELLED", null, "EXECUTION_CANCELLED", {
    cancel_reason: reason,
  });
}
// POST .../{id}:report-complete — IN_PROGRESS -> PENDING_CONFIRMATION (Báo hoàn thành).
// Người thực hiện báo đã làm xong, chờ người phê duyệt xác nhận.
export const handleReportComplete = (ctx: Ctx, id: string) =>
  transitionExecution(ctx, id, ["IN_PROGRESS"], "PENDING_CONFIRMATION", null, "EXECUTION_REPORTED_COMPLETE");
// POST .../{id}:confirm-complete — PENDING_CONFIRMATION -> COMPLETED (Xác nhận hoàn thành).
// Chỉ người phê duyệt/giám sát/quản lý được xác nhận (logic kiểm tra trong transitionExecution).
export const handleConfirmComplete = (ctx: Ctx, id: string) =>
  transitionExecution(ctx, id, ["PENDING_CONFIRMATION"], "COMPLETED", null, "EXECUTION_COMPLETED");

// POST .../{id}:reject-confirmation — Từ chối xác nhận hoàn thành.
// Body: { action: "cancel", reason } → hủy cả lượt
//    hoặc { action: "redo", step_ids: [...], reason } → yêu cầu làm lại các bước đã chọn.
export async function handleRejectConfirmation(ctx: Ctx, id: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!["cancel", "redo"].includes(action)) {
    return apiError("VALIDATION_ERROR", "Hành động không hợp lệ.", ctx.requestId);
  }
  if (!reason) {
    return apiError("VALIDATION_ERROR", "Từ chối bắt buộc phải có lý do.", ctx.requestId);
  }

  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  if (e.status !== "PENDING_CONFIRMATION") {
    return apiError("VALIDATION_ERROR", "Chỉ từ chối được khi lượt đang chờ xác nhận.", ctx.requestId);
  }
  // Chỉ người có quyền xác nhận mới được từ chối (dùng logic giống confirm).
  const approverId = (e as unknown as Record<string, unknown>).approver_id as string | null;
  const supervisorId = e.supervisor_id as string | null;
  const isAdmin = me.permissions.includes("*") || me.permissions.includes("executions.manage");
  const canReject = approverId
    ? (me.user.id === approverId || isAdmin)
    : (me.user.id === supervisorId || isAdmin);
  if (!canReject) {
    return apiError("FORBIDDEN", "Bạn không có quyền từ chối xác nhận lượt này.", ctx.requestId);
  }

  const now = nowIso();
  if (action === "cancel") {
    // Phương án 1: hủy cả lượt.
    await db.prepare(`UPDATE executions SET status = 'CANCELLED', cancel_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(`Từ chối xác nhận: ${reason}`, now, id).run();
    await audit(db, {
      event_type: "EXECUTION_CONFIRM_REJECTED_CANCEL",
      actor_id: me.user.id,
      object_type: "execution",
      object_id: id,
      request_id: ctx.requestId,
      diff: { reason },
    });
  } else {
    // Phương án 2: yêu cầu làm lại các bước đã chọn.
    const stepIds = Array.isArray(body?.step_ids)
      ? (body.step_ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (stepIds.length === 0) {
      return apiError("VALIDATION_ERROR", "Vui lòng chọn ít nhất 1 bước cần làm lại.", ctx.requestId);
    }
    try {
      // Kiểm tra các bước thuộc lượt này.
      const placeholders = stepIds.map(() => "?").join(",");
      const steps = await db.prepare(
        `SELECT id FROM execution_steps WHERE id IN (${placeholders}) AND execution_id = ?`
      ).bind(...stepIds, id).all<{ id: string }>();
      if ((steps.results ?? []).length !== stepIds.length) {
        return apiError("VALIDATION_ERROR", "Có bước không thuộc lượt này.", ctx.requestId);
      }
      // Reset các bước về NOT_STARTED + lưu vết làm lại.
      for (const sid of stepIds) {
        await db.prepare(
          `UPDATE execution_steps SET status = 'NOT_STARTED', redo_count = redo_count + 1, redo_reason = ?, redo_by = ?, redo_at = ?, updated_at = ? WHERE id = ?`
        ).bind(reason, me.user.id, now, now, sid).run();
      }
      // Lượt quay về IN_PROGRESS để làm lại.
      await db.prepare(`UPDATE executions SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?`).bind(now, id).run();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[reject-confirmation] redo failed:", detail);
      return apiError("VALIDATION_ERROR", `Lỗi làm lại: ${detail}`, ctx.requestId);
    }
    await audit(db, {
      event_type: "EXECUTION_CONFIRM_REJECTED_REDO",
      actor_id: me.user.id,
      object_type: "execution",
      object_id: id,
      request_id: ctx.requestId,
      diff: { reason, step_ids: stepIds },
    });
    // Thông báo cho người thực hiện biết bị trả lại làm lại.
    const notifyIds = [e.assignee_id, e.created_by].filter((x): x is string => !!x && x !== me.user.id);
    if (notifyIds.length > 0) {
      await notifyUsers(db, notifyIds, {
        type: "EXECUTION_REJECTED",
        title: `Lượt ${e.code} bị yêu cầu làm lại`,
        message: `${me.user.display_name} đã từ chối xác nhận lượt ${e.code}, yêu cầu làm lại ${stepIds.length} bước. Lý do: ${reason}`,
        link: `#/executions/${id}`,
      });
    }
  }
  const updated = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(id).first<ExecutionRow>();
  const progress = await getProgress(db, id);
  const redoInfo = await getRedoInfo(db, id);
  return ok(toPublicExec(updated!, undefined, progress, redoInfo));
}

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
  // Chặn bắt đầu khi đang có yêu cầu xin bỏ qua chờ duyệt.
  const pendingSkip = await db.prepare(
    `SELECT id FROM skip_requests WHERE execution_id = ? AND step_id = ? AND status = 'PENDING' LIMIT 1`
  ).bind(execId, stepId).first();
  if (pendingSkip) {
    return apiError("VALIDATION_ERROR", "Bước đang chờ duyệt yêu cầu bỏ qua — không thể bắt đầu.", ctx.requestId);
  }
  // Người thực hiện là bắt buộc khi bắt đầu bước.
  const asgCount = await db.prepare(
    `SELECT COUNT(*) as cnt FROM execution_step_assignees WHERE execution_step_id = ?`
  ).bind(stepId).first<{ cnt: number }>();
  if (!asgCount || asgCount.cnt === 0) {
    return apiError("VALIDATION_ERROR", "Chưa phân công người thực hiện — không thể bắt đầu bước.", ctx.requestId);
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
  // Chặn hoàn thành khi đang có yêu cầu xin bỏ qua chờ duyệt.
  const pendingSkipComplete = await db.prepare(
    `SELECT id FROM skip_requests WHERE execution_id = ? AND step_id = ? AND status = 'PENDING' LIMIT 1`
  ).bind(execId, stepId).first();
  if (pendingSkipComplete) {
    return apiError("VALIDATION_ERROR", "Bước đang chờ duyệt yêu cầu bỏ qua — không thể hoàn thành.", ctx.requestId);
  }
  // Người thực hiện là bắt buộc khi hoàn thành bước.
  const asgCountComplete = await db.prepare(
    `SELECT COUNT(*) as cnt FROM execution_step_assignees WHERE execution_step_id = ?`
  ).bind(stepId).first<{ cnt: number }>();
  if (!asgCountComplete || asgCountComplete.cnt === 0) {
    return apiError("VALIDATION_ERROR", "Chưa phân công người thực hiện — không thể hoàn thành bước.", ctx.requestId);
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
  // Kiểm tra quyền bỏ qua: bước không bắt buộc HOẶC có skip_policy cho phép.
  const skipPolicy = step.skip_policy ? JSON.parse(step.skip_policy) as { allowed?: boolean } : null;
  const canSkipByPolicy = skipPolicy?.allowed === true;
  if (step.is_required === 1 && !canSkipByPolicy) {
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

// POST /executions/:id/steps/:stepId:request-skip — người thực hiện xin bỏ qua bước.
export async function handleRequestSkip(ctx: Ctx, execId: string, stepId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const e = await db.prepare(`SELECT * FROM executions WHERE id = ?`).bind(execId).first<ExecutionRow>();
  if (!e) return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
  const step = await db.prepare(`SELECT * FROM execution_steps WHERE id = ? AND execution_id = ?`).bind(stepId, execId).first<ExecStepRow>();
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  const skipPolicy = step.skip_policy ? JSON.parse(step.skip_policy) as { allowed?: boolean } : null;
  if (!skipPolicy?.allowed) {
    return apiError("VALIDATION_ERROR", "Bước này không cho phép bỏ qua.", ctx.requestId);
  }
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return apiError("VALIDATION_ERROR", "Vui lòng nhập lý do xin bỏ qua.", ctx.requestId);

  const id = newId();
  const now = nowIso();
  try {
    await db.prepare(
      `INSERT INTO skip_requests (id, execution_id, step_id, requested_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, execId, stepId, me.user.id, reason, now).run();
  } catch {
    return apiError("VALIDATION_ERROR", "Đã có yêu cầu đang chờ duyệt.", ctx.requestId);
  }
  // Thông báo cho giám sát: ưu tiên giám sát của bước, fallback giám sát của lượt.
  const stepSupRows = await db.prepare(`SELECT user_id FROM execution_step_supervisor_assignees WHERE execution_step_id = ?`).bind(stepId).all<{ user_id: string }>();
  let notifyIds: string[];
  if ((stepSupRows.results ?? []).length > 0) {
    notifyIds = [...new Set((stepSupRows.results ?? []).map((r) => r.user_id))].filter((x) => x !== me.user.id);
  } else {
    const supRows = await db.prepare(`SELECT user_id FROM execution_supervisors WHERE execution_id = ?`).bind(execId).all<{ user_id: string }>();
    notifyIds = [...new Set((supRows.results ?? []).map((r) => r.user_id))].filter((x) => x !== me.user.id);
  }
  if (notifyIds.length > 0) {
    await notifyUsers(db, notifyIds, {
      type: "SKIP_REQUESTED",
      title: `Xin bỏ qua bước ${step.code}`,
      message: `${me.user.display_name} xin bỏ qua bước ${step.code} (${step.title}). Lý do: ${reason}`,
      link: `#/executions/${execId}`,
    });
  }
  return ok({ requested: true });
}

// POST /executions/:id/steps/:stepId:approve-skip — giám sát duyệt yêu cầu bỏ qua.
export async function handleApproveSkip(ctx: Ctx, execId: string, stepId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const req = await db.prepare(
    `SELECT * FROM skip_requests WHERE execution_id = ? AND step_id = ? AND status = 'PENDING'`
  ).bind(execId, stepId).first<{ id: string; requested_by: string }>();
  if (!req) return apiError("NOT_FOUND", "Không có yêu cầu đang chờ.", ctx.requestId);
  const now = nowIso();
  await db.prepare(`UPDATE skip_requests SET status = 'APPROVED', reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
    .bind(me.user.id, now, req.id).run();
  // Đánh dấu bước đã bỏ qua.
  await db.prepare(`UPDATE execution_steps SET status = 'SKIPPED', completed_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, stepId).run();
  await notifyUsers(db, [req.requested_by], {
    type: "SKIP_APPROVED",
    title: `Yêu cầu bỏ qua được duyệt`,
    message: `${me.user.display_name} đã duyệt yêu cầu bỏ qua bước của bạn.`,
    link: `#/executions/${execId}`,
  });
  return ok({ approved: true });
}

// POST /executions/:id/steps/:stepId:reject-skip — giám sát từ chối yêu cầu bỏ qua.
export async function handleRejectSkip(ctx: Ctx, execId: string, stepId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const req = await db.prepare(
    `SELECT * FROM skip_requests WHERE execution_id = ? AND step_id = ? AND status = 'PENDING'`
  ).bind(execId, stepId).first<{ id: string; requested_by: string }>();
  if (!req) return apiError("NOT_FOUND", "Không có yêu cầu đang chờ.", ctx.requestId);
  await db.prepare(`UPDATE skip_requests SET status = 'REJECTED', reviewed_by = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?`)
    .bind(me.user.id, nowIso(), reason || null, req.id).run();
  await notifyUsers(db, [req.requested_by], {
    type: "SKIP_REJECTED",
    title: `Yêu cầu bỏ qua bị từ chối`,
    message: `${me.user.display_name} đã từ chối yêu cầu bỏ qua bước của bạn.${reason ? " Lý do: " + reason : ""}`,
    link: `#/executions/${execId}`,
  });
  return ok({ rejected: true });
}

// GET /executions/:id/skip-requests — lấy danh sách yêu cầu xin bỏ qua đang chờ.
export async function handleListSkipRequests(ctx: Ctx, execId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const rows = await db.prepare(
    `SELECT sr.*, u.display_name AS requester_name, es.code AS step_code, es.title AS step_title
     FROM skip_requests sr
     JOIN users u ON u.id = sr.requested_by
     JOIN execution_steps es ON es.id = sr.step_id
     WHERE sr.execution_id = ? AND sr.status = 'PENDING'
     ORDER BY sr.created_at ASC`
  ).bind(execId).all();
  return ok({ items: rows.results ?? [] });
}
