// routes/dashboard.ts — Dashboard KPI và báo cáo (SPEC §9.6).
// Công thức chuẩn:
//   completion_rate = completed_required_steps / total_required_steps
//   on_time_rate = executions_completed_on_or_before_due / completed_executions_with_due_date
//   evidence_completeness = satisfied_required_evidence / required_evidence
//   right_first_time = executions_without_rework_or_blocking_exception / eligible_completed_executions
//   cycle_time = completed_at - started_at (median và P95)

import { apiError, ok } from "../errors";
import { requirePermission, type SessionInfo } from "./auth";
import { getViewScope, executionScopeFragment, execIdScopeFragment, type ViewScope } from "../scope";
import type { Ctx } from "./context";

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return Math.round((n / d) * 1000) / 10;
}

function median(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function p95(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1);
  return s[idx];
}

/** GET /dashboard/summary — KPI tổng quan. Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&process_id=uuid */
export async function handleDashboardSummary(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);

  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const processId = url.searchParams.get("process_id");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (processId) { conds.push(`e.process_id = ?`); params.push(processId); }
  const __sf = executionScopeFragment(__scope, "e");
  if (__sf.cond) { conds.push(__sf.cond); params.push(...__sf.binds); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  // Tổng lượt theo trạng thái.
  const execStats = await db
    .prepare(
      `SELECT e.status, COUNT(*) as cnt FROM executions e ${where} GROUP BY e.status`
    )
    .bind(...params)
    .all<{ status: string; cnt: number }>();
  const byStatus: Record<string, number> = {};
  for (const r of execStats.results ?? []) byStatus[r.status] = r.cnt;
  const totalExec = Object.values(byStatus).reduce((a, b) => a + b, 0);

  // completion_rate: bước bắt buộc đã PASSED / tổng bước bắt buộc (trong các lượt đã xong).
  const compRate = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN es.status = 'PASSED' AND es.is_required = 1 THEN 1 ELSE 0 END) as done,
         SUM(CASE WHEN es.is_required = 1 THEN 1 ELSE 0 END) as total
       FROM execution_steps es JOIN executions e ON e.id = es.execution_id
       ${where} AND e.status = 'COMPLETED'`
    )
    .bind(...params)
    .first<{ done: number; total: number }>();

  // on_time_rate: lượt hoàn thành đúng/trước hạn / lượt hoàn thành có hạn.
  const onTime = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN e.completed_at <= e.due_at THEN 1 ELSE 0 END) as ontime,
         COUNT(*) as total
       FROM executions e ${where ? where + " AND" : "WHERE"} e.status = 'COMPLETED' AND e.due_at IS NOT NULL`
    )
    .bind(...params)
    .first<{ ontime: number; total: number }>();

  // evidence_completeness: bước có đủ ảnh yêu cầu / bước có yêu cầu ảnh.
  // (MVP: đếm bước có min_photos > 0 trong completion_req.)
  const evComp = await db
    .prepare(
      `SELECT es.id, es.completion_req,
         (SELECT COUNT(*) FROM evidence ev WHERE ev.execution_step_id = es.id AND ev.status = 'VERIFIED') as ev_count
       FROM execution_steps es JOIN executions e ON e.id = es.execution_id
       ${where} AND e.status IN ('IN_PROGRESS','COMPLETED')`
    )
    .bind(...params)
    .all<{ id: string; completion_req: string | null; ev_count: number }>();
  let evRequired = 0, evSatisfied = 0;
  for (const r of evComp.results ?? []) {
    try {
      const cr = r.completion_req ? JSON.parse(r.completion_req) : null;
      const minP = cr?.min_photos ?? (cr?.require_photo ? 1 : 0);
      if (minP > 0) {
        evRequired++;
        if (r.ev_count >= minP) evSatisfied++;
      }
    } catch { /* bỏ qua */ }
  }

  // cycle_time: median và P95 (giờ).
  const cycles = await db
    .prepare(
      `SELECT (julianday(e.completed_at) - julianday(e.started_at)) * 24 as hours
       FROM executions e ${where ? where + " AND" : "WHERE"} e.status = 'COMPLETED' AND e.started_at IS NOT NULL AND e.completed_at IS NOT NULL`
    )
    .bind(...params)
    .all<{ hours: number }>();
  const cycleHours = (cycles.results ?? []).map((r) => r.hours).filter((h) => h >= 0);

  return ok({
    filters: { from, to, process_id: processId },
    executions: {
      total: totalExec,
      by_status: byStatus,
    },
    kpis: {
      completion_rate: pct(compRate?.done ?? 0, compRate?.total ?? 0),
      completion_rate_detail: { done: compRate?.done ?? 0, total: compRate?.total ?? 0 },
      on_time_rate: pct(onTime?.ontime ?? 0, onTime?.total ?? 0),
      on_time_detail: { ontime: onTime?.ontime ?? 0, total: onTime?.total ?? 0 },
      evidence_completeness: pct(evSatisfied, evRequired),
      evidence_detail: { satisfied: evSatisfied, required: evRequired },
      cycle_time_hours: {
        median: median(cycleHours) !== null ? Math.round(median(cycleHours)! * 100) / 100 : null,
        p95: p95(cycleHours) !== null ? Math.round(p95(cycleHours)! * 100) / 100 : null,
        samples: cycleHours.length,
      },
    },
  });
}

