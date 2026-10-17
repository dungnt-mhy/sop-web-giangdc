// routes/dashboard.ts — Dashboard KPI và báo cáo (SPEC §9.6).
// Công thức chuẩn:
//   completion_rate = completed_required_steps / total_required_steps
//   on_time_rate = executions_completed_on_or_before_due / completed_executions_with_due_date
//   evidence_completeness = satisfied_required_evidence / required_evidence
//   right_first_time = executions_without_rework_or_blocking_exception / eligible_completed_executions
//   cycle_time = completed_at - started_at (median và P95)

import { apiError, ok } from "../errors";
import { requirePermission } from "./auth";
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

  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const processId = url.searchParams.get("process_id");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (processId) { conds.push(`e.process_id = ?`); params.push(processId); }
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

/** GET /dashboard/executions — danh sách lượt cho báo cáo (có filter). */
export async function handleDashboardExecutions(ctx: Ctx) {
  const me = await requirePermission(ctx, "reports.view");
  if (me instanceof Response) return me;
  const db = ctx.env.sop_demo_db;

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

  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const processId = url.searchParams.get("process_id");

  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) { conds.push(`e.created_at >= ?`); params.push(from); }
  if (to) { conds.push(`e.created_at < date(?, '+1 day')`); params.push(to); }
  if (processId) { conds.push(`e.process_id = ?`); params.push(processId); }
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
