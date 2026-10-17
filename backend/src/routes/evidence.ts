// routes/evidence.ts — Bằng chứng ảnh/tệp cho từng bước thực hiện (EVD-001..013).
// Metadata lưu D1, nội dung tệp lưu R2 (private). Theo EVD-009/EVD-010:
// server kiểm tra MIME thực, dung lượng, số lượng — là nơi quyết định cuối cùng.

import { audit, newId, nowIso } from "../db";
import { apiError, ok, readJson } from "../errors";
import { requirePermission, type SessionInfo } from "./auth";
import type { Ctx } from "./context";

// Giới hạn theo EVD-009 (DEFAULT).
const MAX_PHOTO_SOURCE_BYTES = 15 * 1024 * 1024; // ảnh nguồn tối đa 15MB
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // ảnh sau nén mục tiêu tối đa 2MB (server cho phép tới 5MB)
const MAX_PHOTO_SERVER_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // tệp không phải ảnh tối đa 10MB
const MAX_PHOTOS_PER_STEP = 10; // tối đa 10 ảnh/bước
const MAX_BYTES_PER_STEP = 100 * 1024 * 1024; // tổng tệp một bước tối đa 100MB

const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"];
const FILE_MIMES = [
  ...PHOTO_MIMES,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];

type EvidenceRow = {
  id: string;
  execution_step_id: string;
  uploaded_by: string;
  kind: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  r2_key: string;
  status: string;
  note: string | null;
  created_at: string;
};

function toPublicEvidence(e: EvidenceRow, uploaderName?: string) {
  return {
    id: e.id,
    execution_step_id: e.execution_step_id,
    uploaded_by: e.uploaded_by,
    uploader_name: uploaderName ?? null,
    kind: e.kind,
    original_name: e.original_name,
    mime: e.mime,
    size_bytes: e.size_bytes,
    status: e.status,
    note: e.note,
    created_at: e.created_at,
  };
}

/** Lấy bước thực hiện + kiểm tra quyền truy cập lượt. */
async function getExecStep(ctx: Ctx, execId: string, stepId: string) {
  const db = ctx.env.sop_demo_db;
  const step = await db
    .prepare(`SELECT es.*, e.status as exec_status, e.id as exec_id FROM execution_steps es JOIN executions e ON e.id = es.execution_id WHERE es.id = ? AND es.execution_id = ?`)
    .bind(stepId, execId)
    .first<{
      id: string; execution_id: string; code: string; status: string;
      exec_status: string; exec_id: string;
    }>();
  return step;
}

