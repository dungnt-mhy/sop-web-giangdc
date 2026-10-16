// routes/context.ts — ngữ cảnh request dùng chung cho các handler.

import type { Env } from "../types";
import { apiError } from "../errors";
import { loadSession, type SessionInfo } from "./auth";

export class Ctx {
  request: Request;
  env: Env;
  requestId: string;
  isHttps: boolean;
  allowedOrigins: string[];
  session: SessionInfo | null = null;
  private sessionLoaded = false;

  constructor(request: Request, env: Env, requestId: string) {
    this.request = request;
    this.env = env;
    this.requestId = requestId;
    const url = new URL(request.url);
    this.isHttps = url.protocol === "https:";
    const raw = (env.ALLOWED_ORIGINS ?? "").trim();
    this.allowedOrigins = raw
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    // Luôn cho phép chính origin của API (trường hợp same-origin).
    this.allowedOrigins.push(url.origin);
  }

  /** Nạp phiên (lazy, 1 lần/request). */
  async loadSession(): Promise<SessionInfo | null> {
    if (!this.sessionLoaded) {
      this.sessionLoaded = true;
      this.session = await loadSession(this);
    }
    return this.session;
  }

  /** Đòi đăng nhập; trả Response 401 nếu chưa có phiên hợp lệ. */
  requireAuth(): SessionInfo | Response {
    if (!this.session) {
      return apiError("UNAUTHENTICATED", "Vui lòng đăng nhập để tiếp tục.", this.requestId);
    }
    return this.session;
  }
}
