import type { Ctx } from "./context";
import { ok, apiError } from "../errors.js";
import { newId, nowIso } from "../db.js";
import { notifyTelegram } from "../telegram.js";

const FROM_EMAIL = "Dungnt.connect@gmail.com";
const FROM_NAME = "SOP Demo";
// TẠM ĐÓNG BĂNG gửi email theo yêu cầu (2026-10-18).
const EMAIL_ENABLED = false;

/** Env tối thiểu để gửi Telegram (được truyền từ ctx.env). */
export interface NotifyEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  sop_demo_db: D1Database;
}

export interface CreateNotificationInput {
  user_id: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
  /** Gửi email kèm theo (mặc định true nếu user có email). */
  sendEmail?: boolean;
}

/** Gửi email qua MailChannels (miễn phí trên Cloudflare Workers). */
async function sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  try {
    const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject,
        content: [{ type: "text/html", value: htmlBody }],
      }),
    });
    if (!resp.ok) {
      console.error("[email] send failed:", resp.status, await resp.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[email] send error:", err instanceof Error ? err.message : String(err));
  }
}

/** Tạo thông báo trong app cho một user (kèm gửi email nếu có). */
export async function createNotification(
  db: D1Database,
  input: CreateNotificationInput,
  env?: NotifyEnv
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
    // Gửi Telegram nếu user đã liên kết (await để đảm bảo gửi xong).
    if (env) {
      await notifyTelegram(env, input.user_id, input.title, input.message, input.link).catch(() => {});
    }
    // Gửi email nếu user có email (trừ khi tắt explicitly). Đang đóng băng.
    if (EMAIL_ENABLED && input.sendEmail !== false) {
      const u = await db.prepare(`SELECT email FROM users WHERE id = ?`).bind(input.user_id).first<{ email: string | null }>();
      if (u?.email) {
        const linkHtml = input.link ? `<p><a href="https://sop-api.dungnt-storage.workers.dev/${input.link}">Xem chi tiết</a></p>` : "";
        await sendEmail(
          u.email,
          `[SOP] ${input.title}`,
          `<h3>${escapeHtml(input.title)}</h3>${input.message ? `<p>${escapeHtml(input.message)}</p>` : ""}${linkHtml}<p style="color:#888;font-size:12px;">Email tự động từ hệ thống SOP Demo.</p>`
        );
      }
    }
  } catch (err) {
    // Không làm hỏng luồng chính nếu tạo thông báo lỗi.
    console.error("[notification] create failed:", err instanceof Error ? err.message : String(err));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Tạo thông báo cho nhiều user. */
export async function notifyUsers(
  db: D1Database,
  userIds: string[],
  input: Omit<CreateNotificationInput, "user_id">,
  env?: NotifyEnv
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  // Batch insert thay vì từng cái một.
  const stmts = unique.map((uid) => {
    const id = newId();
    const now = nowIso();
    return db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, message, link, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(id, uid, input.type, input.title, input.message, input.link ?? null, now);
  });
  await db.batch(stmts);
  // Gửi Telegram cho từng user đã liên kết (await để đảm bảo gửi xong trước khi Worker tắt).
  if (env) {
    await Promise.all(
      unique.map((uid) =>
        notifyTelegram(env, uid, input.title, input.message, input.link).catch(() => {})
      )
    );
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

// GET /api/v1/telegram/link-url — lấy link t.me để liên kết Telegram.
export async function handleTelegramLinkUrl(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as { user: { id: string; telegram_chat_id?: string | null } };
  const db = ctx.env.sop_demo_db;
  const u = await db.prepare(`SELECT telegram_chat_id FROM users WHERE id = ?`).bind(me.user.id).first<{ telegram_chat_id: string | null }>();
  const username = (ctx.env as unknown as Record<string, string>).TELEGRAM_BOT_USERNAME;
  const configured = !!(ctx.env as unknown as Record<string, string>).TELEGRAM_BOT_TOKEN;
  return ok({
    configured,
    linked: !!u?.telegram_chat_id,
    link_url: configured && username ? `https://t.me/${username}?start=${me.user.id}` : null,
  });
}

// POST /api/v1/telegram/unlink — hủy liên kết Telegram.
export async function handleTelegramUnlink(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const me = s as { user: { id: string } };
  const db = ctx.env.sop_demo_db;
  await db.prepare(`UPDATE users SET telegram_chat_id = NULL WHERE id = ?`).bind(me.user.id).run();
  return ok({ ok: true });
}