/** POST /executions/{eid}/steps/{sid}/evidence — tải lên bằng chứng (multipart/form-data). */
export async function handleUploadEvidence(ctx: Ctx, execId: string, stepId: string) {
  const me = await requirePermission(ctx, "executions.execute");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const step = await getExecStep(ctx, execId, stepId);
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
  if (!["IN_PROGRESS", "PAUSED"].includes(step.exec_status)) {
    return apiError("VALIDATION_ERROR", "Chỉ tải bằng chứng khi lượt đang thực hiện.", ctx.requestId);
  }
  if (!["NOT_STARTED", "IN_PROGRESS"].includes(step.status)) {
    return apiError("VALIDATION_ERROR", "Chỉ tải bằng chứng cho bước chưa hoàn thành.", ctx.requestId);
  }

  const form = await ctx.request.formData().catch(() => null);
  if (!form) return apiError("VALIDATION_ERROR", "Dữ liệu tải lên không hợp lệ.", ctx.requestId);
  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError("VALIDATION_ERROR", "Thiếu tệp tải lên.", ctx.requestId);
  }
  const note = typeof form.get("note") === "string" ? (form.get("note") as string).trim() || null : null;

  // Kiểm tra số lượng + tổng dung lượng hiện tại của bước.
  const existing = await db
    .prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes),0) as total FROM evidence WHERE execution_step_id = ?`)
    .bind(stepId)
    .first<{ cnt: number; total: number }>();
  const isPhoto = file.type.startsWith("image/");
  if (isPhoto && (existing?.cnt ?? 0) >= MAX_PHOTOS_PER_STEP) {
    return apiError("VALIDATION_ERROR", `Mỗi bước tối đa ${MAX_PHOTOS_PER_STEP} ảnh.`, ctx.requestId);
  }

  const buf = await file.arrayBuffer();
  const sizeBytes = buf.byteLength;
  if ((existing?.total ?? 0) + sizeBytes > MAX_BYTES_PER_STEP) {
    return apiError("VALIDATION_ERROR", "Tổng dung lượng tệp của bước vượt 100MB.", ctx.requestId);
  }

  // Kiểm tra MIME thực (không tin extension).
  const mime = file.type || "application/octet-stream";
  const allowed = isPhoto ? PHOTO_MIMES : FILE_MIMES;
  if (!allowed.includes(mime)) {
    return apiError("VALIDATION_ERROR", `Loại tệp không được phép: ${mime}.`, ctx.requestId);
  }
  const maxBytes = isPhoto ? MAX_PHOTO_SERVER_BYTES : MAX_FILE_BYTES;
  if (sizeBytes > maxBytes) {
    return apiError(
      "VALIDATION_ERROR",
      isPhoto
        ? `Ảnh vượt quá ${MAX_PHOTO_SERVER_BYTES / 1024 / 1024}MB sau nén. Vui lòng nén lại.`
        : `Tệp vượt quá ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
      ctx.requestId
    );
  }
  if (sizeBytes === 0) {
    return apiError("VALIDATION_ERROR", "Tệp rỗng.", ctx.requestId);
  }

  // Lưu vào R2.
  const ext = (file.name.split(".").pop() || (isPhoto ? "jpg" : "bin")).toLowerCase().slice(0, 10);
  const id = newId();
  const r2Key = `evidence/${execId}/${stepId}/${id}.${ext}`;
  await ctx.env.sop_demo_files.put(r2Key, buf, {
    httpMetadata: { contentType: mime },
  });

  // Lưu metadata vào D1. Demo: tự VERIFIED sau kiểm tra (chưa có scanner — xem EVD-013).
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO evidence (id, execution_step_id, uploaded_by, kind, original_name, mime, size_bytes, r2_key, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`
    )
    .bind(id, stepId, me.user.id, isPhoto ? "PHOTO" : "FILE", file.name.slice(0, 255), mime, sizeBytes, r2Key, note, now)
    .run();

  await audit(db, {
    event_type: "EVIDENCE_UPLOADED",
    actor_id: me.user.id,
    object_type: "evidence",
    object_id: id,
    request_id: ctx.requestId,
    diff: { execution_id: execId, step_id: stepId, code: step.code, mime, size_bytes: sizeBytes },
  });

  const row = await db.prepare(`SELECT * FROM evidence WHERE id = ?`).bind(id).first<EvidenceRow>();
  return ok(toPublicEvidence(row!, me.user.display_name));
}

/** GET /executions/{eid}/steps/{sid}/evidence — danh sách bằng chứng của bước. */
export async function handleListEvidence(ctx: Ctx, execId: string, stepId: string) {
  const me = await requirePermission(ctx, "executions.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const step = await getExecStep(ctx, execId, stepId);
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);

  const rows = await db
    .prepare(
      `SELECT e.*, u.display_name as uploader_name FROM evidence e
       LEFT JOIN users u ON u.id = e.uploaded_by
       WHERE e.execution_step_id = ? ORDER BY e.created_at ASC`
    )
    .bind(stepId)
    .all<EvidenceRow & { uploader_name: string | null }>();
  return ok({
    items: (rows.results ?? []).map((r) => toPublicEvidence(r, r.uploader_name ?? undefined)),
    total: (rows.results ?? []).length,
  });
}

/** DELETE /evidence/{id} — xóa bằng chứng (chỉ khi bước chưa hoàn thành). */
export async function handleDeleteEvidence(ctx: Ctx, evidenceId: string) {
  const me = await requirePermission(ctx, "executions.execute");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const ev = await db
    .prepare(
      `SELECT e.*, es.status as step_status, es.execution_id FROM evidence e
       JOIN execution_steps es ON es.id = e.execution_step_id WHERE e.id = ?`
    )
    .bind(evidenceId)
    .first<EvidenceRow & { step_status: string; execution_id: string }>();
  if (!ev) return apiError("NOT_FOUND", "Không tìm thấy bằng chứng.", ctx.requestId);
  if (!["NOT_STARTED", "IN_PROGRESS"].includes(ev.step_status)) {
    return apiError("VALIDATION_ERROR", "Không xóa bằng chứng của bước đã hoàn thành.", ctx.requestId);
  }

  await ctx.env.sop_demo_files.delete(ev.r2_key).catch(() => {});
  await db.prepare(`DELETE FROM evidence WHERE id = ?`).bind(evidenceId).run();

  await audit(db, {
    event_type: "EVIDENCE_DELETED",
    actor_id: me.user.id,
    object_type: "evidence",
    object_id: evidenceId,
    request_id: ctx.requestId,
    diff: { execution_id: ev.execution_id, step_id: ev.execution_step_id },
  });
  return ok({ deleted: true });
}

/** GET /evidence — danh sách tất cả bằng chứng (có lọc theo loại/ngày). */
export async function handleListAllEvidence(ctx: Ctx) {
  const me = await requirePermission(ctx, "executions.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const url = new URL(ctx.request.url);
  const kind = url.searchParams.get("kind");
  const fromDate = url.searchParams.get("from_date");

  let sql = `
    SELECT ev.*, e.code as execution_code, es.code as step_code, es.title as step_title,
           u.display_name as uploader_name
    FROM evidence ev
    LEFT JOIN executions e ON e.id = ev.execution_id
    LEFT JOIN execution_steps es ON es.id = ev.execution_step_id
    LEFT JOIN users u ON u.id = ev.uploaded_by
    WHERE 1=1`;
  const params: unknown[] = [];
  if (kind && ["PHOTO", "FILE"].includes(kind)) {
    sql += ` AND ev.kind = ?`;
    params.push(kind);
  }
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    sql += ` AND substr(ev.created_at, 1, 10) >= ?`;
    params.push(fromDate);
  }
  sql += ` ORDER BY ev.created_at DESC LIMIT 200`;

  const rows = await db.prepare(sql).bind(...params).all();
  return ok({ items: rows.results ?? [], total: (rows.results ?? []).length });
}

/** GET /evidence/{id}/download — URL tải/xem tệp (kiểm tra quyền, chuyển hướng tới R2). */
export async function handleDownloadEvidence(ctx: Ctx, evidenceId: string) {
  const me = await requirePermission(ctx, "executions.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const ev = await db.prepare(`SELECT * FROM evidence WHERE id = ?`).bind(evidenceId).first<EvidenceRow>();
  if (!ev) return apiError("NOT_FOUND", "Không tìm thấy bằng chứng.", ctx.requestId);

  const obj = await ctx.env.sop_demo_files.get(ev.r2_key);
  if (!obj) return apiError("NOT_FOUND", "Tệp không còn tồn tại.", ctx.requestId);

  const headers = new Headers();
  headers.set("Content-Type", ev.mime);
  headers.set("Content-Length", String(ev.size_bytes));
  // Hiển thị inline cho ảnh, tải về cho tệp khác.
  const disp = ev.kind === "PHOTO" ? "inline" : "attachment";
  headers.set("Content-Disposition", `${disp}; filename="${encodeURIComponent(ev.original_name)}"`);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(obj.body, { headers });
}

/** Đếm bằng chứng VERIFIED của một bước — dùng cho EXE-007. */
export async function countVerifiedEvidence(db: D1Database, stepId: string): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) as cnt FROM evidence WHERE execution_step_id = ? AND status = 'VERIFIED'`)
    .bind(stepId)
    .first<{ cnt: number }>();
  return r?.cnt ?? 0;
}
