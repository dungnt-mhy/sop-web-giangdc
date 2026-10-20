/**
 * Routes đề xuất lượt công việc.
 * Nhân viên (không có quyền executions.create) đề xuất lượt mới →
 * người phê duyệt duyệt 1 chạm → lượt tự động được tạo (kèm phân công theo bước).
 */
import type { Ctx } from "./context";
import { type SessionInfo } from "./auth";
import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { notifyUsers } from "./notifications";
import { createExecutionCore, canCreateForUnit, type CoreStepAssignment } from "./executions";
import { unitAncestors, unitDescendants } from "../scope";

interface ProposalRow {
  id: string;
  process_id: string;
  title: string | null;
  reason: string;
  proposer_id: string;
  approver_id: string;
  expected_start_at: string | null;
  status: string;
  reject_reason: string | null;
  execution_id: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  detail: string | null;
}

/** Chi tiết đề xuất lưu dạng JSON: giám sát lượt + phân công từng bước. */
export interface ProposalDetail {
  supervisor_ids: string[];
  steps: CoreStepAssignment[];
}

function parseDetail(raw: string | null): ProposalDetail {
  try {
    const d = raw ? JSON.parse(raw) : null;
    return {
      supervisor_ids: Array.isArray(d?.supervisor_ids) ? d.supervisor_ids.filter((x: unknown): x is string => typeof x === "string") : [],
      steps: Array.isArray(d?.steps) ? d.steps : [],
    };
  } catch {
    return { supervisor_ids: [], steps: [] };
  }
}

/** Danh sách ID người duyệt của đề xuất (bảng mới; fallback cột approver_id cho dữ liệu cũ). */
async function getProposalApproverIds(db: D1Database, proposalId: string, fallbackId: string): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT user_id FROM proposal_approvers WHERE proposal_id = ?`)
    .bind(proposalId)
    .all<{ user_id: string }>();
  const ids = (rows.results ?? []).map((r) => r.user_id);
  return ids.length > 0 ? ids : [fallbackId];
}

/** Kiểm tra user có nằm trong nhóm vai trò quản lý (được chọn làm người duyệt/giám sát lượt). */
async function hasManagerRole(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM user_roles ur JOIN roles r ON r.code = ur.role
       WHERE ur.user_id = ? AND r.code IN ('approver', 'monitor', 'admin', 'process_owner') LIMIT 1`
    )
    .bind(userId)
    .first();
  return !!row;
}

type BranchUnits = Set<string> | null; // null = không giới hạn (người đề xuất chưa gán đơn vị)

/** Đơn vị cùng nhánh (đơn vị mình + lên tới công ty + xuống cấp dưới) của người đề xuất. */
async function getBranchUnits(db: D1Database, orgUnitId: string | null): Promise<BranchUnits> {
  if (!orgUnitId) return null;
  const [anc, desc] = await Promise.all([unitAncestors(db, orgUnitId), unitDescendants(db, orgUnitId)]);
  return new Set([...anc, ...desc]);
}

/**
 * Validate toàn bộ payload đề xuất: người duyệt (1–2), giám sát (1–2),
 * phân công đủ mọi bước của phiên bản ACTIVE (người làm ≥1, giám sát bước 1–2,
 * đúng chức vụ yêu cầu, đúng phạm vi đơn vị).
 */
