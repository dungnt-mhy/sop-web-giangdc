/**
 * Routes đề xuất lượt công việc.
 * Nhân viên (không có quyền executions.create) đề xuất lượt mới →
 * người phê duyệt duyệt 1 chạm → lượt tự động được tạo.
 */
import type { Ctx } from "./context";
import { type SessionInfo } from "./auth";
import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { notifyUsers } from "./notifications";

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
}

/** POST /api/v1/proposals — nhân viên tạo đề xuất lượt mới. */
export async function handleCreateProposal(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const processId = String(body?.process_id ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const approverId = String(body?.approver_id ?? "").trim();
  const title = typeof body?.title === "string" ? body.title.trim() || null : null;
  const expectedStartAt = typeof body?.expected_start_at === "string" ? body.expected_start_at.trim() || null : null;

  if (!processId) return apiError("VALIDATION_ERROR", "Thiếu quy trình.", ctx.requestId);
  if (!reason) return apiError("VALIDATION_ERROR", "Vui lòng ghi lý do đề xuất.", ctx.requestId);
  if (!approverId) return apiError("VALIDATION_ERROR", "Vui lòng chọn người phê duyệt.", ctx.requestId);
  if (approverId === me.user.id) {
    return apiError("VALIDATION_ERROR", "Không được tự phê duyệt đề xuất của mình.", ctx.requestId);
  }

  // Kiểm tra quy trình có phiên bản hiệu lực.
  const version = await db.prepare(
    `SELECT id FROM process_versions WHERE process_id = ? AND status = 'ACTIVE' LIMIT 1`
  ).bind(processId).first<{ id: string }>();
  if (!version) {
    return apiError("VALIDATION_ERROR", "Quy trình chưa có phiên bản đang hiệu lực.", ctx.requestId);
  }

  // Kiểm tra người phê duyệt có hợp lệ (nằm trong phạm vi đơn vị + có vai trò phù hợp).
  // Đơn giản: kiểm tra user tồn tại và đang active.
  const approver = await db.prepare(
    `SELECT id, display_name FROM users WHERE id = ? AND status = 'active'`
  ).bind(approverId).first<{ id: string; display_name: string }>();
  if (!approver) {
    return apiError("VALIDATION_ERROR", "Người phê duyệt không hợp lệ.", ctx.requestId);
  }

  const now = nowIso();
  const id = newId();
  await db.prepare(
    `INSERT INTO execution_proposals (id, process_id, title, reason, proposer_id, approver_id, expected_start_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
  ).bind(id, processId, title, reason, me.user.id, approverId, expectedStartAt, now).run();

  await audit(db, {
    event_type: "PROPOSAL_CREATED",
    actor_id: me.user.id,
    object_type: "execution_proposal",
    object_id: id,
    request_id: ctx.requestId,
  });

  // Thông báo cho người phê duyệt.
  const proposer = await db.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(me.user.id)
    .first<{ display_name: string }>();
  const process = await db.prepare(`SELECT name FROM processes WHERE id = ?`).bind(processId)
    .first<{ name: string }>();
  await notifyUsers(
    db, [approverId], {
      type: "PROPOSAL_RECEIVED",
      title: `Đề xuất lượt mới từ ${proposer?.display_name ?? "nhân viên"}`,
      message: `${proposer?.display_name ?? ""} đề xuất lượt "${process?.name ?? ""}"${title ? ` — ${title}` : ""}. Lý do: ${reason}`,
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
  const binds: string[] = status ? [status] : [];

  const whoCond = tab === "sent" ? `p.proposer_id = ?` : `p.approver_id = ?`;

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
  ).bind(me.user.id, ...binds).all<ProposalRow & {
    process_name: string | null; proposer_name: string | null; approver_name: string | null;
  }>();

  return ok({ items: rows.results ?? [] });
}

/**
 * POST /api/v1/proposals/:id:approve — người phê duyệt duyệt đề xuất (1 chạm → tạo lượt).
 * Tạo lượt với: người tạo = người phê duyệt (duyệt), người thực hiện = người đề xuất,
 * người phê duyệt lượt = chính người duyệt đề xuất.
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
  if (p.approver_id !== me.user.id) {
    return apiError("FORBIDDEN", "Bạn không phải người phê duyệt đề xuất này.", ctx.requestId);
  }

  // Người duyệt cần có quyền tạo lượt.
  const canCreate = me.permissions.includes("*") || me.permissions.includes("executions.create") ||
    me.permissions.includes("executions.manage");
  if (!canCreate) {
    return apiError("FORBIDDEN", "Bạn không có quyền tạo lượt.", ctx.requestId);
  }

  const now = nowIso();
  // Đánh dấu đã duyệt.
  await db.prepare(
    `UPDATE execution_proposals SET status = 'APPROVED', decided_at = ?, decided_by = ? WHERE id = ?`
  ).bind(now, me.user.id, proposalId).run();

  await audit(db, {
    event_type: "PROPOSAL_APPROVED",
    actor_id: me.user.id,
    object_type: "execution_proposal",
    object_id: proposalId,
    request_id: ctx.requestId,
  });

  // Thông báo cho người đề xuất.
  await notifyUsers(
    db, [p.proposer_id], {
      type: "PROPOSAL_APPROVED",
      title: `Đề xuất của bạn đã được duyệt`,
      message: `Đề xuất lượt "${p.title ?? ""}" đã được phê duyệt. Lượt công việc sẽ được tạo.`,
      link: `#/my-work`,
    }, ctx.env
  );

  // Trả về thông tin để frontend gọi API tạo lượt (với đầy đủ tham số).
  return ok({
    id: proposalId,
    status: "APPROVED",
    // Gợi ý tham số tạo lượt:
    suggest: {
      process_id: p.process_id,
      title: p.title,
      assignee_id: p.proposer_id,
      approver_ids: [me.user.id],
      expected_start_at: p.expected_start_at,
    },
  });
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
  if (p.approver_id !== me.user.id) {
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
