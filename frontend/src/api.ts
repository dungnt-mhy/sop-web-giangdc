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
  createUser(input: {
    username: string;
    display_name: string;
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
};

/** true nếu ApiError là lỗi chưa đăng nhập. */
export function isUnauthenticated(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}