async function validateProposalPayload(
  db: D1Database,
  me: SessionInfo,
  processId: string,
  body: Record<string, unknown> | null
): Promise<{ error?: string; approverIds?: string[]; supervisorIds?: string[]; detail?: ProposalDetail }> {
  const reason = String(body?.reason ?? "").trim();
  if (!reason) return { error: "Vui lòng ghi lý do đề xuất." };

  // Người duyệt: tối đa 2 (tương thích approver_id cũ).
  const aprRaw = body?.approver_ids ?? body?.approver_id;
  const aprArr = (Array.isArray(aprRaw) ? aprRaw : aprRaw ? [aprRaw] : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
  const approverIds = [...new Set(aprArr)];
  if (approverIds.length === 0) return { error: "Vui lòng chọn ít nhất 1 người phê duyệt." };
  if (approverIds.length > 2) return { error: "Chỉ được chọn tối đa 2 người phê duyệt." };
  for (const aid of approverIds) {
    if (aid === me.user.id) return { error: "Không được tự phê duyệt đề xuất của mình." };
    const u = await db.prepare(`SELECT id, status FROM users WHERE id = ?`).bind(aid).first<{ id: string; status: string }>();
    if (!u || u.status !== "active") return { error: "Người phê duyệt không hợp lệ." };
    if (!(await hasManagerRole(db, aid))) return { error: "Người được chọn không có vai trò phê duyệt." };
  }

  // Người giám sát lượt: bắt buộc 1–2 người.
  const supRaw = body?.supervisor_ids ?? body?.supervisor_id;
  const supArr = (Array.isArray(supRaw) ? supRaw : supRaw ? [supRaw] : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
  const supervisorIds = [...new Set(supArr)];
  if (supervisorIds.length === 0) return { error: "Vui lòng chọn ít nhất 1 người giám sát lượt." };
  if (supervisorIds.length > 2) return { error: "Chỉ được chọn tối đa 2 người giám sát lượt." };
  for (const sid of supervisorIds) {
    const u = await db.prepare(`SELECT id, status FROM users WHERE id = ?`).bind(sid).first<{ id: string; status: string }>();
    if (!u || u.status !== "active") return { error: "Người giám sát lượt không hợp lệ." };
    if (!(await hasManagerRole(db, sid))) return { error: "Người được chọn không có vai trò quản lý/giám sát." };
  }

  // Quy trình phải có phiên bản hiệu lực.
  const version = await db
    .prepare(`SELECT id FROM process_versions WHERE process_id = ? AND status = 'ACTIVE' LIMIT 1`)
    .bind(processId)
    .first<{ id: string }>();
  if (!version) return { error: "Quy trình chưa có phiên bản đang hiệu lực." };

  // Không còn phân công theo bước trong đề xuất: bước được phân công sau khi lượt tạo.
  const detailSteps: CoreStepAssignment[] = [];

  return {
    approverIds,
    supervisorIds,
    detail: { supervisor_ids: supervisorIds, steps: detailSteps },
  };
}

/** POST /api/v1/proposals — nhân viên tạo đề xuất lượt mới (kèm người duyệt + giám sát lượt). */
export async function handleCreateProposal(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const processId = String(body?.process_id ?? "").trim();
  if (!processId) return apiError("VALIDATION_ERROR", "Thiếu quy trình.", ctx.requestId);
  const title = typeof body?.title === "string" ? body.title.trim() || null : null;
  const expectedStartAt = typeof body?.expected_start_at === "string" ? body.expected_start_at.trim() || null : null;

  const v = await validateProposalPayload(db, me, processId, body);
  if (v.error) return apiError("VALIDATION_ERROR", v.error, ctx.requestId);
  const approverIds = v.approverIds!;
  const detail = v.detail!;

  const now = nowIso();
  const id = newId();
  await db.prepare(
    `INSERT INTO execution_proposals (id, process_id, title, reason, proposer_id, approver_id, expected_start_at, status, created_at, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
  ).bind(id, processId, title, String(body?.reason ?? "").trim(), me.user.id, approverIds[0], expectedStartAt, now, JSON.stringify(detail)).run();
  for (const aid of approverIds) {
    await db.prepare(`INSERT OR IGNORE INTO proposal_approvers (proposal_id, user_id) VALUES (?, ?)`).bind(id, aid).run();
  }

  await audit(db, {
    event_type: "PROPOSAL_CREATED",
    actor_id: me.user.id,
    object_type: "execution_proposal",
    object_id: id,
    request_id: ctx.requestId,
  });

  // Thông báo cho tất cả người phê duyệt.
  const proposer = await db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(me.user.id)
    .first<{ display_name: string }>();
  const process = await db.prepare(`SELECT name FROM processes WHERE id = ?`).bind(processId)
    .first<{ name: string }>();
  await notifyUsers(
    db, approverIds, {
      type: "PROPOSAL_RECEIVED",
      title: `Đề xuất lượt mới từ ${proposer?.display_name ?? "nhân viên"}`,
      message: `${proposer?.display_name ?? ""} đề xuất lượt "${process?.name ?? ""}"${title ? ` — ${title}` : ""}. Lý do: ${String(body?.reason ?? "").trim()}`,
      link: `#/proposals`,
    }, ctx.env
  );

  return ok({ id }, 201);
}

/** GET /api/v1/proposals — danh sách đề xuất (của tôi đề xuất + gửi đến tôi duyệt). */
export async function handleListProposals(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const url = new URL(ctx.request.url);
  const tab = url.searchParams.get("tab") ?? "received"; // received | sent
  const status = (url.searchParams.get("status") ?? "").trim();

  const statusCond = status ? `AND p.status = ?` : "";
  const statusBinds: string[] = status ? [status] : [];

  const whoCond = tab === "sent"
    ? `p.proposer_id = ?`
    : `(p.approver_id = ? OR p.id IN (SELECT proposal_id FROM proposal_approvers WHERE user_id = ?))`;
  const whoBinds = tab === "sent" ? [me.user.id] : [me.user.id, me.user.id];

  const rows = await db.prepare(
    `SELECT p.*,
       pr.name AS process_name,
       u1.display_name AS proposer_name,
       u2.display_name AS approver_name
     FROM execution_proposals p
     LEFT JOIN processes pr ON pr.id = p.process_id
     LEFT JOIN users u1 ON u1.id = p.proposer_id
     LEFT JOIN users u2 ON u2.id = p.approver_id
     WHERE ${whoCond} ${statusCond}
     ORDER BY p.created_at DESC LIMIT 50`
  ).bind(...whoBinds, ...statusBinds).all<ProposalRow & {
    process_name: string | null; proposer_name: string | null; approver_name: string | null;
  }>();

  const items = rows.results ?? [];
  // Nạp thêm: danh sách người duyệt + tên hiển thị + chi tiết (giám sát/phân công).
  const ids = items.map((p) => p.id);
  const approverMap = new Map<string, string[]>();
  if (ids.length > 0) {
    const ph = ids.map(() => "?").join(",");
    const ar = await db.prepare(
      `SELECT pa.proposal_id, u.id, u.display_name
       FROM proposal_approvers pa JOIN users u ON u.id = pa.user_id
       WHERE pa.proposal_id IN (${ph})`
    ).bind(...ids).all<{ proposal_id: string; id: string; display_name: string }>();
    for (const r of ar.results ?? []) {
      if (!approverMap.has(r.proposal_id)) approverMap.set(r.proposal_id, []);
      approverMap.get(r.proposal_id)!.push(r.id);
    }
  }
  const userIds = new Set<string>();
  for (const p of items) {
    for (const aid of approverMap.get(p.id) ?? [p.approver_id]) userIds.add(aid);
    const d = parseDetail(p.detail);
    for (const sid of d.supervisor_ids) userIds.add(sid);
    for (const st of d.steps) {
      for (const uid of [...st.assignee_ids, ...st.supervisor_ids]) userIds.add(uid);
    }
  }
  const nameMap = new Map<string, string>();
  if (userIds.size > 0) {
    const uph = [...userIds].map(() => "?").join(",");
    const ur = await db.prepare(`SELECT id, display_name FROM users WHERE id IN (${uph})`)
      .bind(...[...userIds]).all<{ id: string; display_name: string }>();
    for (const u of ur.results ?? []) nameMap.set(u.id, u.display_name);
  }

  const out = items.map((p) => {
    const aids = approverMap.get(p.id) ?? [p.approver_id];
    const d = parseDetail(p.detail);
    return {
      ...p,
      approver_ids: aids,
      approver_names: aids.map((a) => nameMap.get(a) ?? ""),
      supervisor_ids: d.supervisor_ids,
      supervisor_names: d.supervisor_ids.map((s) => nameMap.get(s) ?? ""),
      steps: d.steps.map((st) => ({
        ...st,
        assignee_names: st.assignee_ids.map((u) => nameMap.get(u) ?? ""),
        supervisor_names: st.supervisor_ids.map((u) => nameMap.get(u) ?? ""),
      })),
    };
  });
  return ok({ items: out });
}

/**
 * POST /api/v1/proposals/:id:approve — người phê duyệt duyệt đề xuất → tạo lượt ngay.
 * Lượt được tạo với: người tạo = người duyệt, người thực hiện chính = người đề xuất,
 * người phê duyệt lượt = nhóm người duyệt đề xuất, giám sát + phân công bước lấy từ đề xuất.
 */
export async function handleApproveProposal(ctx: Ctx, proposalId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const p = await db.prepare(`SELECT * FROM execution_proposals WHERE id = ?`).bind(proposalId)
    .first<ProposalRow>();
  if (!p) return apiError("NOT_FOUND", "Không tìm thấy đề xuất.", ctx.requestId);
  if (p.status !== "PENDING") {
    return apiError("VALIDATION_ERROR", "Đề xuất đã được xử lý.", ctx.requestId);
  }
  const approverIds = await getProposalApproverIds(db, proposalId, p.approver_id);
  if (!approverIds.includes(me.user.id)) {
    return apiError("FORBIDDEN", "Bạn không phải người phê duyệt đề xuất này.", ctx.requestId);
  }

  // Người duyệt cần có quyền tạo lượt.
  const canCreate = me.permissions.includes("*") || me.permissions.includes("executions.create") ||
    me.permissions.includes("executions.manage");
  if (!canCreate) {
    return apiError("FORBIDDEN", "Bạn không có quyền tạo lượt.", ctx.requestId);
  }
  // Phạm vi đơn vị: người duyệt chỉ tạo được lượt cho người trong phạm vi của mình.
  const scopeCheck = await canCreateForUnit(db, me.user.id, me.permissions, p.proposer_id);
  if (!scopeCheck.allowed) {
    return apiError("FORBIDDEN", scopeCheck.reason ?? "Người đề xuất nằm ngoài phạm vi đơn vị của bạn.", ctx.requestId);
  }

  const detail = parseDetail(p.detail);
  const startAt = p.expected_start_at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p.expected_start_at)
    ? p.expected_start_at
    : new Date().toISOString().slice(0, 16);
  const endDate = new Date(startAt);
  endDate.setHours(endDate.getHours() + 3);
  const pad = (n: number) => String(n).padStart(2, "0");
  const endAt = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;

  const core = await createExecutionCore(db, {
    creatorId: me.user.id,
    creatorDisplayName: me.user.display_name,
    processId: p.process_id,
    title: p.title,
    assigneeId: p.proposer_id,
    supervisorIds: detail.supervisor_ids,
    approverIds,
    dueAt: null,
    expectedStartAt: startAt,
    expectedEndAt: endAt,
    stepAssignments: detail.steps.length > 0 ? detail.steps : null,
    requestId: ctx.requestId,
    env: ctx.env,
  });
  if ("error" in core) {
    return apiError("VALIDATION_ERROR", core.error, ctx.requestId);
  }

  const now = nowIso();
  await db.prepare(
    `UPDATE execution_proposals SET status = 'APPROVED', decided_at = ?, decided_by = ?, execution_id = ? WHERE id = ?`
  ).bind(now, me.user.id, core.id, proposalId).run();

  await audit(db, {
    event_type: "PROPOSAL_APPROVED",
    actor_id: me.user.id,
    object_type: "execution_proposal",
    object_id: proposalId,
    request_id: ctx.requestId,
  });

  // Thông báo cho người đề xuất (core đã gửi thông báo "được giao lượt").
  await notifyUsers(
    db, [p.proposer_id], {
      type: "PROPOSAL_APPROVED",
      title: `Đề xuất của bạn đã được duyệt`,
      message: `Đề xuất đã được duyệt và lượt ${core.code} đã được tạo cho bạn.`,
      link: `#/executions/${core.id}`,
    }, ctx.env
  );

  return ok({ id: proposalId, status: "APPROVED", execution_id: core.id, execution_code: core.code });
}

