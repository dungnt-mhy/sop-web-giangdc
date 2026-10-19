// telegram.ts — Gửi thông báo qua Telegram Bot API.
// Bot token lấy từ env TELEGRAM_BOT_TOKEN. Nếu chưa cấu hình, mọi hàm gửi
// đều bỏ qua lặng lẽ (không làm hỏng luồng chính).

interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
}

export function telegramConfigured(env: TelegramEnv): boolean {
  return !!env.TELEGRAM_BOT_TOKEN;
}

export function telegramLinkUrl(env: TelegramEnv, userId: string): string | null {
  const username = env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?start=${userId}`;
}

/** Gửi tin nhắn text tới một chat_id. Trả về true nếu gửi thành công. */
export async function sendTelegramMessage(
  env: TelegramEnv,
  chatId: string,
  text: string
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error("[telegram] send failed:", resp.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] send error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Soạn nội dung tin nhắn Telegram từ thông báo. */
export function formatTelegramMessage(title: string, message?: string | null, link?: string | null): string {
  let text = `🔔 <b>${escapeHtml(title)}</b>`;
  if (message) text += `\n${escapeHtml(message)}`;
  if (link) {
    const url = link.startsWith("http") ? link : `https://sop-api.dungnt-storage.workers.dev/#${link}`;
    text += `\n👉 <a href="${url}">Xem chi tiết</a>`;
  }
  return text;
}

/** Gửi thông báo Telegram cho một user (nếu đã liên kết). */
export async function notifyTelegram(
  env: TelegramEnv & { sop_demo_db: D1Database },
  userId: string,
  title: string,
  message?: string | null,
  link?: string | null
): Promise<void> {
  if (!telegramConfigured(env)) return;
  try {
    const u = await env.sop_demo_db
      .prepare(`SELECT telegram_chat_id FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ telegram_chat_id: string | null }>();
    if (!u?.telegram_chat_id) return;
    await sendTelegramMessage(env, u.telegram_chat_id, formatTelegramMessage(title, message, link));
  } catch (err) {
    console.error("[telegram] notify failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Xử lý webhook update từ Telegram: /start <user_id> để liên kết. */
export async function handleTelegramWebhook(
  env: TelegramEnv & { sop_demo_db: D1Database },
  update: {
    message?: { text?: string; chat?: { id?: number | string }; from?: { id?: number } };
  }
): Promise<{ ok: boolean; linked?: boolean }> {
  const msg = update.message;
  const text = (msg?.text ?? "").trim();
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
  if (!chatId || !text.startsWith("/start")) return { ok: true };

  const parts = text.split(/\s+/);
  const userId = parts[1]?.trim();
  if (!userId) {
    // Không có user_id — hướng dẫn mở từ app.
    await sendTelegramMessage(
      env,
      chatId,
      `👋 Chào bạn! Để liên kết tài khoản SOP, hãy bấm nút "🔗 Liên kết Telegram" trong ứng dụng rồi bấm Start ở đây.`
    );
    return { ok: true };
  }

  // Kiểm tra user tồn tại.
  const u = await env.sop_demo_db
    .prepare(`SELECT id, display_name, username FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ id: string; display_name: string | null; username: string }>();
  if (!u) {
    await sendTelegramMessage(env, chatId, `❌ Không tìm thấy tài khoản. Hãy mở link liên kết từ ứng dụng SOP.`);
    return { ok: true };
  }

  await env.sop_demo_db
    .prepare(`UPDATE users SET telegram_chat_id = ?, updated_at = ? WHERE id = ?`)
    .bind(chatId, new Date().toISOString(), userId)
    .run();

  const name = u.display_name || u.username;
  await sendTelegramMessage(
    env,
    chatId,
    `✅ Liên kết thành công!\nTài khoản <b>${escapeHtml(name)}</b> sẽ nhận thông báo SOP qua Telegram từ bây giờ.`
  );
  return { ok: true, linked: true };
}
