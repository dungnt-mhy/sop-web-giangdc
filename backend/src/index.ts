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
  handleListActiveUsers,
  handleListUsers,
  handleLockUser,
  handlePatchUser,
  handleResetPassword,
  handleUnlockUser,
} from "./routes/users";
import {
  handleActivateVersion,
  handleApproveReactivation,
  handleApproveVersion,
  handleCreateProcess,
  handleCreateVersion,
  handleGetProcess,
  handleListProcesses,
  handlePatchProcess,
  handleRejectReactivation,
  handleRequestReactivation,
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
import {
  handleCancelExecution,
  handleConfirmComplete,
  handleCompleteStep,
  handleCreateExecution,
  handleGetExecution,
  handleListExecutions,
  handleListStepAssignees,
  handlePauseExecution,
  handleReportComplete,
  handleResumeExecution,
  handleSetStepAssignees,
  handleSkipStep,
  handleStartExecution,
  handleStartStep,
} from "./routes/executions";
import {
  handleCreatePosition,
  handleDeletePosition,
  handleListPositions,
  handleUpdatePosition,
} from "./routes/positions";
import {
  handleCreateOrgUnit,
  handleDeleteOrgUnit,
  handleListOrgUnits,
  handleUpdateOrgUnit,
} from "./routes/org_units";
import {
  PERMISSION_CATALOG,
  handleCreateRole,
  handleDeleteRole,
  handleListRoles,
  handleUpdateRole,
} from "./routes/roles";
import {
  handleDeleteEvidence,
  handleDownloadEvidence,
  handleListAllEvidence,
  handleListEvidence,
  handleUploadEvidence,
} from "./routes/evidence";
import {
  handleDeleteStepResource,
  handleDownloadStepResource,
  handleListStepResources,
  handleUploadStepResource,
} from "./routes/step_resources";
import {
  handleDashboardExecutions,
  handleDashboardExportCsv,
  handleDashboardDaily,
  handleDashboardOverview,
  handleDashboardSummary,
} from "./routes/dashboard";
import {
  handleCloseException,
  handleCreateException,
  handleListAllExceptions,
  handleListExceptions,
  handleResolveException,
  handleStartException,
} from "./routes/exceptions";

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

  // --- Vai trò ứng dụng ---
  if (path === "/roles" && method === "GET") return handleListRoles(ctx);
  if (path === "/roles" && method === "POST") return handleCreateRole(ctx);
  const roleM = /^\/roles\/([^/:]+)$/.exec(path);
  if (roleM && UUID_RE.test(roleM[1])) {
    const rid = decodeURIComponent(roleM[1]);
    if (method === "PATCH") return handleUpdateRole(ctx, rid);
    if (method === "DELETE") return handleDeleteRole(ctx, rid);
  }

  // --- Chức vụ ---
  if (path === "/positions" && method === "GET") return handleListPositions(ctx);
  if (path === "/positions" && method === "POST") return handleCreatePosition(ctx);
  const posM = /^\/positions\/([^/:]+)$/.exec(path);
  if (posM && UUID_RE.test(posM[1])) {
    const pid = decodeURIComponent(posM[1]);
    if (method === "PATCH") return handleUpdatePosition(ctx, pid);
    if (method === "DELETE") return handleDeletePosition(ctx, pid);
  }

  // --- Org units (đơn vị tổ chức) ---
  if (path === "/org-units" && method === "GET") return handleListOrgUnits(ctx);
  if (path === "/org-units" && method === "POST") return handleCreateOrgUnit(ctx);
  const ouM = /^\/org-units\/([^/:]+)$/.exec(path);
  if (ouM && UUID_RE.test(ouM[1])) {
    const oid = decodeURIComponent(ouM[1]);
    if (method === "PATCH") return handleUpdateOrgUnit(ctx, oid);
    if (method === "DELETE") return handleDeleteOrgUnit(ctx, oid);
  }

  // --- Users (quyền users.manage) ---
  if (path === "/users/active" && method === "GET") {
    return handleListActiveUsers(ctx);
  }
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
    /^\/processes\/[^/:]+\/versions\/([^/:]+)(?::(submit|approve|return|activate|retire|request-reactivation|approve-reactivation|reject-reactivation))?$/.exec(path);
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
      if (action === "request-reactivation") return handleRequestReactivation(ctx, vid);
      if (action === "approve-reactivation") return handleApproveReactivation(ctx, vid);
      if (action === "reject-reactivation") return handleRejectReactivation(ctx, vid);
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

  // --- Executions (Task 1.6: lượt thực hiện) ---
  if (path === "/executions") {
    if (method === "GET") return handleListExecutions(ctx);
    if (method === "POST") return handleCreateExecution(ctx);
  }
  const em = /^\/executions\/([^/:]+)((?::(start|pause|resume|cancel|complete|report-complete|confirm-complete))?)$/.exec(path);
  if (em) {
    const eid = decodeURIComponent(em[1]);
    const action = em[3];
    if (!UUID_RE.test(eid)) {
      return apiError("NOT_FOUND", "Không tìm thấy lượt thực hiện.", ctx.requestId);
    }
    if (!action) {
      if (method === "GET") return handleGetExecution(ctx, eid);
    } else if (method === "POST") {
      if (action === "start") return handleStartExecution(ctx, eid);
      if (action === "pause") return handlePauseExecution(ctx, eid);
      if (action === "resume") return handleResumeExecution(ctx, eid);
      if (action === "cancel") return handleCancelExecution(ctx, eid);
      if (action === "report-complete") return handleReportComplete(ctx, eid);
      if (action === "confirm-complete") return handleConfirmComplete(ctx, eid);
      if (action === "complete") return handleReportComplete(ctx, eid); // tương thích cũ
    }
  }
  const esm = /^\/executions\/[^/:]+\/steps\/([^/:]+)(?::(start|complete|skip))$/.exec(path);
  if (esm && method === "POST") {
    const eidM = /^\/executions\/([^/:]+)\/steps\//.exec(path);
    const eid = eidM ? decodeURIComponent(eidM[1]) : "";
    const sid = decodeURIComponent(esm[1]);
    const action = esm[2];
    if (!UUID_RE.test(eid) || !UUID_RE.test(sid)) {
      return apiError("NOT_FOUND", "Không tìm thấy.", ctx.requestId);
    }
    if (action === "start") return handleStartStep(ctx, eid, sid);
    if (action === "complete") return handleCompleteStep(ctx, eid, sid);
    if (action === "skip") return handleSkipStep(ctx, eid, sid);
  }
  // --- Phân công người cho bước ---
  const asg = /^\/executions\/([^/:]+)\/steps\/([^/:]+)\/assignees$/.exec(path);
  if (asg && UUID_RE.test(asg[1]) && UUID_RE.test(asg[2])) {
    const eid = decodeURIComponent(asg[1]);
    const sid = decodeURIComponent(asg[2]);
    if (method === "GET") return handleListStepAssignees(ctx, eid, sid);
    if (method === "PUT") return handleSetStepAssignees(ctx, eid, sid);
  }
  // --- Bằng chứng (Task 1.7: EVD-001..013) ---
  const evUp = /^\/executions\/([^/:]+)\/steps\/([^/:]+)\/evidence$/.exec(path);
  if (evUp && UUID_RE.test(evUp[1]) && UUID_RE.test(evUp[2])) {
    const eid = decodeURIComponent(evUp[1]);
    const sid = decodeURIComponent(evUp[2]);
    if (method === "POST") return handleUploadEvidence(ctx, eid, sid);
    if (method === "GET") return handleListEvidence(ctx, eid, sid);
  }
  const evDel = /^\/evidence\/([^/:]+)$/.exec(path);
  if (evDel && UUID_RE.test(evDel[1])) {
    const evid = decodeURIComponent(evDel[1]);
    if (method === "DELETE") return handleDeleteEvidence(ctx, evid);
  }
  const evDl = /^\/evidence\/([^/:]+)\/download$/.exec(path);
  if (evDl && method === "GET" && UUID_RE.test(evDl[1])) {
    return handleDownloadEvidence(ctx, decodeURIComponent(evDl[1]));
  }
  // --- Quản lý bằng chứng tổng hợp ---
  if (path === "/evidence" && method === "GET") {
    return handleListAllEvidence(ctx);
  }
  // --- Tài nguyên hướng dẫn bước (Task 1.7: EVD-011) ---
  const srUp = /^\/processes\/x\/versions\/([^/:]+)\/steps\/([^/:]+)\/resources$/.exec(path);
  if (srUp && UUID_RE.test(srUp[1]) && UUID_RE.test(srUp[2])) {
    const vid = decodeURIComponent(srUp[1]);
    const sid = decodeURIComponent(srUp[2]);
    if (method === "POST") return handleUploadStepResource(ctx, vid, sid);
    if (method === "GET") return handleListStepResources(ctx, vid, sid);
  }
  const srDel = /^\/step-resources\/([^/:]+)$/.exec(path);
  if (srDel && UUID_RE.test(srDel[1])) {
    const rid = decodeURIComponent(srDel[1]);
    if (method === "DELETE") return handleDeleteStepResource(ctx, rid);
  }
  const srDl = /^\/step-resources\/([^/:]+)\/download$/.exec(path);
  if (srDl && method === "GET" && UUID_RE.test(srDl[1])) {
    return handleDownloadStepResource(ctx, decodeURIComponent(srDl[1]));
  }
  // --- Dashboard (Task 1.8: §9.6) ---
  if (path === "/dashboard/summary" && method === "GET") {
    return handleDashboardSummary(ctx);
  }
  if (path === "/dashboard/overview" && method === "GET") {
    return handleDashboardOverview(ctx);
  }
  if (path === "/dashboard/daily" && method === "GET") {
    return handleDashboardDaily(ctx);
  }
  if (path === "/dashboard/executions" && method === "GET") {
    return handleDashboardExecutions(ctx);
  }
  if (path === "/dashboard/export.csv" && method === "GET") {
    return handleDashboardExportCsv(ctx);
  }
  // --- Ngoại lệ (SPEC §9.5) ---
  if (path === "/exceptions" && method === "GET") {
    return handleListAllExceptions(ctx);
  }
  const excCreate = /^\/executions\/([^/:]+)\/exceptions$/.exec(path);
  if (excCreate && UUID_RE.test(excCreate[1])) {
    const eid = decodeURIComponent(excCreate[1]);
    if (method === "POST") return handleCreateException(ctx, eid);
    if (method === "GET") return handleListExceptions(ctx, eid);
  }
  const excAct = /^\/exceptions\/([^/:]+):(start|resolve|close)$/.exec(path);
  if (excAct && method === "POST" && UUID_RE.test(excAct[1])) {
    const exid = decodeURIComponent(excAct[1]);
    if (excAct[2] === "start") return handleStartException(ctx, exid);
    if (excAct[2] === "resolve") return handleResolveException(ctx, exid);
    if (excAct[2] === "close") return handleCloseException(ctx, exid);
  }

  return apiError("NOT_FOUND", "Not found", ctx.requestId);
}
