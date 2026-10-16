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
};

/** true nếu ApiError là lỗi chưa đăng nhập. */
export function isUnauthenticated(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}