/** POST /api/v1/proposals/:id:reject — từ chối đề xuất (bắt buộc lý do). */
export async function handleRejectProposal(ctx: Ctx, proposalId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const p = await db.prepare(`SELECT * FROM execution_proposals WHERE id = ?`).bind(proposalId)
    .first<ProposalRow>();
  if (!p) return apiError("NOT_FOUND", "Không tìm thấy đề xuất.", ctx.requestId);
  if (p.status !== "PENDING") {
    return apiError("VALIDATION_ERROR", "Đề xuất đã được xử lý.", ctx.requestId);
  }
  const approverIds = await getProposalApproverIds(db, proposalId, p.approver_id);
  if (!approverIds.includes(me.user.id)) {
    return apiError("FORBIDDEN", "Bạn không phải người phê duyệt đề xuất này.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const reason = String(body?.reason ?? "").trim();
  if (!reason) {
    return apiError("VALIDATION_ERROR", "Vui lòng nhập lý do từ chối.", ctx.requestId);
  }

  const now = nowIso();
  await db.prepare(
    `UPDATE execution_proposals SET status = 'REJECTED', reject_reason = ?, decided_at = ?, decided_by = ? WHERE id = ?`
  ).bind(reason, now, me.user.id, proposalId).run();

  await audit(db, {
    event_type: "PROPOSAL_REJECTED",
    actor_id: me.user.id,
    object_type: "execution_proposal",
    object_id: proposalId,
    request_id: ctx.requestId,
  });

  await notifyUsers(
    db, [p.proposer_id], {
      type: "PROPOSAL_REJECTED",
      title: `Đề xuất của bạn bị từ chối`,
      message: `Lý do: ${reason}`,
      link: `#/proposals?tab=sent`,
    }, ctx.env
  );

  return ok({ id: proposalId, status: "REJECTED" });
}

/**
 * POST /api/v1/proposals/:id:resubmit — người đề xuất sửa đề xuất bị từ chối và gửi duyệt lại.
 * Có thể sửa mọi trường (giữ giá trị cũ nếu không gửi lên): quy trình, tiêu đề, lý do,
 * người duyệt, giám sát, phân công bước, giờ dự kiến.
 * Sau khi gửi lại: trạng thái về PENDING, xoá thông tin từ chối, thông báo lại cho người duyệt.
 */
export async function handleResubmitProposal(ctx: Ctx, proposalId: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const p = await db.prepare(`SELECT * FROM execution_proposals WHERE id = ?`).bind(proposalId)
    .first<ProposalRow>();
  if (!p) return apiError("NOT_FOUND", "Không tìm thấy đề xuất.", ctx.requestId);
  if (p.proposer_id !== me.user.id) {
    return apiError("FORBIDDEN", "Chỉ người đề xuất mới sửa và gửi lại được.", ctx.requestId);
  }
  if (p.status !== "REJECTED") {
    return apiError("VALIDATION_ERROR", "Chỉ đề xuất bị từ chối mới sửa và gửi lại được.", ctx.requestId);
  }

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const processId = typeof body?.process_id === "string" && body.process_id.trim() ? body.process_id.trim() : p.process_id;
  const title = typeof body?.title === "string" ? (body.title.trim() || null) : p.title;
  const expectedStartAt = typeof body?.expected_start_at === "string" ? (body.expected_start_at.trim() || null) : p.expected_start_at;

  // Gộp các trường không gửi lên từ dữ liệu cũ rồi validate như tạo mới.
  const oldDetail = parseDetail(p.detail);
  const oldApprovers = await getProposalApproverIds(db, proposalId, p.approver_id);
  const mergedBody: Record<string, unknown> = {
    reason: typeof body?.reason === "string" && body.reason.trim() ? body.reason : p.reason,
    approver_ids: body?.approver_ids ?? body?.approver_id ?? oldApprovers,
    supervisor_ids: body?.supervisor_ids ?? oldDetail.supervisor_ids,
  };
  const v = await validateProposalPayload(db, me, processId, mergedBody);
  if (v.error) return apiError("VALIDATION_ERROR", v.error, ctx.requestId);
  const approverIds = v.approverIds!;
  const detail = v.detail!;

  await db.prepare(
    `UPDATE execution_proposals
     SET process_id = ?, title = ?, reason = ?, approver_id = ?, expected_start_at = ?, detail = ?,
         status = 'PENDING', reject_reason = NULL, decided_at = NULL, decided_by = NULL
     WHERE id = ?`
  ).bind(processId, title, String(mergedBody.reason ?? "").trim(), approverIds[0], expectedStartAt, JSON.stringify(detail), proposalId).run();
  await db.prepare(`DELETE FROM proposal_approvers WHERE proposal_id = ?`).bind(proposalId).run();
  for (const aid of approverIds) {
    await db.prepare(`INSERT OR IGNORE INTO proposal_approvers (proposal_id, user_id) VALUES (?, ?)`).bind(proposalId, aid).run();
  }

  await audit(db, {
    event_type: "PROPOSAL_RESUBMITTED",
    actor_id: me.user.id,
    object_type: "execution_proposal",
    object_id: proposalId,
    request_id: ctx.requestId,
  });

  const proposer = await db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(me.user.id)
    .first<{ display_name: string }>();
  const process = await db.prepare(`SELECT name FROM processes WHERE id = ?`).bind(processId)
    .first<{ name: string }>();
  await notifyUsers(
    db, approverIds, {
      type: "PROPOSAL_RECEIVED",
      title: `Đề xuất lượt gửi lại từ ${proposer?.display_name ?? "nhân viên"}`,
      message: `${proposer?.display_name ?? ""} đã sửa và gửi lại đề xuất lượt "${process?.name ?? ""}"${title ? ` — ${title}` : ""}. Lý do: ${String(mergedBody.reason ?? "").trim()}`,
      link: `#/proposals`,
    }, ctx.env
  );

  return ok({ id: proposalId, status: "PENDING" });
}
