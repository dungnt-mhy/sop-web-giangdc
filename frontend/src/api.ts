// api.ts — client gọi API backend (Task 1.2).
// Xác thực bằng cookie phiên (HttpOnly) nên mọi request dùng credentials: "include".
// Thông tin user chỉ giữ trong bộ nhớ, KHÔNG lưu localStorage (ONB-006).

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  status: string;
}

export interface SessionInfo {
  user: SessionUser;
  roles: string[];
  permissions: string[];
  must_change_password: boolean;
  session: { expires_at: string };
}

export interface PublicUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  status: string;
  position: string | null;
  position_id: string | null;
  position_name: string | null;
  roles: string[];
  permissions: string[];
  must_change_password: boolean;
  locked_until: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

// --- Quy trình (Task 1.4) ---
export interface SopProcess {
  id: string;
  code: string;
  name: string;
  purpose: string | null;
  scope: string | null;
  applicable_objects: string | null;
  start_condition: string | null;
  end_condition: string | null;
  owner_id: string | null;
  applying_unit: string | null;
  review_trigger: string | null;
  group_name: string | null;
  created_at: string;
  updated_at: string | null;
  active_version: { id: string; version_number: number; status: string } | null;
}

export interface ProcessVersion {
  id: string;
  process_id: string;
  version_number: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  change_summary: string | null;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
}

export interface SopProcessDetail extends SopProcess {
  versions: ProcessVersion[];
}

// --- Lượt thực hiện (Task 1.6) ---
export interface Execution {
  id: string;
  code: string;
  process_id: string;
  version_id: string;
  title: string | null;
  status: string;
  assignee_id: string | null;
  assignee_name?: string | null;
  creator_name?: string | null;
  due_at: string | null;
  execution_date: string | null;
  execution_time: string | null;
  shift: string | null;
  supervisor_id: string | null;
  supervisor_name?: string | null;
  cancel_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  process_name: string | null;
  progress: { total: number; done: number } | null;
}

export interface ExecutionStep {
  id: string;
  execution_id: string;
  sort_order: number;
  code: string;
  title: string;
  instruction: string | null;
  role: string | null;
  is_required: boolean;
  completion_req: string | null;
  status: string;
  completed_by: string | null;
  completed_at: string | null;
  note: string | null;
  skip_reason: string | null;
}

export interface Evidence {
  id: string;
  execution_step_id: string;
  uploaded_by: string;
  uploader_name: string | null;
  kind: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  status: string;
  note: string | null;
  created_at: string;
}

