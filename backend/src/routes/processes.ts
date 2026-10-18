// routes/processes.ts — danh mục quy trình + phiên bản (Task 1.4).
// Khớp SRS v1.6: PRC-001–003, PRC-009; §7.1 (máy trạng thái ProcessVersion); AC-01, AC-02.
//
// Máy trạng thái: DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> SUPERSEDED -> RETIRED
//                 APPROVED -> SCHEDULED -> ACTIVE (effective_from trong tương lai)
//                 IN_REVIEW -> DRAFT (trả sửa)
// Quyền: processes.manage (tạo/sửa/gửi duyệt), processes.approve (phê duyệt/kích hoạt),
//         processes.review (thẩm định — góp ý, thuộc Task sau).

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission, type SessionInfo } from "./auth";
import { notifyUsers } from "./notifications";
import type { Ctx } from "./context";

const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{1,31}$/i;

type ProcessRow = {
  id: string;
  code: string;
  name: string;
  purpose: string | null;
  scope: string | null;
  applicable_objects: string | null;
  start_condition: string | null;
  end_condition: string | null;
  owner_id: string | null;
  applying_unit: string | null;
  review_trigger: string | null;
  group_name: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
};

type VersionRow = {
  id: string;
  process_id: string;
  version_number: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  change_summary: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
};

function toPublicProcess(p: ProcessRow, activeVersion: VersionRow | null) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    purpose: p.purpose,
    scope: p.scope,
    applicable_objects: p.applicable_objects,
    start_condition: p.start_condition,
    end_condition: p.end_condition,
    owner_id: p.owner_id,
    applying_unit: p.applying_unit,
    review_trigger: p.review_trigger,
    group_name: p.group_name,
    created_at: p.created_at,
    updated_at: p.updated_at,
    active_version: activeVersion
      ? { id: activeVersion.id, version_number: activeVersion.version_number, status: activeVersion.status }
      : null,
  };
}

function toPublicVersion(v: VersionRow) {
  return { ...v };
}

async function getActiveVersion(db: D1Database, processId: string): Promise<VersionRow | null> {
  return db
    .prepare(`SELECT * FROM process_versions WHERE process_id = ? AND status = 'ACTIVE' LIMIT 1`)
    .bind(processId)
    .first<VersionRow>();
}