/** GET /dashboard/overview — tổng quan cho dashboard chuyên nghiệp.
 *  Bao gồm: ngoại lệ, bằng chứng, lượt theo ngày, top quy trình, workload người dùng. */
export async function handleDashboardOverview(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);

  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const processId = url.searchParams.get("process_id");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (processId) { conds.push(`e.process_id = ?`); params.push(processId); }
  const __sf = executionScopeFragment(__scope, "e");
  if (__sf.cond) { conds.push(__sf.cond); params.push(...__sf.binds); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const whereAnd = conds.length > 0 ? `${where} AND` : "WHERE";

  // 1. Ngoại lệ theo trạng thái và mức độ (lọc theo phạm vi lượt liên kết).
  const __excScope = execIdScopeFragment(__scope, "exceptions.execution_id");
  const excByStatus = await db.prepare(
    `SELECT status, COUNT(*) as cnt FROM exceptions WHERE ${__excScope.cond} GROUP BY status`
  ).bind(...__excScope.binds).all<{ status: string; cnt: number }>();
  const excBySeverity = await db.prepare(
    `SELECT severity, COUNT(*) as cnt FROM exceptions WHERE status NOT IN ('RESOLVED','CLOSED') AND ${__excScope.cond} GROUP BY severity`
  ).bind(...__excScope.binds).all<{ severity: string; cnt: number }>();
  const openExc = await db.prepare(
    `SELECT COUNT(*) as cnt FROM exceptions WHERE status NOT IN ('RESOLVED','CLOSED') AND ${__excScope.cond}`
  ).bind(...__excScope.binds).first<{ cnt: number }>();

  // 2. Bằng chứng: tổng số, theo loại (lọc theo phạm vi lượt chứa bằng chứng).
  const __evScope = execIdScopeFragment(__scope, "(SELECT __es.execution_id FROM execution_steps __es WHERE __es.id = evidence.execution_step_id)");
  const evStats = await db.prepare(
    `SELECT kind, COUNT(*) as cnt FROM evidence WHERE ${__evScope.cond} GROUP BY kind`
  ).bind(...__evScope.binds).all<{ kind: string; cnt: number }>();
  const evTotal = await db.prepare(`SELECT COUNT(*) as cnt FROM evidence WHERE ${__evScope.cond}`).bind(...__evScope.binds).first<{ cnt: number }>();

  // 3. Lượt công việc theo ngày (14 ngày gần nhất).
  const byDate = await db.prepare(
    `SELECT date(e.created_at) as d, e.status, COUNT(*) as cnt
     FROM executions e ${where}
     GROUP BY d, e.status ORDER BY d DESC LIMIT 60`
  ).bind(...params).all<{ d: string; status: string; cnt: number }>();

  // 4. Top 5 quy trình theo số lượt.
  const topProcesses = await db.prepare(
    `SELECT p.name, p.code, COUNT(e.id) as cnt,
            SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) as done_cnt
     FROM executions e JOIN processes p ON p.id = e.process_id
     ${where} GROUP BY p.id ORDER BY cnt DESC LIMIT 5`
  ).bind(...params).all<{ name: string; code: string; cnt: number; done_cnt: number }>();

  // 5. Workload: top người thực hiện.
  const workload = await db.prepare(
    `SELECT u.display_name, u.username, COUNT(e.id) as total,
            SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) as done,
            SUM(CASE WHEN e.status IN ('IN_PROGRESS','PAUSED') THEN 1 ELSE 0 END) as active
     FROM executions e JOIN users u ON u.id = e.assignee_id
     ${where} GROUP BY u.id ORDER BY total DESC LIMIT 8`
  ).bind(...params).all<{ display_name: string; username: string; total: number; done: number; active: number }>();

  // 6. Người dùng hoạt động (theo phạm vi đơn vị).
  let activeUsers: { cnt: number } | null;
  if (__scope.level === "all") {
    activeUsers = await db.prepare(
      `SELECT COUNT(*) as cnt FROM users WHERE status = 'active'`
    ).first<{ cnt: number }>();
  } else if (__scope.level === "unit" && __scope.unitIds.length > 0) {
    activeUsers = await db.prepare(
      `SELECT COUNT(*) as cnt FROM users WHERE status = 'active' AND org_unit_id IN (${__scope.unitIds.map(() => "?").join(",")})`
    ).bind(...__scope.unitIds).first<{ cnt: number }>();
  } else if (__scope.level === "self") {
    activeUsers = { cnt: 1 };
  } else {
    activeUsers = { cnt: 0 };
  }

  // 7. Ngoại lệ đang mở (chi tiết 5 cái mới nhất).
  const __excListScope = execIdScopeFragment(__scope, "ex.execution_id");
  const openExcList = await db.prepare(
    `SELECT ex.id, ex.title, ex.severity, ex.status, ex.created_at, e.code as exec_code
     FROM exceptions ex LEFT JOIN executions e ON e.id = ex.execution_id
     WHERE ex.status NOT IN ('RESOLVED','CLOSED') AND ${__excListScope.cond}
     ORDER BY ex.created_at DESC LIMIT 5`
  ).bind(...__excListScope.binds).all();

  return ok({
    exceptions: {
      open: openExc?.cnt ?? 0,
      by_status: Object.fromEntries((excByStatus.results ?? []).map((r) => [r.status, r.cnt])),
      by_severity: Object.fromEntries((excBySeverity.results ?? []).map((r) => [r.severity, r.cnt])),
      recent_open: openExcList.results ?? [],
    },
    evidence: {
      total: evTotal?.cnt ?? 0,
      by_kind: Object.fromEntries((evStats.results ?? []).map((r) => [r.kind, r.cnt])),
    },
    executions_by_date: byDate.results ?? [],
    top_processes: topProcesses.results ?? [],
    workload: workload.results ?? [],
    active_users: activeUsers?.cnt ?? 0,
  });
}

