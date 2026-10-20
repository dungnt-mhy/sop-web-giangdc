// scope.ts — xác định phạm vi xem dữ liệu (data scope) theo vai trò + đơn vị.
// 3 tầng:
// - "all": admin (quyền "*") → xem toàn bộ.
// - "unit": giám sát / phê duyệt / chủ quy trình → xem dữ liệu của đơn vị mình + cấp dưới.
// - "self": nhân viên và các vai trò còn lại → chỉ xem dữ liệu cá nhân.

import type { SessionInfo } from "./routes/auth";

export type ViewScope = {
  level: "all" | "unit" | "self";
  userId: string;
  orgUnitId: string | null;
  unitIds: string[]; // đơn vị mình + cấp dưới (chỉ có ý nghĩa khi level = "unit")
};

const UNIT_ROLES = new Set(["monitor", "approver", "process_owner"]);

/** Vai trò của user quyết định tầng phạm vi xem. */
export function scopeLevel(me: SessionInfo): "all" | "unit" | "self" {
  if (me.permissions.includes("*")) return "all";
  if (me.roles.some((r) => UNIT_ROLES.has(r))) return "unit";
  return "self";
}

/** Đơn vị + tất cả đơn vị con (BFS, tối đa 200). */
export async function unitDescendants(db: D1Database, unitId: string | null): Promise<string[]> {
  if (!unitId) return [];
  const out: string[] = [unitId];
  const queue: string[] = [unitId];
  while (queue.length > 0 && out.length < 200) {
    const cur = queue.shift()!;
    const rows = await db
      .prepare(`SELECT id FROM org_units WHERE parent_id = ?`)
      .bind(cur)
      .all<{ id: string }>();
    for (const r of rows.results) {
      if (!out.includes(r.id)) {
        out.push(r.id);
        queue.push(r.id);
      }
    }
  }
  return out;
}

/** Đơn vị + tất cả đơn vị cha lên đến cấp công ty (tối đa 10 cấp). */
export async function unitAncestors(db: D1Database, unitId: string | null): Promise<string[]> {
  if (!unitId) return [];
  const out: string[] = [unitId];
  let cur: string | null = unitId;
  for (let i = 0; i < 10 && cur; i++) {
    const row: { parent_id: string | null } | null = await db
      .prepare(`SELECT parent_id FROM org_units WHERE id = ?`)
      .bind(cur)
      .first<{ parent_id: string | null }>();
    if (row?.parent_id) {
      out.push(row.parent_id);
      cur = row.parent_id;
    } else {
      break;
    }
  }
  return out;
}

/** Tính phạm vi xem đầy đủ của user hiện tại. */
export async function getViewScope(db: D1Database, me: SessionInfo): Promise<ViewScope> {
  const level = scopeLevel(me);
  const orgUnitId = me.user.org_unit_id ?? null;
  const unitIds = level === "unit" ? await unitDescendants(db, orgUnitId) : [];
  return { level, userId: me.user.id, orgUnitId, unitIds };
}

/**
 * Điều kiện SQL (không kèm WHERE/AND) kiểm tra 1 lượt có thuộc phạm vi không.
 * `alias` là alias của bảng executions trong query hiện tại.
 * Trả về cond = "" khi level = "all" (không lọc).
 */
export function executionScopeFragment(
  scope: ViewScope,
  alias = "e"
): { cond: string; binds: unknown[] } {
  if (scope.level === "all") return { cond: "", binds: [] };
  if (scope.level === "unit") {
    if (scope.unitIds.length === 0) return { cond: "1=0", binds: [] };
    const ph = scope.unitIds.map(() => "?").join(",");
    return {
      cond: `EXISTS (SELECT 1 FROM users __au WHERE __au.id = ${alias}.assignee_id AND __au.org_unit_id IN (${ph}))`,
      binds: [...scope.unitIds],
    };
  }
  return {
    cond: `(${alias}.assignee_id = ? OR ${alias}.created_by = ? OR EXISTS (SELECT 1 FROM execution_approvers __ea WHERE __ea.execution_id = ${alias}.id AND __ea.user_id = ?))`,
    binds: [scope.userId, scope.userId, scope.userId],
  };
}

/**
 * Điều kiện SQL kiểm tra 1 execution_id (biểu thức SQL) có thuộc phạm vi không.
 * Dùng cho các bảng liên kết (exceptions, evidence...) không JOIN trực tiếp executions.
 * Trả về cond = "1=1" khi level = "all".
 */
export function execIdScopeFragment(
  scope: ViewScope,
  execIdExpr: string
): { cond: string; binds: unknown[] } {
  if (scope.level === "all") return { cond: "1=1", binds: [] };
  if (scope.level === "unit") {
    if (scope.unitIds.length === 0) return { cond: "1=0", binds: [] };
    const ph = scope.unitIds.map(() => "?").join(",");
    return {
      cond: `EXISTS (SELECT 1 FROM executions __sx JOIN users __sau ON __sau.id = __sx.assignee_id WHERE __sx.id = ${execIdExpr} AND __sau.org_unit_id IN (${ph}))`,
      binds: [...scope.unitIds],
    };
  }
  return {
    cond: `EXISTS (SELECT 1 FROM executions __sx WHERE __sx.id = ${execIdExpr} AND (__sx.assignee_id = ? OR __sx.created_by = ? OR EXISTS (SELECT 1 FROM execution_approvers __ea2 WHERE __ea2.execution_id = __sx.id AND __ea2.user_id = ?)))`,
    binds: [scope.userId, scope.userId, scope.userId],
  };
}