// GET /api/v1/processes — danh sách + tìm kiếm/lọc (PRC-002).
export async function handleListProcesses(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const url = new URL(ctx.request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const group = (url.searchParams.get("group") ?? "").trim();
  const owner = (url.searchParams.get("owner") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim(); // trạng thái phiên bản ACTIVE

  const conds: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    conds.push(`(p.code LIKE ? OR p.name LIKE ?)`);
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (group) {
    conds.push(`p.group_name = ?`);
    binds.push(group);
  }
  if (owner) {
    conds.push(`p.owner_id = ?`);
    binds.push(owner);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await db
    .prepare(`SELECT p.* FROM processes p ${where} ORDER BY p.updated_at DESC, p.created_at DESC LIMIT 200`)
    .bind(...binds)
    .all<ProcessRow>();

  const items = [];
  for (const p of rows.results) {
    const av = await getActiveVersion(db, p.id);
    if (status && (!av || av.status !== status)) continue;
    // Phiên bản mới nhất (để hiện trạng thái đúng: nháp, chờ duyệt...).
    const latest = await db.prepare(
      `SELECT * FROM process_versions WHERE process_id = ? ORDER BY version_number DESC LIMIT 1`
    ).bind(p.id).first<VersionRow>();
    let creatorName: string | null = null;
    if (p.created_by) {
      const u = await db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(p.created_by).first<{ display_name: string }>();
      creatorName = u?.display_name ?? null;
    }
    // Đơn vị áp dụng.
    const ouRows = await db.prepare(
      `SELECT ou.id, ou.name FROM process_org_units pou JOIN org_units ou ON ou.id = pou.org_unit_id WHERE pou.process_id = ? ORDER BY ou.name ASC`
    ).bind(p.id).all<{ id: string; name: string }>();
    items.push({
      ...toPublicProcess(p, av),
      creator_name: creatorName,
      org_units: ouRows.results ?? [],
      latest_version: latest ? { version_number: latest.version_number, status: latest.status } : null,
    });
  }
  return ok({ items, total: items.length });
}

// POST /api/v1/processes — tạo quy trình + bản nháp đầu (PRC-001).
export async function handleCreateProcess(ctx: Ctx): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const code = String(body?.code ?? "").trim().toUpperCase();
  const name = String(body?.name ?? "").trim();
  if (!CODE_RE.test(code)) {
    return apiError("VALIDATION_ERROR", "Mã quy trình không hợp lệ (2–32 ký tự: chữ, số, . _ -).", ctx.requestId);
  }
  if (name.length < 3 || name.length > 200) {
    return apiError("VALIDATION_ERROR", "Tên quy trình phải từ 3 đến 200 ký tự.", ctx.requestId);
  }
  const existing = await db.prepare(`SELECT id FROM processes WHERE code = ?`).bind(code).first();
  if (existing) {
    return apiError("VALIDATION_ERROR", "Mã quy trình đã tồn tại.", ctx.requestId, { field: "code" });
  }

  const now = nowIso();
  const processId = newId();
  const versionId = newId();
  const str = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
  const batchStmts = [
    db.prepare(
      `INSERT INTO processes (id, code, name, purpose, scope, applicable_objects, start_condition, end_condition, owner_id, applying_unit, review_trigger, group_name, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      processId, code, name,
      str(body?.purpose), str(body?.scope), str(body?.applicable_objects),
      str(body?.start_condition), str(body?.end_condition),
      str(body?.owner_id) ?? me.user.id,
      str(body?.applying_unit), str(body?.review_trigger), str(body?.group_name),
      now, me.user.id
    ),
    db.prepare(
      `INSERT INTO process_versions (id, process_id, version_number, status, created_at, created_by)
       VALUES (?, ?, 1, 'DRAFT', ?, ?)`
    ).bind(versionId, processId, now, me.user.id),
  ];
  // Đơn vị áp dụng (chọn nhiều).
  const orgUnitIds = Array.isArray(body?.org_unit_ids)
    ? (body.org_unit_ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  for (const ouId of orgUnitIds) {
    batchStmts.push(
      db.prepare(`INSERT INTO process_org_units (process_id, org_unit_id) VALUES (?, ?)`).bind(processId, ouId)
    );
  }
  await db.batch(batchStmts);
  await audit(db, {
    event_type: "PROCESS_CREATED",
    actor_id: me.user.id,
    object_type: "process",
    object_id: processId,
    request_id: ctx.requestId,
    diff: { code, name },
  });

  const p = await db.prepare(`SELECT * FROM processes WHERE id = ?`).bind(processId).first<ProcessRow>();
  return ok(toPublicProcess(p!, null), 201);
}

// GET /api/v1/processes/{id} — chi tiết quy trình kèm danh sách phiên bản.
export async function handleGetProcess(ctx: Ctx, id: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const p = await db.prepare(`SELECT * FROM processes WHERE id = ?`).bind(id).first<ProcessRow>();
  if (!p) return apiError("NOT_FOUND", "Không tìm thấy quy trình.", ctx.requestId);
  const versions = await db
    .prepare(`SELECT * FROM process_versions WHERE process_id = ? ORDER BY version_number DESC`)
    .bind(id)
    .all<VersionRow>();
  const av = await getActiveVersion(db, id);
  const ouRows = await db.prepare(
    `SELECT ou.id, ou.name FROM process_org_units pou JOIN org_units ou ON ou.id = pou.org_unit_id WHERE pou.process_id = ? ORDER BY ou.name ASC`
  ).bind(id).all<{ id: string; name: string }>();
  return ok({
    ...toPublicProcess(p, av),
    versions: versions.results.map(toPublicVersion),
    org_units: ouRows.results ?? [],
  });
}

// PATCH /api/v1/processes/{id} — sửa thông tin quy trình (không sửa phiên bản).
export async function handlePatchProcess(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const p = await db.prepare(`SELECT * FROM processes WHERE id = ?`).bind(id).first<ProcessRow>();
  if (!p) return apiError("NOT_FOUND", "Không tìm thấy quy trình.", ctx.requestId);

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const updates: string[] = [];
  const binds: unknown[] = [];
  const diff: Record<string, unknown> = {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
  for (const f of ["name", "purpose", "scope", "applicable_objects", "start_condition", "end_condition", "applying_unit", "review_trigger", "group_name"] as const) {
    if (body?.[f] !== undefined) {
      const v = f === "name" ? String(body[f]).trim() : str(body[f]);
      if (f === "name" && (typeof v !== "string" || v.length < 3 || v.length > 200)) {
        return apiError("VALIDATION_ERROR", "Tên quy trình phải từ 3 đến 200 ký tự.", ctx.requestId);
      }
      updates.push(`${f} = ?`);
      binds.push(v);
      diff[f] = v;
    }
  }
  if (body?.owner_id !== undefined) {
    updates.push(`owner_id = ?`);
    binds.push(str(body.owner_id));
    diff.owner_id = str(body.owner_id);
  }
  if (updates.length === 0) {
    return apiError("VALIDATION_ERROR", "Không có gì để cập nhật.", ctx.requestId);
  }
  const now = nowIso();
  updates.push("updated_at = ?", "updated_by = ?");
  binds.push(now, me.user.id, id);
  await db.prepare(`UPDATE processes SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
  await audit(db, {
    event_type: "PROCESS_UPDATED",
    actor_id: me.user.id,
    object_type: "process",
    object_id: id,
    request_id: ctx.requestId,
    diff,
  });
  const updated = await db.prepare(`SELECT * FROM processes WHERE id = ?`).bind(id).first<ProcessRow>();
  const av = await getActiveVersion(db, id);
  return ok(toPublicProcess(updated!, av));
}

// POST /api/v1/processes/{id}/versions — tạo phiên bản kế tiếp từ bản mới nhất (PRC-003).
export async function handleCreateVersion(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const p = await db.prepare(`SELECT * FROM processes WHERE id = ?`).bind(id).first<ProcessRow>();
  if (!p) return apiError("NOT_FOUND", "Không tìm thấy quy trình.", ctx.requestId);

  const latest = await db
    .prepare(`SELECT * FROM process_versions WHERE process_id = ? ORDER BY version_number DESC LIMIT 1`)
    .bind(id)
    .first<VersionRow>();
  if (!latest) return apiError("VALIDATION_ERROR", "Quy trình chưa có phiên bản nào.", ctx.requestId);
  if (latest.status === "DRAFT" || latest.status === "IN_REVIEW") {
    return apiError("VALIDATION_ERROR", "Bản nháp/thẩm định hiện tại chưa hoàn tất — hãy hoàn tất trước khi tạo bản mới.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const changeSummary = typeof body?.change_summary === "string" ? body.change_summary.trim() || null : null;
  const now = nowIso();
  const versionId = newId();
  const nextNumber = latest.version_number + 1;
  // Sao chép bản mới nhất thành bản nháp mới (cấu trúc bước sẽ sao chép ở Task 1.5).
  await db.prepare(
    `INSERT INTO process_versions (id, process_id, version_number, status, change_summary, created_at, created_by)
     VALUES (?, ?, ?, 'DRAFT', ?, ?, ?)`
  ).bind(versionId, id, nextNumber, changeSummary, now, me.user.id).run();
  await audit(db, {
    event_type: "PROCESS_VERSION_CREATED",
    actor_id: me.user.id,
    object_type: "process_version",
    object_id: versionId,
    request_id: ctx.requestId,
    diff: { process_id: id, version_number: nextNumber, from_version: latest.version_number },
  });
  const v = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(versionId).first<VersionRow>();
  return ok(toPublicVersion(v!), 201);
}

// Chuyển trạng thái phiên bản — dùng chung logic kiểm tra.
async function transitionVersion(
  ctx: Ctx,
  versionId: string,
  from: string[],
  to: string,
  requiredPerm: string,
  eventType: string,
  extra?: { effective_from?: string | null }
): Promise<Response> {
  const s = requirePermission(ctx, requiredPerm);
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const v = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(versionId).first<VersionRow>();
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (!from.includes(v.status)) {
    return apiError("VALIDATION_ERROR", `Không thể chuyển từ trạng thái ${v.status}.`, ctx.requestId);
  }
  // Không cho gửi duyệt/duyệt/kích hoạt/phát hành phiên bản không có bước nào.
  if (to === "IN_REVIEW" || to === "ACTIVE" || to === "APPROVED" || to === "SCHEDULED") {
    const stepCount = await db.prepare(`SELECT COUNT(*) AS c FROM process_steps WHERE version_id = ?`)
      .bind(versionId).first<{ c: number }>();
    if (!stepCount || stepCount.c === 0) {
      return apiError("VALIDATION_ERROR", "Phiên bản chưa có bước nào. Hãy thêm ít nhất 1 bước trước khi gửi duyệt.", ctx.requestId);
    }
  }

  const now = nowIso();
  const updates: string[] = [`status = ?`, `updated_at = ?`];
  const binds: unknown[] = [to, now];

  if (to === "IN_REVIEW") {
    updates.push("submitted_at = ?", "submitted_by = ?");
    binds.push(now, me.user.id);
  } else if (to === "APPROVED") {
    updates.push("approved_at = ?", "approved_by = ?");
    binds.push(now, me.user.id);
    if (extra?.effective_from) {
      updates.push("effective_from = ?");
      binds.push(extra.effective_from);
    }
  } else if (to === "ACTIVE") {
    // Kích hoạt: chỉ 1 bản ACTIVE tại 1 thời điểm.
    // - Kích hoạt bản mới (APPROVED/SCHEDULED): bản ACTIVE cũ → SUPERSEDED.
    // - Kích hoạt lại bản cũ (RETIRED): bản ACTIVE cũ → RETIRED.
    const oldActive = await getActiveVersion(db, v.process_id);
    const stmts: D1PreparedStatement[] = [];
    if (oldActive && oldActive.id !== v.id) {
      const oldStatus = v.status === "RETIRED" ? "RETIRED" : "SUPERSEDED";
      stmts.push(
        db.prepare(`UPDATE process_versions SET status = ?, updated_at = ? WHERE id = ?`).bind(oldStatus, now, oldActive.id)
      );
    }
    updates.push("activated_at = ?", "activated_by = ?");
    binds.push(now, me.user.id);
    binds.push(v.id);
    stmts.push(db.prepare(`UPDATE process_versions SET ${updates.join(", ")} WHERE id = ?`).bind(...binds));
    await db.batch(stmts);
    await audit(db, {
      event_type: eventType,
      actor_id: me.user.id,
      object_type: "process_version",
      object_id: v.id,
      request_id: ctx.requestId,
      diff: { from: v.status, to, superseded: oldActive?.id ?? null },
    });
    const updated = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(v.id).first<VersionRow>();
    return ok(toPublicVersion(updated!));
  }

  binds.push(v.id);
  await db.prepare(`UPDATE process_versions SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
  await audit(db, {
    event_type: eventType,
    actor_id: me.user.id,
    object_type: "process_version",
    object_id: v.id,
    request_id: ctx.requestId,
    diff: { from: v.status, to },
  });
  // Gửi thông báo.
  const proc = await db.prepare(`SELECT code, name FROM processes WHERE id = ?`).bind(v.process_id).first<{ code: string; name: string }>();
  const procLabel = proc ? `${proc.code} v${v.version_number}` : `v${v.version_number}`;
  const verLink = `#/processes/${v.process_id}`;
  if (to === "IN_REVIEW") {
    // Gửi duyệt → thông báo cho người có quyền duyệt (trừ người gửi).
    const approvers = await db.prepare(
      `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.code = ur.role
       JOIN role_permissions rp ON rp.role_id = r.id
       WHERE (rp.permission = 'processes.approve' OR rp.permission = '*') AND u.id != ? AND u.status = 'active'`
    ).bind(me.user.id).all<{ id: string }>();
    const ids = (approvers.results ?? []).map((r) => r.id);
    if (ids.length > 0) {
      await notifyUsers(db, ids, {
        type: "VERSION_SUBMITTED",
        title: `${procLabel} chờ duyệt`,
        message: `${me.user.display_name} đã gửi duyệt ${procLabel}.`,
        link: verLink,
      });
    }
  } else if (to === "APPROVED" || to === "DRAFT") {
    // Duyệt / trả về → thông báo cho người gửi duyệt.
    const submitterId = (v as unknown as Record<string, unknown>).submitted_by as string | null;
    if (submitterId && submitterId !== me.user.id) {
      const isApprove = to === "APPROVED";
      await notifyUsers(db, [submitterId], {
        type: isApprove ? "VERSION_APPROVED" : "VERSION_RETURNED",
        title: isApprove ? `${procLabel} đã được duyệt` : `${procLabel} bị trả về sửa`,
        message: isApprove
          ? `${me.user.display_name} đã duyệt ${procLabel}.`
          : `${me.user.display_name} đã trả về ${procLabel} để sửa.`,
        link: verLink,
      });
    }
  }
  const updated = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(v.id).first<VersionRow>();
  return ok(toPublicVersion(updated!));
}

// POST .../versions/{vId}:submit — DRAFT -> IN_REVIEW (PRC-009: kiểm tra trước khi gửi).
export async function handleSubmitVersion(ctx: Ctx, versionId: string): Promise<Response> {
  // PRC-009: kiểm tra bản nháp trước khi gửi duyệt. Task 1.4 kiểm tra tối thiểu
  // (quy trình có tên/mã); kiểm tra bước chi tiết thuộc Task 1.5.
  return transitionVersion(ctx, versionId, ["DRAFT"], "IN_REVIEW", "processes.manage", "PROCESS_VERSION_SUBMITTED");
}

// POST .../versions/{vId}:approve — IN_REVIEW -> APPROVED (hoặc SCHEDULED nếu effective_from tương lai).
export async function handleApproveVersion(ctx: Ctx, versionId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.approve");
  if (s instanceof Response) return s;
  const db = ctx.env.sop_demo_db;
  const v = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(versionId).first<VersionRow>();
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const effectiveFrom = typeof body?.effective_from === "string" ? body.effective_from.trim() || null : null;
  // Nếu effective_from trong tương lai -> SCHEDULED, ngược lại -> APPROVED.
  let to = "APPROVED";
  if (effectiveFrom && effectiveFrom > nowIso()) {
    to = "SCHEDULED";
  }
  return transitionVersion(ctx, versionId, ["IN_REVIEW"], to, "processes.approve", "PROCESS_VERSION_APPROVED", {
    effective_from: effectiveFrom,
  });
}

// POST .../versions/{vId}:return — IN_REVIEW -> DRAFT (trả sửa).
export async function handleReturnVersion(ctx: Ctx, versionId: string): Promise<Response> {
  return transitionVersion(ctx, versionId, ["IN_REVIEW"], "DRAFT", "processes.approve", "PROCESS_VERSION_RETURNED");
}

// POST .../versions/{vId}:activate — APPROVED/SCHEDULED -> ACTIVE (kích hoạt trực tiếp).
export async function handleActivateVersion(ctx: Ctx, versionId: string): Promise<Response> {
  return transitionVersion(ctx, versionId, ["APPROVED", "SCHEDULED"], "ACTIVE", "processes.approve", "PROCESS_VERSION_ACTIVATED");
}

// POST .../versions/{vId}:request-reactivation — RETIRED -> yêu cầu kích hoạt lại (chờ duyệt).
export async function handleRequestReactivation(ctx: Ctx, versionId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const v = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(versionId).first<VersionRow>();
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (v.status !== "RETIRED") {
    return apiError("VALIDATION_ERROR", "Chỉ yêu cầu kích hoạt lại phiên bản đã ngừng.", ctx.requestId);
  }
  if ((v as unknown as Record<string, unknown>).reactivation_status === "PENDING") {
    return apiError("VALIDATION_ERROR", "Đã có yêu cầu kích hoạt lại đang chờ duyệt.", ctx.requestId);
  }
  const now = nowIso();
  await db.prepare(
    `UPDATE process_versions SET reactivation_status = 'PENDING', reactivation_requested_by = ?, reactivation_requested_at = ?, reactivation_reviewed_by = NULL, reactivation_reviewed_at = NULL, reactivation_reject_reason = NULL, updated_at = ? WHERE id = ?`
  ).bind(me.user.id, now, now, versionId).run();
  await audit(db, {
    event_type: "PROCESS_VERSION_REACTIVATION_REQUESTED",
    actor_id: me.user.id,
    object_type: "process_version",
    object_id: versionId,
    request_id: ctx.requestId,
  });
  // Thông báo cho người có quyền duyệt.
  const proc = await db.prepare(`SELECT code, name FROM processes WHERE id = ?`).bind(v.process_id).first<{ code: string; name: string }>();
  const approvers = await db.prepare(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.code = ur.role
     JOIN role_permissions rp ON rp.role_id = r.id
     WHERE (rp.permission = 'processes.approve' OR rp.permission = '*') AND u.id != ? AND u.status = 'active'`
  ).bind(me.user.id).all<{ id: string }>();
  const approverIds = (approvers.results ?? []).map((r) => r.id);
  if (approverIds.length > 0) {
    await notifyUsers(db, approverIds, {
      type: "VERSION_REACTIVATION_REQUESTED",
      title: `Yêu cầu kích hoạt lại ${proc?.code ?? ""} v${v.version_number}`,
      message: `${me.user.display_name} đã yêu cầu kích hoạt lại phiên bản v${v.version_number} của ${proc?.name ?? ""}.`,
      link: `#/processes/${v.process_id}`,
    });
  }
  return ok({ requested: true });
}

// POST .../versions/{vId}:approve-reactivation — duyệt yêu cầu kích hoạt lại → ACTIVE.
export async function handleApproveReactivation(ctx: Ctx, versionId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.approve");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const v = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(versionId).first<VersionRow>();
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (v.status !== "RETIRED" || (v as unknown as Record<string, unknown>).reactivation_status !== "PENDING") {
    return apiError("VALIDATION_ERROR", "Không có yêu cầu kích hoạt lại đang chờ duyệt.", ctx.requestId);
  }
  const now = nowIso();
  // Đánh dấu đã duyệt, sau đó kích hoạt (dùng transitionVersion để xử lý bản ACTIVE cũ).
  await db.prepare(
    `UPDATE process_versions SET reactivation_status = 'APPROVED', reactivation_reviewed_by = ?, reactivation_reviewed_at = ?, updated_at = ? WHERE id = ?`
  ).bind(me.user.id, now, now, versionId).run();
  await audit(db, {
    event_type: "PROCESS_VERSION_REACTIVATION_APPROVED",
    actor_id: me.user.id,
    object_type: "process_version",
    object_id: versionId,
    request_id: ctx.requestId,
  });
  // Thông báo cho người yêu cầu.
  const reqId = (v as unknown as Record<string, unknown>).reactivation_requested_by as string | null;
  if (reqId && reqId !== me.user.id) {
    const proc = await db.prepare(`SELECT code, name FROM processes WHERE id = ?`).bind(v.process_id).first<{ code: string; name: string }>();
    await notifyUsers(db, [reqId], {
      type: "VERSION_REACTIVATION_APPROVED",
      title: `Yêu cầu kích hoạt lại được duyệt`,
      message: `${me.user.display_name} đã duyệt kích hoạt lại v${v.version_number} của ${proc?.name ?? ""}.`,
      link: `#/processes/${v.process_id}`,
    });
  }
  // Kích hoạt: gọi transitionVersion với RETIRED -> ACTIVE.
  return transitionVersion(ctx, versionId, ["RETIRED"], "ACTIVE", "processes.approve", "PROCESS_VERSION_ACTIVATED");
}

// POST .../versions/{vId}:reject-reactivation — từ chối yêu cầu kích hoạt lại (bắt buộc lý do).
export async function handleRejectReactivation(ctx: Ctx, versionId: string): Promise<Response> {
  const s = requirePermission(ctx, "processes.approve");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return apiError("VALIDATION_ERROR", "Từ chối bắt buộc phải có lý do.", ctx.requestId);
  }
  const v = await db.prepare(`SELECT * FROM process_versions WHERE id = ?`).bind(versionId).first<VersionRow>();
  if (!v) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (v.status !== "RETIRED" || (v as unknown as Record<string, unknown>).reactivation_status !== "PENDING") {
    return apiError("VALIDATION_ERROR", "Không có yêu cầu kích hoạt lại đang chờ duyệt.", ctx.requestId);
  }
  const now = nowIso();
  await db.prepare(
    `UPDATE process_versions SET reactivation_status = 'REJECTED', reactivation_reviewed_by = ?, reactivation_reviewed_at = ?, reactivation_reject_reason = ?, updated_at = ? WHERE id = ?`
  ).bind(me.user.id, now, reason, now, versionId).run();
  await audit(db, {
    event_type: "PROCESS_VERSION_REACTIVATION_REJECTED",
    actor_id: me.user.id,
    object_type: "process_version",
    object_id: versionId,
    request_id: ctx.requestId,
    diff: { reason },
  });
  // Thông báo cho người yêu cầu.
  const requesterId = (v as unknown as Record<string, unknown>).reactivation_requested_by as string | null;
  if (requesterId && requesterId !== me.user.id) {
    const proc = await db.prepare(`SELECT code, name FROM processes WHERE id = ?`).bind(v.process_id).first<{ code: string; name: string }>();
    await notifyUsers(db, [requesterId], {
      type: "VERSION_REACTIVATION_REJECTED",
      title: `Yêu cầu kích hoạt lại bị từ chối`,
      message: `${me.user.display_name} đã từ chối kích hoạt lại v${v.version_number} của ${proc?.name ?? ""}. Lý do: ${reason}`,
      link: `#/processes/${v.process_id}`,
    });
  }
  return ok({ rejected: true });
}

// POST .../versions/{vId}:retire — ACTIVE/SUPERSEDED/APPROVED -> RETIRED.
export async function handleRetireVersion(ctx: Ctx, versionId: string): Promise<Response> {
  return transitionVersion(ctx, versionId, ["ACTIVE", "SUPERSEDED", "APPROVED"], "RETIRED", "processes.approve", "PROCESS_VERSION_RETIRED");
}