/** GET /dashboard/daily — thống kê chi tiết theo từng ngày.
 *  Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (mặc định 30 ngày gần nhất).
 *  Mỗi ngày: lượt tạo mới, lượt hoàn thành, ngoại lệ mới, ngoại lệ đóng, bằng chứng tải lên. */
export async function handleDashboardDaily(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);

  const url = new URL(ctx.request.url);
  let from = url.searchParams.get("from");
  let to = url.searchParams.get("to");
  // Mặc định 30 ngày gần nhất.
  if (!to) to = new Date().toISOString().slice(0, 10);
  if (!from) {
    const d = new Date(to);
    d.setDate(d.getDate() - 29);
    from = d.toISOString().slice(0, 10);
  }

  // Chạy song song 5 query thống kê theo ngày (lọc theo phạm vi xem).
  const __sfE = executionScopeFragment(__scope, "e");
  const __excC = execIdScopeFragment(__scope, "execution_id");
  const __evC = execIdScopeFragment(__scope, "(SELECT __esx.execution_id FROM execution_steps __esx WHERE __esx.id = evidence.execution_step_id)");
  const __condE = __sfE.cond ? ` AND ${__sfE.cond}` : "";
  const [created, completed, excOpened, excClosed, evidence] = await Promise.all([
    db.prepare(
      `SELECT date(e.created_at) as d, COUNT(*) as cnt FROM executions e
       WHERE date(e.created_at) BETWEEN ? AND ?${__condE} GROUP BY d`
    ).bind(from, to, ...__sfE.binds).all<{ d: string; cnt: number }>(),
    db.prepare(
      `SELECT date(e.completed_at) as d, COUNT(*) as cnt FROM executions e
       WHERE e.status = 'COMPLETED' AND date(e.completed_at) BETWEEN ? AND ?${__condE}
       GROUP BY d`
    ).bind(from, to, ...__sfE.binds).all<{ d: string; cnt: number }>(),
    db.prepare(
      `SELECT date(created_at) as d, COUNT(*) as cnt FROM exceptions
       WHERE date(created_at) BETWEEN ? AND ? AND ${__excC.cond} GROUP BY d`
    ).bind(from, to, ...__excC.binds).all<{ d: string; cnt: number }>(),
    db.prepare(
      `SELECT date(updated_at) as d, COUNT(*) as cnt FROM exceptions
       WHERE status IN ('RESOLVED','CLOSED') AND date(updated_at) BETWEEN ? AND ? AND ${__excC.cond}
       GROUP BY d`
    ).bind(from, to, ...__excC.binds).all<{ d: string; cnt: number }>(),
    db.prepare(
      `SELECT date(created_at) as d, COUNT(*) as cnt FROM evidence
       WHERE date(created_at) BETWEEN ? AND ? AND ${__evC.cond} GROUP BY d`
    ).bind(from, to, ...__evC.binds).all<{ d: string; cnt: number }>(),
  ]);

  // Gộp theo ngày.
  const dayMap = new Map<string, { created: number; completed: number; exc_opened: number; exc_closed: number; evidence: number }>();
  const ensure = (d: string) => {
    if (!dayMap.has(d)) dayMap.set(d, { created: 0, completed: 0, exc_opened: 0, exc_closed: 0, evidence: 0 });
    return dayMap.get(d)!;
  };
  for (const r of created.results ?? []) ensure(r.d).created = r.cnt;
  for (const r of completed.results ?? []) ensure(r.d).completed = r.cnt;
  for (const r of excOpened.results ?? []) ensure(r.d).exc_opened = r.cnt;
  for (const r of excClosed.results ?? []) ensure(r.d).exc_closed = r.cnt;
  for (const r of evidence.results ?? []) ensure(r.d).evidence = r.cnt;

  // Điền đủ các ngày trong khoảng (kể cả ngày không có dữ liệu).
  const days: { date: string; created: number; completed: number; exc_opened: number; exc_closed: number; evidence: number }[] = [];
  const cur = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10);
    const v = dayMap.get(ds) ?? { created: 0, completed: 0, exc_opened: 0, exc_closed: 0, evidence: 0 };
    days.push({ date: ds, ...v });
    cur.setDate(cur.getDate() + 1);
  }

  // Tổng cộng.
  const totals = days.reduce((a, d) => ({
    created: a.created + d.created,
    completed: a.completed + d.completed,
    exc_opened: a.exc_opened + d.exc_opened,
    exc_closed: a.exc_closed + d.exc_closed,
    evidence: a.evidence + d.evidence,
  }), { created: 0, completed: 0, exc_opened: 0, exc_closed: 0, evidence: 0 });

  return ok({ from, to, days, totals });
}
export async function handleDashboardExecutions(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);

  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const processId = url.searchParams.get("process_id");
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (processId) { conds.push(`e.process_id = ?`); params.push(processId); }
  if (status) { conds.push(`e.status = ?`); params.push(status); }
  const __sf = executionScopeFragment(__scope, "e");
  if (__sf.cond) { conds.push(__sf.cond); params.push(...__sf.binds); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db
    .prepare(
      `SELECT e.id, e.code, e.title, e.status, e.created_at, e.started_at, e.completed_at, e.due_at,
              p.name as process_name, p.code as process_code,
              u.display_name as assignee_name,
              (SELECT COUNT(*) FROM execution_steps es WHERE es.execution_id = e.id AND es.status = 'PASSED') as steps_done,
              (SELECT COUNT(*) FROM execution_steps es WHERE es.execution_id = e.id) as steps_total
       FROM executions e
       LEFT JOIN processes p ON p.id = e.process_id
       LEFT JOIN users u ON u.id = e.assignee_id
       ${where}
       ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all();
  const total = await db
    .prepare(`SELECT COUNT(*) as cnt FROM executions e ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();

  return ok({ items: rows.results ?? [], total: total?.cnt ?? 0, limit, offset });
}

/** GET /dashboard/export.csv — xuất CSV danh sách lượt. */
export async function handleDashboardExportCsv(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);

  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const processId = url.searchParams.get("process_id");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (processId) { conds.push(`e.process_id = ?`); params.push(processId); }
  const __sf = executionScopeFragment(__scope, "e");
  if (__sf.cond) { conds.push(__sf.cond); params.push(...__sf.binds); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db
    .prepare(
      `SELECT e.code, e.title, e.status, e.created_at, e.started_at, e.completed_at, e.due_at,
              p.name as process_name, u.display_name as assignee_name
       FROM executions e
       LEFT JOIN processes p ON p.id = e.process_id
       LEFT JOIN users u ON u.id = e.assignee_id
       ${where}
       ORDER BY e.created_at DESC LIMIT 2000`
    )
    .bind(...params)
    .all<Record<string, unknown>>();

  const headers = ["Mã lượt", "Tiêu đề", "Trạng thái", "Quy trình", "Người thực hiện", "Tạo lúc", "Bắt đầu", "Hoàn thành", "Hạn"];
  const escCsv = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.map(escCsv).join(","),
    ...(rows.results ?? []).map((r) =>
      [r.code, r.title, r.status, r.process_name, r.assignee_name, r.created_at, r.started_at, r.completed_at, r.due_at]
        .map(escCsv)
        .join(",")
    ),
  ];
  // BOM để Excel mở đúng UTF-8.
  const csv = "\uFEFF" + lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bao-cao-luot-thuc-hien.csv"`,
    },
  });
}

