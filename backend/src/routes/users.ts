// routes/users.ts — quản trị tài khoản (Task 1.2).
// Tất cả endpoint yêu cầu quyền `users.manage` (chỉ vai trò admin).
// SPEC: ADM-001 (tạo/khoá/mở tài khoản, gán vai trò), ADM-003 (không log secret).

import {
  audit,
  getCredential,
  getUserById,
  getUserByUsername,
  getUserRoles,
  newId,
  normalizeUsername,
  nowIso,
} from "../db";
import { apiError, ok, readJson } from "../errors";
import { hashPassword } from "../auth";
import { requirePermission, type SessionInfo } from "./auth";
import { isValidRole, permissionsForRoles } from "../permissions";
import type { Ctx } from "./context";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const FAR_FUTURE = "9999-12-31T00:00:00.000Z"; // khoá thủ công tới khi được mở

function publicUser(
  u: {
    id: string;
    username: string;
    display_name: string;
    email: string | null;
    status: string;
    password_changed_at: string | null;
    failed_login_count: number;
    locked_until: string | null;
    created_at: string;
    updated_at: string | null;
  },
  roles: string[],
  mustChangePassword: boolean
) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    email: u.email,
    status: u.status,
    roles,
    permissions: permissionsForRoles(roles),
    must_change_password: mustChangePassword,
    locked_until: u.locked_until,
    password_changed_at: u.password_changed_at,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

async function loadFullUser(db: D1Database, id: string) {
  const u = await getUserById(db, id);
  if (!u) return null;
  const [roles, cred] = await Promise.all([
    getUserRoles(db, id),
    getCredential(db, id),
  ]);
  return publicUser(u, roles, (cred?.must_change_password ?? 0) === 1);
}

function validateRolesInput(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return null;
  const roles: string[] = [];
  for (const r of v) {
    if (typeof r !== "string" || !isValidRole(r)) return null;
    if (!roles.includes(r)) roles.push(r);
  }
  return roles;
}

