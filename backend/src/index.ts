// index.ts — Worker API (Task 1.2: xác thực + quản lý người dùng).
//
// - GET  /health                    (giữ nguyên từ Task 01 — health check)
// - POST /api/v1/auth/login         đăng nhập nội bộ (ONB-003)
// - POST /api/v1/auth/logout        đăng xuất, thu hồi phiên server (ONB-006)
// - POST /api/v1/auth/logout-all    thu hồi mọi phiên của user
// - GET  /api/v1/auth/session       thông tin phiên + vai trò + quyền
// - POST /api/v1/auth/change-password
// - GET/POST /api/v1/users, GET/PATCH /api/v1/users/{id},
//   POST /api/v1/users/{id}:lock|:unlock|:force-password-change  (quyền users.manage)
//
// Quên/khôi phục mật khẩu TẮT theo SPEC (chỉ bật khi OPEN-AUTH-POLICY-01 chốt kênh giao token).

import type { Env } from "./types";
import { newId } from "./db";
import { apiError, ok } from "./errors";
import { Ctx } from "./routes/context";
import {
  csrfCheck,
  handleChangePassword,
  handleGetSession,
  handleLogin,
  handleLogout,
  handleLogoutAll,
} from "./routes/auth";
import {
  handleCreateUser,
  handleDeleteUser,
  handleForcePasswordChange,
  handleGetUser,
  handleListUsers,
  handleLockUser,
  handlePatchUser,
  handleResetPassword,
  handleUnlockUser,
} from "./routes/users";
import {
  handleActivateVersion,
  handleApproveVersion,
  handleCreateProcess,
  handleCreateVersion,
  handleGetProcess,
  handleListProcesses,
  handlePatchProcess,
  handleRetireVersion,
  handleReturnVersion,
  handleSubmitVersion,
} from "./routes/processes";
import {
  handleCopyStep,
  handleCreateStep,
  handleDeleteStep,
  handleListSteps,
  handlePatchStep,
  handleReorderSteps,
  handleValidateVersion,
} from "./routes/steps";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gắn header CORS khi origin thuộc allowlist. */
function applyCors(request: Request, res: Response, ctx: Ctx): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    const o = new URL(origin).origin;
    if (ctx.allowedOrigins.includes(o)) {
      res.headers.set("Access-Control-Allow-Origin", o);
      res.headers.set("Vary", "Origin");
      res.headers.set("Access-Control-Allow-Credentials", "true");
    }
  } catch {
    // origin không hợp lệ: bỏ qua
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = newId();
    const ctx = new Ctx(request, env, requestId);

    // Health check (Task 01) — không cần xác thực.
    if (request.method === "GET" && url.pathname === "/health") {
      return ok({
        status: "ok",
        service: "sop-api",
        env: env.ENV_NAME ?? "unknown",
        time: new Date().toISOString(),
        bindings: {
          d1: Boolean(env.sop_demo_db),
          r2: Boolean(env.sop_demo_files),
        },
      });
    }

    // Mọi request không phải /health và không phải /api/v1/* → phục vụ file tĩnh
    // frontend (Static Assets) cùng origin. Nhờ đó SPA và API chung một tên miền,
    // không còn CORS/preflight/cookie cross-site.
    if (!url.pathname.startsWith("/api/v1/")) {
      return env.ASSETS.fetch(request);
    }

    // Preflight CORS.
    if (request.method === "OPTIONS") {
      const res = new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "600",
        },
      });
      applyCors(request, res, ctx);
      return res;
    }

    const path = url.pathname.slice("/api/v1".length); // bắt đầu bằng "/..."

    // Nạp phiên cho các route cần (không chặn ở đây — từng handler tự đòi quyền).
    await ctx.loadSession();

    let res: Response;
    try {
      res = await route(ctx, request.method, path);
    } catch (e) {
      console.error("[api] lỗi không mong đợi:", requestId, e);
      res = apiError("VALIDATION_ERROR", "Yêu cầu không hợp lệ.", requestId);
    }
    applyCors(request, res, ctx);
    return res;
  },
};

