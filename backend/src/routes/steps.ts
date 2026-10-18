// routes/steps.ts — bước công việc trong phiên bản quy trình (Task 1.5).
// Khớp SRS v1.6: PRC-004–009; §7.1 (chỉ bản DRAFT được sửa cấu trúc).
//
// Quy tắc: mọi thao tác sửa/xóa/sắp xếp bước đều yêu cầu version ở trạng thái DRAFT.
// Quyền: processes.manage (soạn thảo).

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission, type SessionInfo } from "./auth";
import type { Ctx } from "./context";

type StepRow = {
  id: string;
  version_id: string;
  sort_order: number;
  code: string;
  title: string;
  prerequisite: string | null;
  input_desc: string | null;
  instruction: string | null;
  expected_result: string | null;
  output_desc: string | null;
  note: string | null;
  role: string | null;
  is_required: number;
  target_duration_min: number | null;
  warning: string | null;
  completion_req: string | null;
  skip_policy: string | null;
  failure_policy: string | null;
  created_at: string;
  updated_at: string | null;
};

function toPublicStep(s: StepRow) {
  const parse = (v: string | null) => {
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  return {
    id: s.id,
    version_id: s.version_id,
    sort_order: s.sort_order,
    code: s.code,
    title: s.title,
    prerequisite: s.prerequisite,
    input_desc: s.input_desc,
    instruction: s.instruction,
    expected_result: s.expected_result,
    output_desc: s.output_desc,
    note: s.note,
    role: s.role,
    is_required: s.is_required === 1,
    target_duration_min: s.target_duration_min,
    warning: s.warning,
    completion_req: parse(s.completion_req),
    skip_policy: parse(s.skip_policy),
    failure_policy: parse(s.failure_policy),
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

/** Lấy version và kiểm tra quyền sửa (phải là DRAFT). */
async function getEditableVersion(
  db: D1Database,
  versionId: string
): Promise<{ row: { id: string; status: string; process_id: string } | null; error?: string }> {
  const row = await db
    .prepare(`SELECT id, status, process_id FROM process_versions WHERE id = ?`)
    .bind(versionId)
    .first<{ id: string; status: string; process_id: string }>();
  if (!row) return { row: null, error: "NOT_FOUND" };
  if (row.status !== "DRAFT") return { row, error: "LOCKED" };
  return { row };
}

async function nextSortOrder(db: D1Database, versionId: string): Promise<number> {
  const r = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM process_steps WHERE version_id = ?`)
    .bind(versionId)
    .first<{ n: number }>();
  return r?.n ?? 1;
}

// GET /api/v1/processes/{pid}/versions/{vid}/steps — danh sách bước theo thứ tự.
export async function handleListSteps(ctx: Ctx, versionId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const v = await db.prepare(`SELECT id FROM process_versions WHERE id = ?`).bind(versionId).first();
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  const rows = await db
    .prepare(`SELECT * FROM process_steps WHERE version_id = ? ORDER BY sort_order ASC`)
    .bind(versionId)
    .all<StepRow>();
  // Lấy danh sách chức vụ cho từng bước.
  const stepIds = (rows.results ?? []).map((s) => s.id);
  const posMap = new Map<string, { id: string; name: string }[]>();
  if (stepIds.length > 0) {
    const placeholders = stepIds.map(() => "?").join(",");
    const posRows = await db.prepare(
      `SELECT psp.step_id, p.id, p.name FROM process_step_positions psp
       JOIN positions p ON p.id = psp.position_id
       WHERE psp.step_id IN (${placeholders}) ORDER BY p.name ASC`
    ).bind(...stepIds).all<{ step_id: string; id: string; name: string }>();
    for (const r of posRows.results ?? []) {
      if (!posMap.has(r.step_id)) posMap.set(r.step_id, []);
      posMap.get(r.step_id)!.push({ id: r.id, name: r.name });
    }
  }
  return ok({
    items: (rows.results ?? []).map((s) => ({ ...toPublicStep(s), positions: posMap.get(s.id) ?? [] })),
    total: (rows.results ?? []).length,
  });
}

// POST .../steps — thêm bước mới (PRC-004, PRC-005).
export async function handleCreateStep(ctx: Ctx, versionId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const { row: v, error } = await getEditableVersion(db, versionId);
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (error === "LOCKED") {
    return apiError("VALIDATION_ERROR", "Chỉ được sửa bước khi phiên bản ở trạng thái Bản nháp.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const code = String(body?.code ?? "").trim().toUpperCase();
  const title = String(body?.title ?? "").trim();
  if (!code || code.length > 32) {
    return apiError("VALIDATION_ERROR", "Mã bước không được trống và tối đa 32 ký tự.", ctx.requestId);
  }
  if (!title || title.length > 200) {
    return apiError("VALIDATION_ERROR", "Tiêu đề bước không được trống và tối đa 200 ký tự.", ctx.requestId);
  }
  const dup = await db
    .prepare(`SELECT id FROM process_steps WHERE version_id = ? AND code = ?`)
    .bind(versionId, code)
    .first();
  if (dup) {
    return apiError("VALIDATION_ERROR", "Mã bước đã tồn tại trong phiên bản này.", ctx.requestId, {
      field: "code",
    });
  }

  const str = (k: string) => {
    const val = body?.[k];
    return typeof val === "string" ? val.trim() || null : null;
  };
  const json = (k: string) => {
    const val = body?.[k];
    if (val == null) return null;
    try {
      return JSON.stringify(val);
    } catch {
      return null;
    }
  };
  const now = nowIso();
  const id = newId();
  const order = nextSortOrderFn(await nextSortOrder(db, versionId), body);
  // Vai trò người thực hiện: mảng nhiều chức vụ.
  const positionIds = Array.isArray(body?.position_ids)
    ? (body.position_ids as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : (typeof body?.position_id === "string" && body.position_id.trim() ? [body.position_id.trim()] : []);
  if (positionIds.length > 0) {
    const placeholders = positionIds.map(() => "?").join(",");
    const found = await db.prepare(`SELECT id FROM positions WHERE id IN (${placeholders})`).bind(...positionIds).all();
    if ((found.results ?? []).length !== positionIds.length) {
      return apiError("VALIDATION_ERROR", "Chức vụ không tồn tại.", ctx.requestId);
    }
  }
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO process_steps (id, version_id, sort_order, code, title, prerequisite, input_desc, instruction,
        expected_result, output_desc, note, role, is_required, target_duration_min, warning,
        completion_req, skip_policy, failure_policy, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, versionId, order, code, title,
      str("prerequisite"), str("input_desc"), str("instruction"),
      str("expected_result"), str("output_desc"), str("note"), str("role"),
      body?.is_required === false ? 0 : 1,
      typeof body?.target_duration_min === "number" ? Math.max(0, Math.floor(body.target_duration_min)) : null,
      str("warning"),
      json("completion_req"), json("skip_policy"), json("failure_policy"),
      now, me.user.id
    ),
  ];
  for (const pid of positionIds) {
    stmts.push(db.prepare(`INSERT INTO process_step_positions (step_id, position_id) VALUES (?, ?)`).bind(id, pid));
  }
  await db.batch(stmts);
  await audit(db, {
    event_type: "PROCESS_STEP_CREATED",
    actor_id: me.user.id,
    object_type: "process_step",
    object_id: id,
    request_id: ctx.requestId,
    diff: { version_id: versionId, code, title },
  });
  const created = await db.prepare(`SELECT * FROM process_steps WHERE id = ?`).bind(id).first<StepRow>();
  return ok(toPublicStep(created!), 201);
}

function nextSortOrderFn(maxOrder: number, body: Record<string, unknown> | null): number {
  const want = body?.sort_order;
  if (typeof want === "number" && want >= 1 && Number.isInteger(want)) return want;
  return maxOrder;
}

// PATCH .../steps/{sid} — sửa bước.
export async function handlePatchStep(ctx: Ctx, versionId: string, stepId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const { row: v, error } = await getEditableVersion(db, versionId);
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (error === "LOCKED") {
    return apiError("VALIDATION_ERROR", "Chỉ được sửa bước khi phiên bản ở trạng thái Bản nháp.", ctx.requestId);
  }
  const step = await db
    .prepare(`SELECT * FROM process_steps WHERE id = ? AND version_id = ?`)
    .bind(stepId, versionId)
    .first<StepRow>();
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const updates: string[] = [];
  const binds: unknown[] = [];
  const diff: Record<string, unknown> = {};
  const str = (val: unknown) => (typeof val === "string" ? val.trim() || null : null);

  if (body?.code !== undefined) {
    const code = String(body.code).trim().toUpperCase();
    if (!code || code.length > 32) {
      return apiError("VALIDATION_ERROR", "Mã bước không hợp lệ.", ctx.requestId);
    }
    if (code !== step.code) {
      const dup = await db
        .prepare(`SELECT id FROM process_steps WHERE version_id = ? AND code = ? AND id != ?`)
        .bind(versionId, code, stepId)
        .first();
      if (dup) {
        return apiError("VALIDATION_ERROR", "Mã bước đã tồn tại.", ctx.requestId, { field: "code" });
      }
    }
    updates.push("code = ?");
    binds.push(code);
    diff.code = code;
  }
  if (body?.title !== undefined) {
    const title = String(body.title).trim();
    if (!title || title.length > 200) {
      return apiError("VALIDATION_ERROR", "Tiêu đề bước không hợp lệ.", ctx.requestId);
    }
    updates.push("title = ?");
    binds.push(title);
    diff.title = title;
  }
  for (const f of ["prerequisite", "input_desc", "instruction", "expected_result", "output_desc", "note", "role", "warning"] as const) {
    if (body?.[f] !== undefined) {
      updates.push(`${f} = ?`);
      binds.push(str(body[f]));
      diff[f] = str(body[f]);
    }
  }
  // Cập nhật vai trò người thực hiện (mảng nhiều chức vụ).
  let newPositionIds: string[] | null = null;
  if (body?.position_ids !== undefined || body?.position_id !== undefined) {
    if (Array.isArray(body?.position_ids)) {
      newPositionIds = (body.position_ids as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "");
    } else if (typeof body?.position_id === "string" && body.position_id.trim()) {
      newPositionIds = [body.position_id.trim()];
    } else {
      newPositionIds = [];
    }
    if (newPositionIds.length > 0) {
      const placeholders = newPositionIds.map(() => "?").join(",");
      const found = await db.prepare(`SELECT id FROM positions WHERE id IN (${placeholders})`).bind(...newPositionIds).all();
      if ((found.results ?? []).length !== newPositionIds.length) {
        return apiError("VALIDATION_ERROR", "Chức vụ không tồn tại.", ctx.requestId);
      }
    }
  }
  if (body?.is_required !== undefined) {
    updates.push("is_required = ?");
    binds.push(body.is_required === false ? 0 : 1);
    diff.is_required = body.is_required !== false;
  }
  if (body?.target_duration_min !== undefined) {
    const d = typeof body.target_duration_min === "number" ? Math.max(0, Math.floor(body.target_duration_min)) : null;
    updates.push("target_duration_min = ?");
    binds.push(d);
    diff.target_duration_min = d;
  }
  for (const f of ["completion_req", "skip_policy", "failure_policy"] as const) {
    if (body?.[f] !== undefined) {
      const val = body[f];
      updates.push(`${f} = ?`);
      binds.push(val == null ? null : JSON.stringify(val));
      diff[f] = val ?? null;
    }
  }
  if (updates.length === 0 && newPositionIds === null) {
    return apiError("VALIDATION_ERROR", "Không có gì để cập nhật.", ctx.requestId);
  }
  const stmts: D1PreparedStatement[] = [];
  if (updates.length > 0) {
    updates.push("updated_at = ?", "updated_by = ?");
    binds.push(nowIso(), me.user.id, stepId);
    stmts.push(db.prepare(`UPDATE process_steps SET ${updates.join(", ")} WHERE id = ?`).bind(...binds));
  }
  if (newPositionIds !== null) {
    stmts.push(db.prepare(`DELETE FROM process_step_positions WHERE step_id = ?`).bind(stepId));
    for (const pid of newPositionIds) {
      stmts.push(db.prepare(`INSERT INTO process_step_positions (step_id, position_id) VALUES (?, ?)`).bind(stepId, pid));
    }
    diff.position_ids = newPositionIds;
  }
  await db.batch(stmts);
  await audit(db, {
    event_type: "PROCESS_STEP_UPDATED",
    actor_id: me.user.id,
    object_type: "process_step",
    object_id: stepId,
    request_id: ctx.requestId,
    diff,
  });
  const updated = await db.prepare(`SELECT * FROM process_steps WHERE id = ?`).bind(stepId).first<StepRow>();
  return ok(toPublicStep(updated!));
}

// DELETE .../steps/{sid} — xóa bước (chỉ bản nháp).
export async function handleDeleteStep(ctx: Ctx, versionId: string, stepId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const { row: v, error } = await getEditableVersion(db, versionId);
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (error === "LOCKED") {
    return apiError("VALIDATION_ERROR", "Chỉ được xóa bước khi phiên bản ở trạng thái Bản nháp.", ctx.requestId);
  }
  const step = await db
    .prepare(`SELECT * FROM process_steps WHERE id = ? AND version_id = ?`)
    .bind(stepId, versionId)
    .first<StepRow>();
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);

  // Xóa và dồn thứ tự lại (tách 2 lệnh riêng để tránh xung đột constraint trong batch).
  await db.prepare(`DELETE FROM process_steps WHERE id = ?`).bind(stepId).run();
  // Dồn thứ tự: cập nhật từng bước một cách an toàn qua giá trị âm trung gian.
  const remaining = await db
    .prepare(`SELECT id, sort_order FROM process_steps WHERE version_id = ? ORDER BY sort_order ASC`)
    .bind(versionId)
    .all<{ id: string; sort_order: number }>();
  if (remaining.results.length > 0) {
    const phase1 = remaining.results.map((r) =>
      db.prepare(`UPDATE process_steps SET sort_order = ? WHERE id = ?`).bind(-r.sort_order, r.id)
    );
    await db.batch(phase1);
    const phase2 = remaining.results.map((r, idx) =>
      db.prepare(`UPDATE process_steps SET sort_order = ? WHERE id = ?`).bind(idx + 1, r.id)
    );
    await db.batch(phase2);
  }
  await audit(db, {
    event_type: "PROCESS_STEP_DELETED",
    actor_id: me.user.id,
    object_type: "process_step",
    object_id: stepId,
    request_id: ctx.requestId,
    diff: { code: step.code, title: step.title },
  });
  return ok({ deleted: true, id: stepId });
}

// POST .../steps:reorder — sắp xếp lại thứ tự bước (PRC-004).
export async function handleReorderSteps(ctx: Ctx, versionId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const { row: v, error } = await getEditableVersion(db, versionId);
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (error === "LOCKED") {
    return apiError("VALIDATION_ERROR", "Chỉ được sắp xếp bước khi phiên bản ở trạng thái Bản nháp.", ctx.requestId);
  }
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const ids = body?.step_ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string")) {
    return apiError("VALIDATION_ERROR", "Danh sách step_ids không hợp lệ.", ctx.requestId);
  }
  // Kiểm tra tất cả id thuộc version này.
  const existing = await db
    .prepare(`SELECT id FROM process_steps WHERE version_id = ?`)
    .bind(versionId)
    .all<{ id: string }>();
  const existingIds = new Set(existing.results.map((r) => r.id));
  if (ids.length !== existingIds.size || !ids.every((id) => existingIds.has(id as string))) {
    return apiError("VALIDATION_ERROR", "Danh sách bước không khớp với phiên bản.", ctx.requestId);
  }
  const now = nowIso();
  // Cập nhật 2 pha để tránh vi phạm UNIQUE(version_id, sort_order):
  // pha 1 chuyển tất cả về số âm (không trùng), pha 2 chuyển về thứ tự mới + cập nhật mã B01, B02...
  const phase1 = ids.map((id, idx) =>
    db.prepare(`UPDATE process_steps SET sort_order = ? WHERE id = ?`).bind(-(idx + 1), id)
  );
  const phase2 = ids.map((id, idx) =>
    db.prepare(`UPDATE process_steps SET sort_order = ?, updated_at = ? WHERE id = ?`).bind(idx + 1, now, id)
  );
  await db.batch([...phase1, ...phase2]);
  await audit(db, {
    event_type: "PROCESS_STEPS_REORDERED",
    actor_id: me.user.id,
    object_type: "process_version",
    object_id: versionId,
    request_id: ctx.requestId,
    diff: { order: ids },
  });
  const rows = await db
    .prepare(`SELECT * FROM process_steps WHERE version_id = ? ORDER BY sort_order ASC`)
    .bind(versionId)
    .all<StepRow>();
  return ok({ items: rows.results.map(toPublicStep) });
}

// POST .../steps/{sid}:copy — sao chép bước (PRC-004).
export async function handleCopyStep(ctx: Ctx, versionId: string, stepId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const { row: v, error } = await getEditableVersion(db, versionId);
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (error === "LOCKED") {
    return apiError("VALIDATION_ERROR", "Chỉ được sao chép bước khi phiên bản ở trạng thái Bản nháp.", ctx.requestId);
  }
  const src = await db
    .prepare(`SELECT * FROM process_steps WHERE id = ? AND version_id = ?`)
    .bind(stepId, versionId)
    .first<StepRow>();
  if (!src) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);

  // Tạo mã mới không trùng: CODE-COPY, CODE-COPY-2, ...
  let newCode = `${src.code}-COPY`;
  let suffix = 2;
  while (
    await db.prepare(`SELECT id FROM process_steps WHERE version_id = ? AND code = ?`).bind(versionId, newCode).first()
  ) {
    newCode = `${src.code}-COPY-${suffix++}`;
  }
  const now = nowIso();
  const id = newId();
  const order = await nextSortOrder(db, versionId);
  await db.prepare(
    `INSERT INTO process_steps (id, version_id, sort_order, code, title, prerequisite, input_desc, instruction,
      expected_result, output_desc, note, role, is_required, target_duration_min, warning,
      completion_req, skip_policy, failure_policy, created_at, created_by)
     SELECT ?, ?, ?, ?, title || ' (bản sao)', prerequisite, input_desc, instruction,
      expected_result, output_desc, note, role, is_required, target_duration_min, warning,
      completion_req, skip_policy, failure_policy, ?, ?
     FROM process_steps WHERE id = ?`
  ).bind(id, versionId, order, newCode, now, me.user.id, stepId).run();
  await audit(db, {
    event_type: "PROCESS_STEP_CREATED",
    actor_id: me.user.id,
    object_type: "process_step",
    object_id: id,
    request_id: ctx.requestId,
    diff: { version_id: versionId, code: newCode, copied_from: stepId },
  });
  const created = await db.prepare(`SELECT * FROM process_steps WHERE id = ?`).bind(id).first<StepRow>();
  return ok(toPublicStep(created!), 201);
}

// GET .../versions/{vid}:validate — kiểm tra bản nháp trước khi gửi duyệt (PRC-009).
export async function handleValidateVersion(ctx: Ctx, versionId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const v = await db.prepare(`SELECT id, status FROM process_versions WHERE id = ?`).bind(versionId).first<{
    id: string;
    status: string;
  }>();
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);

  const errors: Array<{ step_id: string | null; step_code: string | null; field: string; message: string }> = [];
  const steps = await db
    .prepare(`SELECT * FROM process_steps WHERE version_id = ? ORDER BY sort_order ASC`)
    .bind(versionId)
    .all<StepRow>();

  if (steps.results.length === 0) {
    errors.push({ step_id: null, step_code: null, field: "steps", message: "Phiên bản chưa có bước nào." });
  }
  const seenCodes = new Set<string>();
  for (const st of steps.results) {
    if (seenCodes.has(st.code)) {
      errors.push({ step_id: st.id, step_code: st.code, field: "code", message: `Mã bước "${st.code}" bị trùng.` });
    }
    seenCodes.add(st.code);
    if (!st.title.trim()) {
      errors.push({ step_id: st.id, step_code: st.code, field: "title", message: "Tiêu đề bước không được trống." });
    }
    if (!st.instruction?.trim()) {
      errors.push({
        step_id: st.id,
        step_code: st.code,
        field: "instruction",
        message: `Bước "${st.code}" thiếu hướng dẫn thực hiện.`,
      });
    }
  }
  return ok({ valid: errors.length === 0, errors });
}