// GET /api/v1/users?limit=&cursor= — danh sách (cursor pagination).
export async function handleListUsers(ctx: Ctx): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const url = new URL(ctx.request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "25", 10) || 25, 1), 100);
  const cursor = url.searchParams.get("cursor");

  const db = ctx.env.sop_demo_db;
  const rows = await db
    .prepare(
      `SELECT * FROM users
       WHERE (? IS NULL OR (created_at > (SELECT created_at FROM users WHERE id = ?)
             OR (created_at = (SELECT created_at FROM users WHERE id = ?) AND id > ?)))
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
    .bind(cursor, cursor, cursor, cursor, limit + 1)
    .all<{
      id: string; username: string; display_name: string; email: string | null;
      status: string; password_changed_at: string | null; failed_login_count: number;
      locked_until: string | null; created_at: string; updated_at: string | null;
    }>();
  const all = rows.results ?? [];
  const hasMore = all.length > limit;
  const page = all.slice(0, limit);
  const items = [];
  for (const u of page) {
    const [roles, cred] = await Promise.all([
      getUserRoles(db, u.id),
      getCredential(db, u.id),
    ]);
    items.push(publicUser(u, roles, (cred?.must_change_password ?? 0) === 1));
  }
  return ok({
    items,
    next_cursor: hasMore ? page[page.length - 1].id : null,
  });
}

// POST /api/v1/users — tạo tài khoản (mật khẩu tạm, bắt buộc đổi ở lần đăng nhập đầu).
export async function handleCreateUser(ctx: Ctx): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;

  const usernameRaw = typeof body?.username === "string" ? body.username : "";
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
  const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const roles = validateRolesInput(body?.roles);

  const username = normalizeUsername(usernameRaw);
  if (!USERNAME_RE.test(username)) {
    return apiError(
      "VALIDATION_ERROR",
      "Tên đăng nhập 3–32 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới, gạch ngang.",
      ctx.requestId
    );
  }
  if (!displayName || displayName.length > 100) {
    return apiError("VALIDATION_ERROR", "Tên hiển thị không được để trống (tối đa 100 ký tự).", ctx.requestId);
  }
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return apiError("VALIDATION_ERROR", "Email không hợp lệ.", ctx.requestId);
  }
  if (password.length < 8 || password.length > 128) {
    return apiError("VALIDATION_ERROR", "Mật khẩu tạm phải có ít nhất 8 ký tự.", ctx.requestId);
  }
  if (!roles) {
    return apiError("VALIDATION_ERROR", "Vai trò không hợp lệ.", ctx.requestId);
  }

  const db = ctx.env.sop_demo_db;
  if (await getUserByUsername(db, username)) {
    return apiError("VALIDATION_ERROR", "Tên đăng nhập đã tồn tại.", ctx.requestId, {
      field: "username",
    });
  }

  const h = await hashPassword(password);
  const now = nowIso();
  const userId = newId();
  const credId = newId();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO users (id, username, display_name, email, status, failed_login_count, created_at, created_by)
         VALUES (?, ?, ?, ?, 'active', 0, ?, ?)`
      )
      .bind(userId, username, displayName, emailRaw || null, now, (s as SessionInfo).user.id),
    db
      .prepare(
        `INSERT INTO local_credentials (id, user_id, password_hash, password_salt, hash_algorithm, hash_params, must_change_password, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(credId, userId, h.hashB64, h.saltB64, h.algorithm, h.params, now, (s as SessionInfo).user.id),
  ];
  for (const r of roles) {
    stmts.push(
      db
        .prepare(`INSERT INTO user_roles (user_id, role, created_at, created_by) VALUES (?, ?, ?, ?)`)
        .bind(userId, r, now, (s as SessionInfo).user.id)
    );
  }
  await db.batch(stmts);
  await audit(db, {
    event_type: "USER_CREATED",
    actor_id: (s as SessionInfo).user.id,
    object_type: "user",
    object_id: userId,
    request_id: ctx.requestId,
    diff: { username, display_name: displayName, roles },
  });

  const created = await loadFullUser(db, userId);
  return ok(created, 201);
}

// GET /api/v1/users/{id}
export async function handleGetUser(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const u = await loadFullUser(ctx.env.sop_demo_db, id);
  if (!u) return apiError("NOT_FOUND", "Không tìm thấy tài khoản.", ctx.requestId);
  return ok(u);
}

// PATCH /api/v1/users/{id} — sửa tên hiển thị/email/trạng thái/vai trò.
export async function handlePatchUser(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const u = await getUserById(db, id);
  if (!u) return apiError("NOT_FOUND", "Không tìm thấy tài khoản.", ctx.requestId);

  const body = (await readJson(ctx.request)) as Record<string, unknown> | null;
  const updates: string[] = [];
  const binds: unknown[] = [];
  const diff: Record<string, unknown> = {};

  if (body?.display_name !== undefined) {
    const v = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!v || v.length > 100) {
      return apiError("VALIDATION_ERROR", "Tên hiển thị không hợp lệ.", ctx.requestId);
    }
    updates.push("display_name = ?");
    binds.push(v);
    diff.display_name = v;
  }
  if (body?.email !== undefined) {
    const v = typeof body.email === "string" ? body.email.trim() : "";
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return apiError("VALIDATION_ERROR", "Email không hợp lệ.", ctx.requestId);
    }
    updates.push("email = ?");
    binds.push(v || null);
    diff.email = v || null;
  }
  if (body?.status !== undefined) {
    const v = body.status;
    if (v !== "active" && v !== "disabled") {
      return apiError("VALIDATION_ERROR", "Trạng thái không hợp lệ.", ctx.requestId);
    }
    if (id === me.user.id && v === "disabled") {
      return apiError("VALIDATION_ERROR", "Không thể tự vô hiệu hoá chính mình.", ctx.requestId);
    }
    updates.push("status = ?");
    binds.push(v);
    diff.status = v;
  }

  let roles: string[] | null = null;
  if (body?.roles !== undefined) {
    roles = validateRolesInput(body.roles);
    if (!roles) return apiError("VALIDATION_ERROR", "Vai trò không hợp lệ.", ctx.requestId);
    if (id === me.user.id && !roles.includes("admin")) {
      return apiError("VALIDATION_ERROR", "Không thể tự gỡ quyền quản trị của chính mình.", ctx.requestId);
    }
    diff.roles = roles;
  }

  if (updates.length === 0 && roles === null) {
    return apiError("VALIDATION_ERROR", "Không có gì để cập nhật.", ctx.requestId);
  }

  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  if (updates.length > 0) {
    updates.push("updated_at = ?", "updated_by = ?");
    binds.push(now, me.user.id, id);
    stmts.push(
      db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...binds)
    );
  }
  if (roles !== null) {
    stmts.push(db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).bind(id));
    for (const r of roles) {
      stmts.push(
        db.prepare(`INSERT INTO user_roles (user_id, role, created_at, created_by) VALUES (?, ?, ?, ?)`)
          .bind(id, r, now, me.user.id)
      );
    }
  }
  if (stmts.length > 0) await db.batch(stmts);
  await audit(db, {
    event_type: "USER_UPDATED",
    actor_id: me.user.id,
    object_type: "user",
    object_id: id,
    request_id: ctx.requestId,
    diff,
  });
  return ok(await loadFullUser(db, id));
}

// POST /api/v1/users/{id}:lock — khoá thủ công (tới khi được mở), thu hồi mọi phiên.
export async function handleLockUser(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  if (id === me.user.id) {
    return apiError("VALIDATION_ERROR", "Không thể tự khoá chính mình.", ctx.requestId);
  }
  const db = ctx.env.sop_demo_db;
  const u = await getUserById(db, id);
  if (!u) return apiError("NOT_FOUND", "Không tìm thấy tài khoản.", ctx.requestId);
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE users SET locked_until = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .bind(FAR_FUTURE, now, me.user.id, id),
    db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .bind(now, id),
  ]);
  await audit(db, {
    event_type: "USER_LOCKED",
    actor_id: me.user.id,
    object_type: "user",
    object_id: id,
    request_id: ctx.requestId,
  });
  return ok(await loadFullUser(db, id));
}

// POST /api/v1/users/{id}:unlock — mở khoá (xoá khoá tạm + reset bộ đếm sai).
export async function handleUnlockUser(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const u = await getUserById(db, id);
  if (!u) return apiError("NOT_FOUND", "Không tìm thấy tài khoản.", ctx.requestId);
  const now = nowIso();
  await db
    .prepare(`UPDATE users SET locked_until = NULL, failed_login_count = 0, updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(now, me.user.id, id)
    .run();
  await audit(db, {
    event_type: "USER_UNLOCKED",
    actor_id: me.user.id,
    object_type: "user",
    object_id: id,
    request_id: ctx.requestId,
  });
  return ok(await loadFullUser(db, id));
}

