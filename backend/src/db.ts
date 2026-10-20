// db.ts — helper dùng chung cho D1 (Task 1.2).
// D1 dùng SQLite: thời gian lưu dạng TEXT ISO 8601 UTC, boolean lưu INTEGER 0/1.

/** UUID v4 cho id các bảng. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Thời điểm hiện tại, ISO 8601 UTC. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Cộng mili-giây vào một mốc ISO, trả về ISO mới. */
export function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  status: string;
  position: string | null;
  position_id: string | null;
  org_unit_id: string | null;
  phone: string | null;
  password_changed_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface CredentialRow {
  id: string;
  user_id: string;
  password_hash: string;
  password_salt: string;
  hash_algorithm: string;
  hash_params: string;
  must_change_password: number;
  rotated_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  session_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  device_summary: string | null;
}

/** Chuẩn hoá tên đăng nhập: trim + lowercase (SPEC §11: username chuẩn hoá và unique). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function getUserByUsername(
  db: D1Database,
  username: string
): Promise<UserRow | null> {
  return db
    .prepare("SELECT * FROM users WHERE username = ?")
    .bind(username)
    .first<UserRow>();
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function getCredential(
  db: D1Database,
  userId: string
): Promise<CredentialRow | null> {
  return db
    .prepare("SELECT * FROM local_credentials WHERE user_id = ?")
    .bind(userId)
    .first<CredentialRow>();
}

export async function getUserRoles(db: D1Database, userId: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role")
    .bind(userId)
    .all<{ role: string }>();
  return (res.results ?? []).map((r) => r.role);
}

/** Lấy quyền của user từ DB qua bảng roles/role_permissions. */
export async function getPermissionsForRoles(
  db: D1Database,
  roles: string[]
): Promise<string[]> {
  if (roles.length === 0) return [];
  const placeholders = roles.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT DISTINCT rp.permission
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE r.code IN (${placeholders})`
    )
    .bind(...roles)
    .all<{ permission: string }>();
  return (rows.results ?? []).map((r) => r.permission).sort();
}

/** Ghi audit event. Không bao giờ ném lỗi ra ngoài (audit không được làm hỏng nghiệp vụ). */
export async function audit(
  db: D1Database,
  event: {
    event_type: string;
    actor_id?: string | null;
    object_type?: string | null;
    object_id?: string | null;
    request_id?: string | null;
    diff?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_events (id, event_type, actor_id, object_type, object_id, occurred_at, request_id, diff_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId(),
        event.event_type,
        event.actor_id ?? null,
        event.object_type ?? null,
        event.object_id ?? null,
        nowIso(),
        event.request_id ?? null,
        event.diff ? JSON.stringify(event.diff) : null
      )
      .run();
  } catch (e) {
    // Ghi log server, không chặn request (SPEC ADM-002: audit best-effort ở tầng này;
    // alert khi audit write thất bại thuộc runbook vận hành, ngoài phạm vi Task 1.2).
    console.error("[audit] ghi audit thất bại:", event.event_type, e);
  }
}
