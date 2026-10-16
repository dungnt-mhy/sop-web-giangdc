// routes/auth.ts — endpoint xác thực (Task 1.2).
// Prefix: /api/v1. Lỗi đăng nhập luôn chung chung (ONB-003), không tiết lộ tài khoản có tồn tại.

import type { Env } from "../types";
import {
  audit,
  addMs,
  getCredential,
  getUserById,
  getUserByUsername,
  getUserRoles,
  newId,
  normalizeUsername,
  nowIso,
} from "../db";
import { apiError, ok, readJson } from "../errors";
import {
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  SESSION_TTL_MS,
  SESSION_ABSOLUTE_MAX_MS,
  clearSessionCookie,
  clientIp,
  deviceSummary,
  getRequestToken,
  hashPassword,
  hashToken,
  ipThrottleExceeded,
  newSessionToken,
  refreshedExpiry,
  setSessionCookie,
  verifyDummy,
  verifyPassword,
} from "../auth";
import { hasPermission, permissionsForRoles } from "../permissions";
import type { Ctx } from "./context";

/** Thông báo lỗi chung cho mọi trường hợp đăng nhập thất bại (ONB-003). */
const GENERIC_LOGIN_ERROR = "Tên đăng nhập hoặc mật khẩu không đúng.";

export interface SessionInfo {
  sessionId: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    email: string | null;
    status: string;
  };
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
  expiresAt: string;
  /** true khi phiên đến từ cookie (cần kiểm tra CSRF cho mutation). */
  viaCookie: boolean;
}

