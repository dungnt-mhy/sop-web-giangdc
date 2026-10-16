// auth.ts — băm mật khẩu, token phiên, cookie (Task 1.2).
//
// BẢO MẬT (ghi vào DECISIONS.md D-10):
// - PBKDF2-HMAC-SHA256 qua WebCrypto (crypto.subtle), KHÔNG dùng thư viện ngoài.
// - Salt 16 byte ngẫu nhiên RIÊNG MỖI USER; 100.000 vòng; derived key 32 byte.
//   100k (thay vì 600k theo khuyến nghị OWASP cho server vật lý) là cân bằng có chủ ý
//   cho Cloudflare Workers free (giới hạn CPU/isolate): vẫn đủ mạnh ở MVP vì mỗi user
//   có salt riêng + lockout sau 5 lần sai. `hash_params` lưu số vòng nên có thể tăng
//   dần về sau (rehash khi user đăng nhập lại).
// - Token phiên 32 byte ngẫu nhiên; server CHỈ lưu SHA-256 của token (cột session_hash)
//   nên lộ DB cũng không dùng được phiên đang sống.
// - Cookie: HttpOnly, Path=/, Secure + SameSite=None khi qua HTTPS (demo workers.dev,
//   cần None vì frontend pages.dev khác site với API); SameSite=Lax khi HTTP (dev local
//   cùng hostname localhost). Không lưu token vào localStorage.

import { addMs, nowIso } from "./db";

export const COOKIE_NAME = "sop_session";

/** Tham số băm mật khẩu — phải khớp scripts/gen-seed-hash.mjs và migration 0003. */
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_SALT_LEN = 16;
export const PBKDF2_KEY_LEN = 32;

/** Phiên: trượt 12 giờ mỗi lần dùng; tối đa tuyệt đối 7 ngày rồi bắt đăng nhập lại.
 *  (DEFAULT chờ OPEN-AUTH-POLICY-01 chốt ở UAT.) */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** Khoá tạm sau 5 lần đăng nhập sai liên tiếp, mỗi lần 15 phút (DEFAULT). */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

/** Giới hạn chống brute-force theo IP (best-effort, lưu trong bộ nhớ isolate). */
export const IP_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
export const IP_THROTTLE_MAX = 20;

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function b64decode(b64: string): Uint8Array {
  const s = atob(b64);
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}

export function b64url(bytes: Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    PBKDF2_KEY_LEN * 8
  );
  return new Uint8Array(bits);
}

/** Băm mật khẩu mới: sinh salt ngẫu nhiên, trả về salt+hash base64. */
export async function hashPassword(password: string): Promise<{
  saltB64: string;
  hashB64: string;
  algorithm: string;
  params: string;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_LEN));
  const dk = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return {
    saltB64: b64encode(salt),
    hashB64: b64encode(dk),
    algorithm: "PBKDF2-SHA256",
    params: JSON.stringify({
      iterations: PBKDF2_ITERATIONS,
      salt_len: PBKDF2_SALT_LEN,
      key_len: PBKDF2_KEY_LEN,
    }),
  };
}

/** So sánh mảng byte trong thời gian hằng số (chống timing attack). */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Kiểm tra mật khẩu với salt/hash/params đã lưu. */
export async function verifyPassword(
  password: string,
  saltB64: string,
  hashB64: string,
  paramsJson: string
): Promise<boolean> {
  try {
    const params = JSON.parse(paramsJson) as { iterations?: number };
    const iterations =
      typeof params.iterations === "number" && params.iterations > 0
        ? params.iterations
        : PBKDF2_ITERATIONS;
    const salt = b64decode(saltB64);
    const expected = b64decode(hashB64);
    const dk = await pbkdf2(password, salt, iterations);
    return constantTimeEqual(dk, expected);
  } catch {
    return false;
  }
}

/** Hash một lần cho mật khẩu sai khi user không tồn tại — cân bằng thời gian phản hồi
 *  để kẻ tấn công không đoán được tài khoản có tồn tại qua timing (ONB-003). */
const DUMMY_SALT_B64 = "AAAAAAAAAAAAAAAAAAAAAA==";
const DUMMY_HASH_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const DUMMY_PARAMS = JSON.stringify({
  iterations: PBKDF2_ITERATIONS,
  salt_len: PBKDF2_SALT_LEN,
  key_len: PBKDF2_KEY_LEN,
});
export function verifyDummy(password: string): Promise<boolean> {
  return verifyPassword(password, DUMMY_SALT_B64, DUMMY_HASH_B64, DUMMY_PARAMS);
}

/** Sinh token phiên ngẫu nhiên 32 byte (base64url). */
export function newSessionToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 hex của token — giá trị duy nhất được lưu trong DB. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Đọc token phiên từ cookie hoặc header Authorization: Bearer. */
export function getRequestToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const idx = part.indexOf("=");
      if (idx > 0 && part.slice(0, idx).trim() === COOKIE_NAME) {
        const v = part.slice(idx + 1).trim();
        if (v) return decodeURIComponent(v);
      }
    }
  }
  return null;
}

/** Ghi Set-Cookie phiên vào response. */
export function setSessionCookie(res: Response, token: string, isHttps: boolean): void {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    isHttps ? "Secure; SameSite=None" : "SameSite=Lax",
  ];
  res.headers.append("Set-Cookie", attrs.join("; "));
}

/** Xoá cookie phiên (đăng xuất). */
export function clearSessionCookie(res: Response, isHttps: boolean): void {
  const attrs = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    isHttps ? "Secure; SameSite=None" : "SameSite=Lax",
  ];
  res.headers.append("Set-Cookie", attrs.join("; "));
}

/** Hạn dùng mới cho phiên đang hoạt động (trượt 12h). */
export function refreshedExpiry(): string {
  return addMs(nowIso(), SESSION_TTL_MS);
}

/** Rút gọn user-agent làm device_summary (tối đa 120 ký tự, bỏ ký tự điều khiển). */
export function deviceSummary(request: Request): string | null {
  const ua = request.headers.get("user-agent");
  if (!ua) return null;
  return ua.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 120) || null;
}

// ---- Giới hạn theo IP (best-effort, bộ nhớ của isolate) ----
const ipHits = new Map<string, number[]>();

/** Trả về true nếu IP đã vượt ngưỡng trong cửa sổ; ngược lại ghi nhận 1 lượt. */
export function ipThrottleExceeded(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - IP_THROTTLE_WINDOW_MS;
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > windowStart);
  if (hits.length >= IP_THROTTLE_MAX) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  // Dọn nhẹ để map không phình vô hạn.
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      if (v.length === 0 || v[v.length - 1] <= windowStart) ipHits.delete(k);
    }
  }
  return false;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