export interface StepResource {
  id: string;
  step_id: string;
  kind: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export interface AppException {
  id: string;
  execution_id: string;
  execution_step_id: string | null;
  title: string;
  description: string;
  severity: string;
  status: string;
  created_by: string;
  created_at: string;
  creator_name?: string | null;
  step_code?: string | null;
  assigned_to: string | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  close_note: string | null;
  closed_by: string | null;
  closed_at: string | null;
}

export interface ExecutionDetail extends Execution {
  process_code: string | null;
  steps: ExecutionStep[];
}

// --- Bước công việc (Task 1.5) ---
export interface ProcessStep {
  id: string;
  version_id: string;
  sort_order: number;
  code: string;
  title: string;
  prerequisite: string | null;
  input_desc: string | null;
  instruction: string | null;
  expected_result: string | null;
  output_desc: string | null;
  note: string | null;
  role: string | null;
  is_required: boolean;
  target_duration_min: number | null;
  warning: string | null;
  completion_req: Record<string, unknown> | null;
  skip_policy: Record<string, unknown> | null;
  failure_policy: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

declare global {
  interface Window {
    SOP_CONFIG?: { apiBase?: string };
  }
}

function apiBase(): string {
  const raw = (window.SOP_CONFIG?.apiBase ?? "").trim();
  return raw.replace(/\/+$/, "");
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Token giữ trong bộ nhớ (không lưu localStorage — ONB-006). Gửi qua header
  // Authorization để không phụ thuộc cookie (cookie cross-site có thể bị chặn
  // trên mobile). Khi không có token (tải lại trang), trình duyệt tự gửi cookie.
  if (authToken) headers["authorization"] = "Bearer " + authToken;
  const res = await fetch(apiBase() + "/api/v1" + path, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? "Có lỗi xảy ra. Vui lòng thử lại."
    );
  }
  return data as T;
}

/** Token phiên giữ trong bộ nhớ — xóa khi đăng xuất (ONB-006). */
let authToken: string | null = null;

export const api = {
  async login(username: string, password: string): Promise<SessionInfo> {
    const s = await req<SessionInfo & { token?: string }>("POST", "/auth/login", {
      username,
      password,
    });
    if (s.token) authToken = s.token;
    return s;
  },
  async logout(): Promise<{ ok: boolean }> {
    try {
      return await req("POST", "/auth/logout");
    } finally {
      authToken = null;
    }
  },
  session(): Promise<SessionInfo> {
    return req("GET", "/auth/session");
  },
  changePassword(current_password: string, new_password: string): Promise<{ ok: boolean }> {
    return req("POST", "/auth/change-password", { current_password, new_password });
  },
  listUsers(cursor?: string | null): Promise<{ items: PublicUser[]; next_cursor: string | null }> {
    return req("GET", "/users?limit=25" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
  },
  listActiveUsers(): Promise<{ items: { id: string; username: string; display_name: string; position: string | null; position_id: string | null; position_name: string | null }[] }> {
    return req("GET", "/users/active");
  },
  // --- Chức vụ ---
  listPositions(): Promise<{ items: { id: string; name: string; description: string | null }[]; total: number }> {
    return req("GET", "/positions");
  },
  createPosition(input: { name: string; description?: string }): Promise<{ id: string; name: string }> {
    return req("POST", "/positions", input);
  },
  updatePosition(id: string, input: { name?: string; description?: string }): Promise<{ id: string; name: string }> {
    return req("PATCH", `/positions/${encodeURIComponent(id)}`, input);
  },
  deletePosition(id: string): Promise<{ deleted: boolean }> {
    return req("DELETE", `/positions/${encodeURIComponent(id)}`);
  },
  // --- Đơn vị tổ chức ---
  listOrgUnits(): Promise<{
    items: { id: string; code: string | null; name: string; type: string; type_label: string; parent_id: string | null; parent_name: string | null; description: string | null; address: string | null; phone: string | null; email: string | null; manager_id: string | null; manager_name: string | null; status: string; status_label: string; created_at: string }[];
    total: number;
  }> {
    return req("GET", "/org-units");
  },
  createOrgUnit(input: { name: string; code?: string; type: string; parent_id?: string | null; description?: string; address?: string; phone?: string; email?: string; manager_id?: string | null; status?: string }): Promise<unknown> {
    return req("POST", "/org-units", input);
  },
  updateOrgUnit(id: string, input: { name?: string; code?: string; type?: string; parent_id?: string | null; description?: string; address?: string; phone?: string; email?: string; manager_id?: string | null; status?: string }): Promise<unknown> {
    return req("PATCH", `/org-units/${encodeURIComponent(id)}`, input);
  },
  deleteOrgUnit(id: string): Promise<{ deleted: boolean }> {
    return req("DELETE", `/org-units/${encodeURIComponent(id)}`);
  },
  // --- Vai trò ứng dụng ---
  listRoles(): Promise<{
    items: { id: string; code: string; name: string; description: string | null; is_system: boolean; permissions: string[] }[];
    total: number;
    catalog: { code: string; label: string; group: string }[];
  }> {
    return req("GET", "/roles");
  },
  createRole(input: { name: string; description?: string; permissions: string[] }): Promise<unknown> {
    return req("POST", "/roles", input);
  },
  updateRole(id: string, input: { name?: string; description?: string; permissions?: string[] }): Promise<unknown> {
    return req("PATCH", `/roles/${encodeURIComponent(id)}`, input);
  },
  deleteRole(id: string): Promise<{ deleted: boolean }> {
    return req("DELETE", `/roles/${encodeURIComponent(id)}`);
  },
  createUser(input: {
    username: string;
    display_name: string;
    position?: string;
    position_id?: string;
    email?: string;
    password: string;
    roles: string[];
  }): Promise<PublicUser> {
    return req("POST", "/users", input);
  },
  patchUser(id: string, input: Record<string, unknown>): Promise<PublicUser> {
    return req("PATCH", "/users/" + encodeURIComponent(id), input);
  },
  lockUser(id: string): Promise<PublicUser> {
    return req("POST", `/users/${encodeURIComponent(id)}:lock`);
  },
  unlockUser(id: string): Promise<PublicUser> {
    return req("POST", `/users/${encodeURIComponent(id)}:unlock`);
  },
  forcePasswordChange(id: string): Promise<PublicUser> {
    return req("POST", `/users/${encodeURIComponent(id)}:force-password-change`);
  },
  deleteUser(id: string): Promise<{ deleted: boolean; id: string }> {
    return req("DELETE", "/users/" + encodeURIComponent(id));
  },
  resetPassword(id: string, password: string): Promise<PublicUser> {
    return req("POST", `/users/${encodeURIComponent(id)}:reset-password`, { password });
  },
  // --- Quy trình (Task 1.4) ---
  listProcesses(params?: { q?: string; group?: string }): Promise<{ items: SopProcess[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.group) qs.set("group", params.group);
    const suffix = qs.toString() ? "?" + qs.toString() : "";
    return req("GET", "/processes" + suffix);
  },
  createProcess(input: Record<string, unknown>): Promise<SopProcess> {
    return req("POST", "/processes", input);
  },
  getProcess(id: string): Promise<SopProcessDetail> {
    return req("GET", "/processes/" + encodeURIComponent(id));
  },
  patchProcess(id: string, input: Record<string, unknown>): Promise<SopProcess> {
    return req("PATCH", "/processes/" + encodeURIComponent(id), input);
  },
  createVersion(processId: string, change_summary?: string): Promise<ProcessVersion> {
    return req("POST", `/processes/${encodeURIComponent(processId)}/versions`, { change_summary });
  },
  submitVersion(versionId: string): Promise<ProcessVersion> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}:submit`);
  },
  approveVersion(versionId: string, effective_from?: string): Promise<ProcessVersion> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}:approve`, { effective_from });
  },
  returnVersion(versionId: string): Promise<ProcessVersion> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}:return`);
  },
  activateVersion(versionId: string): Promise<ProcessVersion> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}:activate`);
  },
  retireVersion(versionId: string): Promise<ProcessVersion> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}:retire`);
  },
  // --- Bước công việc (Task 1.5) ---
  listSteps(versionId: string): Promise<{ items: ProcessStep[]; total: number }> {
    return req("GET", `/processes/x/versions/${encodeURIComponent(versionId)}/steps`);
  },
  createStep(versionId: string, input: Record<string, unknown>): Promise<ProcessStep> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}/steps`, input);
  },
  patchStep(versionId: string, stepId: string, input: Record<string, unknown>): Promise<ProcessStep> {
    return req("PATCH", `/processes/x/versions/${encodeURIComponent(versionId)}/steps/${encodeURIComponent(stepId)}`, input);
  },
  deleteStep(versionId: string, stepId: string): Promise<{ deleted: boolean; id: string }> {
    return req("DELETE", `/processes/x/versions/${encodeURIComponent(versionId)}/steps/${encodeURIComponent(stepId)}`);
  },
  reorderSteps(versionId: string, stepIds: string[]): Promise<{ items: ProcessStep[] }> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}/steps:reorder`, { step_ids: stepIds });
  },
  copyStep(versionId: string, stepId: string): Promise<ProcessStep> {
    return req("POST", `/processes/x/versions/${encodeURIComponent(versionId)}/steps/${encodeURIComponent(stepId)}:copy`);
  },
  validateVersion(versionId: string): Promise<{ valid: boolean; errors: Array<{ step_id: string | null; step_code: string | null; field: string; message: string }> }> {
    return req("GET", `/processes/x/versions/${encodeURIComponent(versionId)}:validate`);
  },
  // --- Lượt thực hiện (Task 1.6) ---
  listExecutions(params?: { mine?: boolean; status?: string }): Promise<{ items: Execution[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.mine) qs.set("mine", "1");
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? "?" + qs.toString() : "";
    return req("GET", "/executions" + suffix);
  },
  createExecution(input: { process_id: string; title?: string; assignee_id?: string; supervisor_id?: string; due_at?: string; execution_date: string; execution_time?: string; shift?: string }): Promise<Execution> {
    return req("POST", "/executions", input);
  },
  getExecution(id: string): Promise<ExecutionDetail> {
    return req("GET", "/executions/" + encodeURIComponent(id));
  },
  startExecution(id: string): Promise<Execution> {
    return req("POST", `/executions/${encodeURIComponent(id)}:start`);
  },
  pauseExecution(id: string): Promise<Execution> {
    return req("POST", `/executions/${encodeURIComponent(id)}:pause`);
  },
  resumeExecution(id: string): Promise<Execution> {
    return req("POST", `/executions/${encodeURIComponent(id)}:resume`);
  },
  cancelExecution(id: string, cancel_reason: string): Promise<Execution> {
    return req("POST", `/executions/${encodeURIComponent(id)}:cancel`, { cancel_reason });
  },
  completeExecution(id: string): Promise<Execution> {
    return req("POST", `/executions/${encodeURIComponent(id)}:complete`);
  },
  startStep(execId: string, stepId: string): Promise<ExecutionStep> {
    return req("POST", `/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepId)}:start`);
  },
  completeStep(execId: string, stepId: string, note?: string): Promise<ExecutionStep> {
    return req("POST", `/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepId)}:complete`, { note });
  },
  skipStep(execId: string, stepId: string, skip_reason: string): Promise<ExecutionStep> {
    return req("POST", `/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepId)}:skip`, { skip_reason });
  },

  // --- Bằng chứng (Task 1.7: EVD-001..013) ---
  listEvidence(execId: string, stepId: string): Promise<{ items: Evidence[]; total: number }> {
    return req("GET", `/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepId)}/evidence`);
  },
  async uploadEvidence(execId: string, stepId: string, file: File, note?: string): Promise<Evidence> {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (note) fd.append("note", note);
    const res = await fetch(`${apiBase()}/api/v1/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepId)}/evidence`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.error?.message ?? `Lỗi tải lên (${res.status})`, data?.error);
    }
    return res.json();
  },
  deleteEvidence(evidenceId: string): Promise<{ deleted: boolean }> {
    return req("DELETE", `/evidence/${encodeURIComponent(evidenceId)}`);
  },
  evidenceDownloadUrl(evidenceId: string): string {
    return `${apiBase()}/api/v1/evidence/${encodeURIComponent(evidenceId)}/download`;
  },

  // --- Tài nguyên hướng dẫn bước (EVD-011) ---
  listStepResources(versionId: string, stepId: string): Promise<{ items: StepResource[]; total: number }> {
    return req("GET", `/processes/x/versions/${encodeURIComponent(versionId)}/steps/${encodeURIComponent(stepId)}/resources`);
  },
  async uploadStepResource(versionId: string, stepId: string, file: File, caption?: string): Promise<StepResource> {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (caption) fd.append("caption", caption);
    const res = await fetch(`${apiBase()}/api/v1/processes/x/versions/${encodeURIComponent(versionId)}/steps/${encodeURIComponent(stepId)}/resources`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.error?.message ?? `Lỗi tải lên (${res.status})`, data?.error);
    }
    return res.json();
  },
  deleteStepResource(resourceId: string): Promise<{ deleted: boolean }> {
    return req("DELETE", `/step-resources/${encodeURIComponent(resourceId)}`);
  },
  stepResourceDownloadUrl(resourceId: string): string {
    return `${apiBase()}/api/v1/step-resources/${encodeURIComponent(resourceId)}/download`;
  },

  // --- Dashboard (Task 1.8: §9.6) ---
  dashboardSummary(params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return req("GET", `/dashboard/summary${q ? "?" + q : ""}`);
  },
  dashboardOverview(params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return req("GET", `/dashboard/overview${q ? "?" + q : ""}`);
  },
  dashboardDaily(params: Record<string, string>): Promise<{
    from: string; to: string;
    days: { date: string; created: number; completed: number; exc_opened: number; exc_closed: number; evidence: number }[];
    totals: { created: number; completed: number; exc_opened: number; exc_closed: number; evidence: number };
  }> {
    const q = new URLSearchParams(params).toString();
    return req("GET", `/dashboard/daily${q ? "?" + q : ""}`);
  },
  dashboardExecutions(params: Record<string, string>): Promise<{ items: any[]; total: number }> {
    const q = new URLSearchParams(params).toString();
    return req("GET", `/dashboard/executions${q ? "?" + q : ""}`);
  },
  dashboardExportUrl(query: string): string {
    return `${apiBase()}/api/v1/dashboard/export.csv${query ? "?" + query : ""}`;
  },

  // --- Ngoại lệ (SPEC §9.5) ---
  listExceptions(execId: string): Promise<{ items: AppException[]; total: number }> {
    return req("GET", `/executions/${encodeURIComponent(execId)}/exceptions`);
  },
  createException(execId: string, input: { title: string; description: string; severity?: string; execution_step_id?: string }): Promise<AppException> {
    return req("POST", `/executions/${encodeURIComponent(execId)}/exceptions`, input);
  },
  startException(exceptionId: string): Promise<AppException> {
    return req("POST", `/exceptions/${encodeURIComponent(exceptionId)}:start`, {});
  },
  resolveException(exceptionId: string, resolution: string): Promise<AppException> {
    return req("POST", `/exceptions/${encodeURIComponent(exceptionId)}:resolve`, { resolution });
  },
  closeException(exceptionId: string, close_note?: string): Promise<AppException> {
    return req("POST", `/exceptions/${encodeURIComponent(exceptionId)}:close`, { close_note });
  },
  listAllExceptions(query: string): Promise<{ items: AppException[]; total: number }> {
    return req("GET", `/exceptions${query ? "?" + query : ""}`);
  },
  listAllEvidence(query: string): Promise<{ items: Record<string, unknown>[]; total: number }> {
    return req("GET", `/evidence${query ? "?" + query : ""}`);
  },
  listStepAssignees(execId: string, stepId: string): Promise<{ items: { id: string; username: string; display_name: string; position: string | null }[] }> {
    return req("GET", `/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepId)}/assignees`);
  },
  setStepAssignees(execId: string, stepId: string, user_ids: string[]): Promise<{ assigned: number }> {
    return req("PUT", `/executions/${encodeURIComponent(execId)}/steps/${encodeURIComponent(stepId)}/assignees`, { user_ids });
  },
};

/** true nếu ApiError là lỗi chưa đăng nhập. */
export function isUnauthenticated(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}