/** GET /dashboard/by-unit — thống kê theo đơn vị. Query: ?from=&to=&unit_id= */
export async function handleStatsByUnit(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const unitId = url.searchParams.get("unit_id");
  const unitType = url.searchParams.get("unit_type");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (unitId) { conds.push(`ou.id = ?`); params.push(unitId); }
  if (unitType) { conds.push(`ou.type = ?`); params.push(unitType); }
  if (__scope.level === "unit") {
    if (__scope.unitIds.length === 0) { conds.push("1=0"); }
    else { conds.push(`ou.id IN (${__scope.unitIds.map(() => "?").join(",")})`); params.push(...__scope.unitIds); }
  } else if (__scope.level === "self") {
    if (__scope.orgUnitId) { conds.push(`ou.id = ?`); params.push(__scope.orgUnitId); }
    else { conds.push("1=0"); }
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db.prepare(
    `SELECT ou.id AS unit_id, ou.name AS unit_name, ou.type AS unit_type,
            COUNT(DISTINCT e.id) AS total,
            SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN e.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN e.status = 'CREATED' THEN 1 ELSE 0 END) AS created,
            SUM(CASE WHEN e.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN e.status = 'PENDING_CONFIRMATION' THEN 1 ELSE 0 END) AS pending
     FROM org_units ou
     LEFT JOIN process_org_units pou ON pou.org_unit_id = ou.id
     LEFT JOIN executions e ON e.process_id = pou.process_id
     ${where}
     GROUP BY ou.id, ou.name, ou.type
     ORDER BY total DESC`
  ).bind(...params).all<Record<string, unknown>>();
  return ok({ items: rows.results ?? [] });
}

/** GET /dashboard/by-person — thống kê theo người thực hiện. Query: ?from=&to=&user_id= */
export async function handleStatsByPerson(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const userId = url.searchParams.get("user_id");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (userId) { conds.push(`u.id = ?`); params.push(userId); }
  if (__scope.level === "unit") {
    if (__scope.unitIds.length === 0) { conds.push("1=0"); }
    else { conds.push(`u.org_unit_id IN (${__scope.unitIds.map(() => "?").join(",")})`); params.push(...__scope.unitIds); }
  } else if (__scope.level === "self") {
    conds.push(`u.id = ?`); params.push(__scope.userId);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db.prepare(
    `SELECT u.id AS user_id, u.display_name, u.username,
            COUNT(DISTINCT e.id) AS total,
            SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN e.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN e.status = 'PENDING_CONFIRMATION' THEN 1 ELSE 0 END) AS pending,
            AVG(CASE WHEN e.status = 'COMPLETED' AND e.started_at AND e.completed_at
                THEN (julianday(e.completed_at) - julianday(e.started_at)) * 24 ELSE NULL END) AS avg_hours
     FROM users u
     LEFT JOIN executions e ON e.assignee_id = u.id
     ${where}
     GROUP BY u.id, u.display_name, u.username
     HAVING total > 0
     ORDER BY total DESC`
  ).bind(...params).all<Record<string, unknown>>();
  return ok({ items: rows.results ?? [] });
}

/** GET /dashboard/by-process — thống kê theo quy trình. Query: ?from=&to=&process_id= */
export async function handleStatsByProcess(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const processId = url.searchParams.get("process_id");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (processId) { conds.push(`p.id = ?`); params.push(processId); }
  const __sf = executionScopeFragment(__scope, "e");
  if (__sf.cond) { conds.push(__sf.cond); params.push(...__sf.binds); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db.prepare(
    `SELECT p.id AS process_id, p.code AS process_code, p.name AS process_name,
            COUNT(DISTINCT e.id) AS total,
            SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN e.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN e.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
            COUNT(DISTINCT ex.id) AS exception_count
     FROM processes p
     LEFT JOIN executions e ON e.process_id = p.id
     LEFT JOIN exceptions ex ON ex.execution_id = e.id
     ${where}
     GROUP BY p.id, p.code, p.name
     HAVING total > 0
     ORDER BY total DESC`
  ).bind(...params).all<Record<string, unknown>>();
  return ok({ items: rows.results ?? [] });
}

/** GET /dashboard/by-shift — thống kê theo ca làm việc. Query: ?from=&to= */
export async function handleStatsByShift(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;
  const __scope = await getViewScope(db, me as SessionInfo);
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const conds: string[] = [`e.shift IS NOT NULL`];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  const __sf = executionScopeFragment(__scope, "e");
  if (__sf.cond) { conds.push(__sf.cond); params.push(...__sf.binds); }
  const where = `WHERE ${conds.join(" AND ")}`;

  const rows = await db.prepare(
    `SELECT e.shift,
            COUNT(*) AS total,
            SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN e.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN e.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
     FROM executions e
     ${where}
     GROUP BY e.shift
     ORDER BY total DESC`
  ).bind(...params).all<Record<string, unknown>>();
  return ok({ items: rows.results ?? [] });
}
