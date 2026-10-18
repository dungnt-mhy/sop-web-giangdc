import type { Ctx } from "./context";
import { ok, apiError } from "../errors.js";
import { newId, nowIso } from "../db.js";

export interface CreateNotificationInput {
  user_id: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
}

/** Tạo thông báo trong app cho một user. */
export async function createNotification(
  db: D1Database,
  input: CreateNotificationInput
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, message, link, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      newId(),
      input.user_id,
      input.type,
      input.title,
      input.message ?? null,
      input.link ?? null,
      nowIso()
    ).run();
  } catch (err) {
    // Không làm hỏng luồng chính nếu tạo thông báo lỗi.
    console.error("[notification] create failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Tạo thông báo cho nhiều user. */
export async function notifyUsers(
  db: D1Database,
  userIds: string[],
  input: Omit<CreateNotificationInput, "user_id">
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const uid of unique) {
    await createNotification(db, { ...input, user_id: uid });
  }
}

// GET /api/v1/notifications — danh sách thông báo của tôi.
export async function handleListNotifications(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as { user: { id: string } };
  const db = ctx.env.sop_demo_db;
  const url = new URL(ctx.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 50);
  const rows = await db.prepare(
    `SELECT id, type, title, message, link, is_read, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(me.user.id, limit).all();
  return ok({ items: rows.results ?? [] });
}

// GET /api/v1/notifications/unread-count — số thông báo chưa đọc.
export async function handleUnreadCount(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as { user: { id: string } };
  const db = ctx.env.sop_demo_db;
  const r = await db.prepare(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`
  ).bind(me.user.id).first<{ c: number }>();
  return ok({ unread: r?.c ?? 0 });
}

// POST /api/v1/notifications/:id/read — đánh dấu đã đọc.
export async function handleMarkRead(ctx: Ctx, id: string): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as { user: { id: string } };
  const db = ctx.env.sop_demo_db;
  await db.prepare(
    `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`
  ).bind(id, me.user.id).run();
  return ok({ ok: true });
}

// POST /api/v1/notifications/read-all — đánh dấu tất cả đã đọc.
export async function handleMarkAllRead(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as { user: { id: string } };
  const db = ctx.env.sop_demo_db;
  await db.prepare(
    `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`
  ).bind(me.user.id).run();
  return ok({ ok: true });
}