// DELETE /api/v1/users/{id} — xoá cứng tài khoản (chỉ khi chưa từng hoạt động).
// SPEC ADM-001: "không xóa nếu đã có lịch sử" — tài khoản đã đăng nhập hoặc đã thao tác
// thì không được xoá cứng (dùng Khoá thay vì Xoá). Không được tự xoá mình,
// không được xoá quản trị viên cuối cùng.
export async function handleDeleteUser(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;

  if (id === me.user.id) {
    return apiError("VALIDATION_ERROR", "Không thể tự xoá chính mình.", ctx.requestId);
  }
  const u = await getUserById(db, id);
  if (!u) return apiError("NOT_FOUND", "Không tìm thấy tài khoản.", ctx.requestId);

  // Không xoá quản trị viên cuối cùng.
  const roles = await getUserRoles(db, id);
  if (roles.includes("admin")) {
    const adminCount = await db
      .prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM user_roles WHERE role = 'admin'`)
      .first<{ c: number }>();
    if ((adminCount?.c ?? 0) <= 1) {
      return apiError("VALIDATION_ERROR", "Không thể xoá quản trị viên cuối cùng.", ctx.requestId);
    }
  }

  // Đã có lịch sử hoạt động? (đã đăng nhập / đã thao tác / đã bị khoá-mở/đổi MK...)
  // Bỏ qua sự kiện USER_CREATED (việc tạo tài khoản không phải hoạt động của chính user đó).
  const history = await db
    .prepare(
      `SELECT 1 FROM audit_events
       WHERE actor_id = ?
          OR (object_type = 'user' AND object_id = ? AND event_type != 'USER_CREATED')
       LIMIT 1`
    )
    .bind(id, id)
    .first();
  if (history) {
    return apiError(
      "VALIDATION_ERROR",
      "Không thể xoá: tài khoản đã có lịch sử hoạt động. Hãy dùng Khoá thay vì Xoá.",
      ctx.requestId
    );
  }

  const username = u.username;
  await db.batch([
    db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).bind(id),
    db.prepare(`DELETE FROM local_credentials WHERE user_id = ?`).bind(id),
    db.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(id),
    db.prepare(`DELETE FROM users WHERE id = ?`).bind(id),
  ]);
  await audit(db, {
    event_type: "USER_DELETED",
    actor_id: me.user.id,
    object_type: "user",
    object_id: id,
    request_id: ctx.requestId,
    diff: { username },
  });
  return ok({ deleted: true, id });
}

// POST /api/v1/users/{id}:force-password-change — bắt đổi MK lần tới + thu hồi mọi phiên.
export async function handleForcePasswordChange(ctx: Ctx, id: string): Promise<Response> {
  const s = requirePermission(ctx, "users.manage");
  if (s instanceof Response) return s;
  const me = s as SessionInfo;
  const db = ctx.env.sop_demo_db;
  const u = await getUserById(db, id);
  if (!u) return apiError("NOT_FOUND", "Không tìm thấy tài khoản.", ctx.requestId);
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE local_credentials SET must_change_password = 1 WHERE user_id = ?`).bind(id),
    db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .bind(now, id),
  ]);
  await audit(db, {
    event_type: "USER_FORCE_PASSWORD_CHANGE",
    actor_id: me.user.id,
    object_type: "user",
    object_id: id,
    request_id: ctx.requestId,
  });
  return ok(await loadFullUser(db, id));
}
