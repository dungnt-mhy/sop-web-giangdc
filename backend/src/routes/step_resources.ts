// routes/step_resources.ts — Tài nguyên hướng dẫn của bước (EVD-011).
// Ảnh/tệp minh họa chỉ đọc khi thực hiện, tách biệt với bằng chứng thực tế.

import { audit, newId, nowIso } from "../db";
import { apiError, ok } from "../errors";
import { requirePermission } from "./auth";
import type { Ctx } from "./context";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB cho tài nguyên hướng dẫn
const ALLOWED_MIMES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
];

type StepResourceRow = {
  id: string;
  step_id: string;
  kind: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  r2_key: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

function toPublic(r: StepResourceRow) {
  return {
    id: r.id,
    step_id: r.step_id,
    kind: r.kind,
    original_name: r.original_name,
    mime: r.mime,
    size_bytes: r.size_bytes,
    caption: r.caption,
    sort_order: r.sort_order,
    created_at: r.created_at,
  };
}

/** POST /processes/x/versions/{vid}/steps/{sid}/resources — tải lên tài nguyên hướng dẫn. */
export async function handleUploadStepResource(ctx: Ctx, versionId: string, stepId: string) {
  const me = await requirePermission(ctx, "processes.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  // Chỉ bản nháp được sửa.
  const ver = await db
    .prepare(`SELECT id, status FROM process_versions WHERE id = ?`)
    .bind(versionId)
    .first<{ id: string; status: string }>();
  if (!ver) return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
  if (ver.status !== "DRAFT") {
    return apiError("VALIDATION_ERROR", "Chỉ bản nháp được thêm tài nguyên hướng dẫn.", ctx.requestId);
  }
  const step = await db
    .prepare(`SELECT id FROM process_steps WHERE id = ? AND version_id = ?`)
    .bind(stepId, versionId)
    .first();
  if (!step) return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);

  const form = await ctx.request.formData().catch(() => null);
  if (!form) return apiError("VALIDATION_ERROR", "Dữ liệu không hợp lệ.", ctx.requestId);
  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError("VALIDATION_ERROR", "Thiếu tệp.", ctx.requestId);
  }
  const caption = typeof form.get("caption") === "string" ? (form.get("caption") as string).trim() || null : null;

  const buf = await file.arrayBuffer();
  const sizeBytes = buf.byteLength;
  if (sizeBytes === 0 || sizeBytes > MAX_BYTES) {
    return apiError("VALIDATION_ERROR", `Dung lượng tệp phải từ 1 byte đến ${MAX_BYTES / 1024 / 1024}MB.`, ctx.requestId);
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIMES.includes(mime)) {
    return apiError("VALIDATION_ERROR", `Loại tệp không được phép: ${mime}.`, ctx.requestId);
  }

  const isPhoto = mime.startsWith("image/");
  const ext = (file.name.split(".").pop() || (isPhoto ? "jpg" : "bin")).toLowerCase().slice(0, 10);
  const id = newId();
  const r2Key = `step-resources/${versionId}/${stepId}/${id}.${ext}`;
  await ctx.env.sop_demo_files.put(r2Key, buf, {
    httpMetadata: { contentType: mime },
  });

  const maxOrder = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) as m FROM step_resources WHERE step_id = ?`)
    .bind(stepId)
    .first<{ m: number }>();

  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO step_resources (id, step_id, kind, original_name, mime, size_bytes, r2_key, caption, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, stepId, isPhoto ? "PHOTO" : "FILE", file.name.slice(0, 255), mime, sizeBytes, r2Key, caption, (maxOrder?.m ?? 0) + 1, now)
    .run();

  await audit(db, {
    event_type: "STEP_RESOURCE_UPLOADED",
    actor_id: me.user.id,
    object_type: "step_resource",
    object_id: id,
    request_id: ctx.requestId,
    diff: { version_id: versionId, step_id: stepId },
  });

  const row = await db.prepare(`SELECT * FROM step_resources WHERE id = ?`).bind(id).first<StepResourceRow>();
  return ok(toPublic(row!), 201);
}

/** GET /processes/x/versions/{vid}/steps/{sid}/resources — danh sách tài nguyên. */
export async function handleListStepResources(ctx: Ctx, versionId: string, stepId: string) {
  const me = await requirePermission(ctx, "processes.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const rows = await db
    .prepare(`SELECT * FROM step_resources WHERE step_id = ? ORDER BY sort_order ASC`)
    .bind(stepId)
    .all<StepResourceRow>();
  return ok({
    items: (rows.results ?? []).map(toPublic),
    total: (rows.results ?? []).length,
  });
}

/** DELETE /step-resources/{id} — xóa tài nguyên (chỉ bản nháp). */
export async function handleDeleteStepResource(ctx: Ctx, resourceId: string) {
  const me = await requirePermission(ctx, "processes.manage");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const r = await db
    .prepare(
      `SELECT sr.*, pv.status as ver_status FROM step_resources sr
       JOIN process_steps ps ON ps.id = sr.step_id
       JOIN process_versions pv ON pv.id = ps.version_id
       WHERE sr.id = ?`
    )
    .bind(resourceId)
    .first<StepResourceRow & { ver_status: string }>();
  if (!r) return apiError("NOT_FOUND", "Không tìm thấy.", ctx.requestId);
  if (r.ver_status !== "DRAFT") {
    return apiError("VALIDATION_ERROR", "Chỉ bản nháp được xóa tài nguyên.", ctx.requestId);
  }

  await ctx.env.sop_demo_files.delete(r.r2_key).catch(() => {});
  await db.prepare(`DELETE FROM step_resources WHERE id = ?`).bind(resourceId).run();

  await audit(db, {
    event_type: "STEP_RESOURCE_DELETED",
    actor_id: me.user.id,
    object_type: "step_resource",
    object_id: resourceId,
    request_id: ctx.requestId,
  });
  return ok({ deleted: true });
}

/** GET /step-resources/{id}/download — tải/xem tệp. */
export async function handleDownloadStepResource(ctx: Ctx, resourceId: string) {
  const me = await requirePermission(ctx, "processes.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

  const r = await db.prepare(`SELECT * FROM step_resources WHERE id = ?`).bind(resourceId).first<StepResourceRow>();
  if (!r) return apiError("NOT_FOUND", "Không tìm thấy.", ctx.requestId);

  const obj = await ctx.env.sop_demo_files.get(r.r2_key);
  if (!obj) return apiError("NOT_FOUND", "Tệp không còn tồn tại.", ctx.requestId);

  const headers = new Headers();
  headers.set("Content-Type", r.mime);
  headers.set("Content-Length", String(r.size_bytes));
  const disp = r.kind === "PHOTO" ? "inline" : "attachment";
  headers.set("Content-Disposition", `${disp}; filename="${encodeURIComponent(r.original_name)}"`);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(obj.body, { headers });
}