/** Nạp phiên từ token (cookie/Bearer). Trả null khi không có hoặc không hợp lệ. */
export async function loadSession(ctx: Ctx): Promise<SessionInfo | null> {
  const token = getRequestToken(ctx.request);
  if (!token) return null;
  const viaCookie = !/^Bearer\s+/i.test(ctx.request.headers.get("authorization") ?? "");
  const tokenHash = await hashToken(token);
  const db = ctx.env.sop_demo_db;

  const s = await db
    .prepare(
      `SELECT * FROM user_sessions WHERE session_hash = ? AND revoked_at IS NULL`
    )
    .bind(tokenHash)
    .first<{
      id: string;
      user_id: string;
      created_at: string;
      expires_at: string;
    }>();
  if (!s) return null;

  const now = nowIso();
  // Hết hạn (trượt) hoặc quá hạn tuyệt đối 7 ngày → thu hồi.
  if (
    s.expires_at <= now ||
    addMs(s.created_at, SESSION_ABSOLUTE_MAX_MS) <= now
  ) {
    await db
      .prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ?`)
      .bind(now, s.id)
      .run();
    return null;
  }

  const user = await getUserById(db, s.user_id);
  if (!user || user.status !== "active") return null;
  if (user.locked_until && user.locked_until > now) return null;

  const cred = await getCredential(db, user.id);
  const roles = await getUserRoles(db, user.id);

  // Trượt hạn dùng: cập nhật last_seen_at + expires_at.
  await db
    .prepare(`UPDATE user_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`)
    .bind(now, refreshedExpiry(), s.id)
    .run();

  return {
    sessionId: s.id,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      status: user.status,
    },
    roles,
    permissions: permissionsForRoles(roles),
    mustChangePassword: (cred?.must_change_password ?? 0) === 1,
    expiresAt: refreshedExpiry(),
    viaCookie,
  };
}

export function sessionPayload(s: SessionInfo) {
  return {
    user: s.user,
    roles: s.roles,
    permissions: s.permissions,
    must_change_password: s.mustChangePassword,
    session: { expires_at: s.expiresAt },
  };
}

// POST /api/v1/auth/login
export async function handleLogin(ctx: Ctx): Promise<Response> {
  const body = (await readJson(ctx.request)) as {
    username?: unknown;
    password?: unknown;
  } | null;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username.trim() || !password) {
    return apiError("VALIDATION_ERROR", "Vui lòng nhập tên đăng nhập và mật khẩu.", ctx.requestId);
  }

  // Chống brute-force theo IP (SPEC §15.1).
  if (ipThrottleExceeded(clientIp(ctx.request))) {
    return apiError(
      "RATE_LIMITED",
      "Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau vài phút.",
      ctx.requestId
    );
  }

  const db = ctx.env.sop_demo_db;
  const normalized = normalizeUsername(username);
  const user = await getUserByUsername(db, normalized);

  // Không tồn tại → băm giả để cân bằng timing, rồi báo lỗi chung.
  if (!user) {
    await verifyDummy(password);
    await audit(db, {
      event_type: "AUTH_LOGIN_FAIL",
      object_type: "user",
      request_id: ctx.requestId,
      diff: { username: normalized, reason: "unknown_user" },
    });
    return apiError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR, ctx.requestId);
  }

  const now = nowIso();
  const locked = user.locked_until && user.locked_until > now;
  const disabled = user.status !== "active";
  const cred = await getCredential(db, user.id);
  const passwordOk =
    !locked && !disabled && cred
      ? await verifyPassword(password, cred.password_salt, cred.password_hash, cred.hash_params)
      : false;

  if (!passwordOk) {
    // Sai mật khẩu (hoặc tài khoản bị khoá/vô hiệu hoá): tăng bộ đếm, khoá tạm khi đủ 5 lần.
    const failed = (user.failed_login_count ?? 0) + 1;
    const shouldLock = failed >= MAX_FAILED_LOGINS;
    const lockedUntil = shouldLock ? addMs(now, LOCKOUT_MS) : user.locked_until;
    await db.batch([
      db
        .prepare(`UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?`)
        .bind(failed, lockedUntil, user.id),
    ]);
    await audit(db, {
      event_type: "AUTH_LOGIN_FAIL",
      actor_id: user.id,
      object_type: "user",
      object_id: user.id,
      request_id: ctx.requestId,
      diff: { reason: locked ? "locked" : disabled ? "disabled" : "bad_password", failed },
    });
    // Luôn báo lỗi chung — không tiết lộ tài khoản bị khoá hay sai mật khẩu (ONB-003).
    return apiError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR, ctx.requestId);
  }

  // Đăng nhập thành công: reset bộ đếm, tạo phiên mới.
  const token = newSessionToken();
  const tokenHash = await hashToken(token);
  const expiresAt = addMs(now, SESSION_TTL_MS);
  const sessionId = newId();
  const roles = await getUserRoles(db, user.id);
  await db.batch([
    db
      .prepare(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?`)
      .bind(user.id),
    db
      .prepare(
        `INSERT INTO user_sessions (id, user_id, session_hash, created_at, last_seen_at, expires_at, revoked_at, device_summary)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .bind(sessionId, user.id, tokenHash, now, now, expiresAt, deviceSummary(ctx.request)),
  ]);
  await audit(db, {
    event_type: "AUTH_LOGIN_OK",
    actor_id: user.id,
    object_type: "session",
    object_id: sessionId,
    request_id: ctx.requestId,
  });

  const info: SessionInfo = {
    sessionId,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      status: user.status,
    },
    roles,
    permissions: permissionsForRoles(roles),
    mustChangePassword: (cred?.must_change_password ?? 0) === 1,
    expiresAt,
    viaCookie: true,
  };
  const res = ok(sessionPayload(info));
  setSessionCookie(res, token, ctx.isHttps);
  return res;
}

// POST /api/v1/auth/logout — thu hồi phiên hiện tại.
export async function handleLogout(ctx: Ctx): Promise<Response> {
  const s = ctx.session;
  const res = ok({ ok: true });
  clearSessionCookie(res, ctx.isHttps);
  if (s) {
    await ctx.env.sop_demo_db
      .prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ?`)
      .bind(nowIso(), s.sessionId)
      .run();
    await audit(ctx.env.sop_demo_db, {
      event_type: "AUTH_LOGOUT",
      actor_id: s.user.id,
      object_type: "session",
      object_id: s.sessionId,
      request_id: ctx.requestId,
    });
  }
  return res;
}

// POST /api/v1/auth/logout-all — thu hồi TẤT CẢ phiên của user hiện tại.
export async function handleLogoutAll(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  await ctx.env.sop_demo_db
    .prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .bind(nowIso(), s.user.id)
    .run();
  await audit(ctx.env.sop_demo_db, {
    event_type: "AUTH_LOGOUT_ALL",
    actor_id: s.user.id,
    object_type: "user",
    object_id: s.user.id,
    request_id: ctx.requestId,
  });
  const res = ok({ ok: true });
  clearSessionCookie(res, ctx.isHttps);
  return res;
}