async function route(ctx: Ctx, method: string, path: string): Promise<Response> {
  // CSRF: mutation dùng cookie phải có Origin thuộc allowlist.
  const needsCsrf =
    method !== "GET" && method !== "OPTIONS" && method !== "HEAD";
  if (needsCsrf) {
    const bad = csrfCheck(ctx);
    if (bad) return bad;
  }

  // --- Auth ---
  if (method === "POST" && path === "/auth/login") return handleLogin(ctx);
  if (method === "POST" && path === "/auth/logout") return handleLogout(ctx);
  if (method === "POST" && path === "/auth/logout-all") return handleLogoutAll(ctx);
  if (method === "GET" && path === "/auth/session") return handleGetSession(ctx);
  if (method === "POST" && path === "/auth/change-password") {
    return handleChangePassword(ctx);
  }

  // --- Users (quyền users.manage) ---
  if (path === "/users") {
    if (method === "GET") return handleListUsers(ctx);
    if (method === "POST") return handleCreateUser(ctx);
  }
  const m = /^\/users\/([^/:]+)((?::(lock|unlock|force-password-change|reset-password))?)$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const action = m[3];
    if (!UUID_RE.test(id)) {
      return apiError("NOT_FOUND", "Không tìm thấy tài khoản.", ctx.requestId);
    }
    if (!action) {
      if (method === "GET") return handleGetUser(ctx, id);
      if (method === "PATCH") return handlePatchUser(ctx, id);
      if (method === "DELETE") return handleDeleteUser(ctx, id);
    } else if (method === "POST") {
      if (action === "lock") return handleLockUser(ctx, id);
      if (action === "unlock") return handleUnlockUser(ctx, id);
      if (action === "force-password-change") return handleForcePasswordChange(ctx, id);
      if (action === "reset-password") return handleResetPassword(ctx, id);
    }
  }

  // --- Processes (Task 1.4: danh mục quy trình + phiên bản) ---
  if (path === "/processes") {
    if (method === "GET") return handleListProcesses(ctx);
    if (method === "POST") return handleCreateProcess(ctx);
  }
  const pm = /^\/processes\/([^/:]+)(\/versions)?$/.exec(path);
  if (pm) {
    const pid = decodeURIComponent(pm[1]);
    const isVersions = !!pm[2];
    if (!UUID_RE.test(pid)) {
      return apiError("NOT_FOUND", "Không tìm thấy quy trình.", ctx.requestId);
    }
    if (!isVersions) {
      if (method === "GET") return handleGetProcess(ctx, pid);
      if (method === "PATCH") return handlePatchProcess(ctx, pid);
    } else if (method === "POST") {
      return handleCreateVersion(ctx, pid);
    }
  }
  const vm =
    /^\/processes\/[^/:]+\/versions\/([^/:]+)(?::(submit|approve|return|activate|retire))?$/.exec(path);
  if (vm) {
    const vid = decodeURIComponent(vm[1]);
    const action = vm[2];
    if (!UUID_RE.test(vid)) {
      return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
    }
    if (method === "POST" && action) {
      if (action === "submit") return handleSubmitVersion(ctx, vid);
      if (action === "approve") return handleApproveVersion(ctx, vid);
      if (action === "return") return handleReturnVersion(ctx, vid);
      if (action === "activate") return handleActivateVersion(ctx, vid);
      if (action === "retire") return handleRetireVersion(ctx, vid);
    }
  }

  // --- Steps (Task 1.5: bước công việc trong phiên bản) ---
  const sm = /^\/processes\/[^/:]+\/versions\/([^/:]+)\/steps((?:\/[^/:]+)?)((?::(?:reorder|copy|validate))?)$/.exec(path);
  if (sm) {
    const vid = decodeURIComponent(sm[1]);
    const stepPart = sm[2]; // "" | "/{sid}"
    const action = sm[3]; // "" | ":reorder" | ":copy" | ":validate"
    if (!UUID_RE.test(vid)) {
      return apiError("NOT_FOUND", "Không tìm thấy phiên bản.", ctx.requestId);
    }
    const sid = stepPart ? decodeURIComponent(stepPart.slice(1)) : null;
    if (sid && !UUID_RE.test(sid)) {
      return apiError("NOT_FOUND", "Không tìm thấy bước.", ctx.requestId);
    }
    if (!stepPart && !action) {
      if (method === "GET") return handleListSteps(ctx, vid);
      if (method === "POST") return handleCreateStep(ctx, vid);
    } else if (!stepPart && action === ":reorder" && method === "POST") {
      return handleReorderSteps(ctx, vid);
    } else if (!stepPart && action === ":validate" && method === "GET") {
      return handleValidateVersion(ctx, vid);
    } else if (sid && !action) {
      if (method === "PATCH") return handlePatchStep(ctx, vid, sid);
      if (method === "DELETE") return handleDeleteStep(ctx, vid, sid);
    } else if (sid && action === ":copy" && method === "POST") {
      return handleCopyStep(ctx, vid, sid);
    }
  }

  return apiError("NOT_FOUND", "Not found", ctx.requestId);
}