// GET /api/v1/auth/session — thông tin phiên hiện tại.
export async function handleGetSession(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  return ok(sessionPayload(s));
}

function validateNewPassword(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 8) {
    return "Mật khẩu mới phải có ít nhất 8 ký tự.";
  }
  if (pw.length > 128) return "Mật khẩu mới quá dài (tối đa 128 ký tự).";
  return null;
}

// POST /api/v1/auth/change-password
export async function handleChangePassword(ctx: Ctx): Promise<Response> {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  const body = (await readJson(ctx.request)) as {
    current_password?: unknown;
    new_password?: unknown;
  } | null;
  const current = typeof body?.current_password === "string" ? body.current_password : "";
  const next = typeof body?.new_password === "string" ? body.new_password : "";

  const pwError = validateNewPassword(next);
  if (pwError) return apiError("VALIDATION_ERROR", pwError, ctx.requestId);
  if (!current) {
    return apiError("VALIDATION_ERROR", "Vui lòng nhập mật khẩu hiện tại.", ctx.requestId);
  }
  if (current === next) {
    return apiError("VALIDATION_ERROR", "Mật khẩu mới phải khác mật khẩu hiện tại.", ctx.requestId);
  }

  const db = ctx.env.sop_demo_db;
  const cred = await getCredential(db, s.user.id);
  if (!cred || !(await verifyPassword(current, cred.password_salt, cred.password_hash, cred.hash_params))) {
    return apiError("UNAUTHENTICATED", "Mật khẩu hiện tại không đúng.", ctx.requestId);
  }

  // Xoay vòng: hash mới với salt mới; thu hồi mọi phiên KHÁC (giữ phiên hiện tại).
  const h = await hashPassword(next);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE local_credentials
         SET password_hash = ?, password_salt = ?, hash_algorithm = ?, hash_params = ?,
             must_change_password = 0, rotated_at = ?
         WHERE user_id = ?`
      )
      .bind(h.hashB64, h.saltB64, h.algorithm, h.params, now, s.user.id),
    db
      .prepare(`UPDATE users SET password_changed_at = ? WHERE id = ?`)
      .bind(now, s.user.id),
    db
      .prepare(
        `UPDATE user_sessions SET revoked_at = ?
         WHERE user_id = ? AND id != ? AND revoked_at IS NULL`
      )
      .bind(now, s.user.id, s.sessionId),
  ]);
  await audit(db, {
    event_type: "AUTH_PASSWORD_CHANGED",
    actor_id: s.user.id,
    object_type: "user",
    object_id: s.user.id,
    request_id: ctx.requestId,
  });
  return ok({ ok: true });
}

/** Kiểm tra CSRF cho mutation dùng cookie: Origin phải thuộc allowlist (SPEC §15.1). */
export function csrfCheck(ctx: Ctx): Response | null {
  if (!ctx.session?.viaCookie) return null; // Bearer token không cần kiểm tra CSRF
  const origin = ctx.request.headers.get("origin");
  if (!origin) return null; // client không phải trình duyệt
  try {
    const allowed = ctx.allowedOrigins;
    const o = new URL(origin).origin;
    if (!allowed.includes(o)) {
      return apiError("FORBIDDEN", "Yêu cầu không hợp lệ.", ctx.requestId);
    }
  } catch {
    return apiError("FORBIDDEN", "Yêu cầu không hợp lệ.", ctx.requestId);
  }
  return null;
}

/** Đòi quyền; trả 401 nếu chưa đăng nhập, 403 nếu thiếu quyền. */
export function requirePermission(
  ctx: Ctx,
  perm: string
): SessionInfo | Response {
  const s = ctx.requireAuth();
  if (s instanceof Response) return s;
  if (!hasPermission(s.permissions, perm)) {
    return apiError(
      "FORBIDDEN",
      "Tài khoản không có quyền thực hiện thao tác này.",
      ctx.requestId
    );
  }
  return s;
}
