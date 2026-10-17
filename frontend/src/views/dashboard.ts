// views/dashboard.ts — Dashboard KPI và báo cáo (SPEC §9.6).

import { api } from "../api.js";
import { esc, toast } from "../ui.js";

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Mới tạo",
  IN_PROGRESS: "Đang thực hiện",
  PAUSED: "Tạm dừng",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

export async function renderDashboard(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <h2>Báo cáo & Dashboard</h2>
      <div class="dashboard-filters">
        <input type="date" id="db-from" class="input sm" />
        <input type="date" id="db-to" class="input sm" />
        <button class="btn sm primary" id="db-apply">Áp dụng</button>
        <button class="btn sm" id="db-export">Xuất CSV</button>
      </div>
    </div>
    <div id="db-kpis"><p class="empty">Đang tải…</p></div>
    <section class="card">
      <h3>Lượt thực hiện</h3>
      <div id="db-list"><p class="empty">Đang tải…</p></div>
    </section>`;

  const fromEl = root.querySelector<HTMLInputElement>("#db-from")!;
  const toEl = root.querySelector<HTMLInputElement>("#db-to")!;

  async function load(): Promise<void> {
    const params: Record<string, string> = {};
    if (fromEl.value) params.from = fromEl.value;
    if (toEl.value) params.to = toEl.value;
    try {
      const [summary, list] = await Promise.all([
        api.dashboardSummary(params),
        api.dashboardExecutions({ ...params, limit: "50" }),
      ]);
      renderKpis(root, summary);
      renderList(root, list.items);
    } catch (e) {
      root.querySelector("#db-kpis")!.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#db-apply")!.addEventListener("click", load);
  root.querySelector("#db-export")!.addEventListener("click", () => {
    const q = new URLSearchParams();
    if (fromEl.value) q.set("from", fromEl.value);
    if (toEl.value) q.set("to", toEl.value);
    window.open(api.dashboardExportUrl(q.toString()), "_blank");
    toast("Đang xuất CSV…");
  });

  await load();
}

function kpiCard(label: string, value: string, sub?: string): string {
  return `
    <div class="kpi-card">
      <div class="kpi-value">${esc(value)}</div>
      <div class="kpi-label">${esc(label)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ""}
    </div>`;
}

function renderKpis(root: HTMLElement, s: any): void {
  const k = s.kpis;
  const fmtPct = (v: number | null): string => (v === null ? "—" : `${v}%`);
  root.querySelector("#db-kpis")!.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Tổng lượt", String(s.executions.total), Object.entries(s.executions.by_status).map(([st, c]) => `${STATUS_LABELS[st] ?? st}: ${c}`).join(" · "))}
      ${kpiCard("Tỉ lệ hoàn thành bước", fmtPct(k.completion_rate), `${k.completion_rate_detail.done}/${k.completion_rate_detail.total} bước bắt buộc`)}
      ${kpiCard("Đúng hạn", fmtPct(k.on_time_rate), `${k.on_time_detail.ontime}/${k.on_time_detail.total} lượt có hạn`)}
      ${kpiCard("Đầy đủ bằng chứng", fmtPct(k.evidence_completeness), `${k.evidence_detail.satisfied}/${k.evidence_detail.required} bước yêu cầu ảnh`)}
      ${kpiCard("Thời gian chu kỳ (trung vị)", k.cycle_time_hours.median !== null ? `${k.cycle_time_hours.median}h` : "—", `P95: ${k.cycle_time_hours.p95 !== null ? k.cycle_time_hours.p95 + "h" : "—"} · ${k.cycle_time_hours.samples} mẫu`)}
    </div>`;
}

function renderList(root: HTMLElement, items: any[]): void {
  const el = root.querySelector("#db-list")!;
  if (items.length === 0) {
    el.innerHTML = `<p class="empty">Chưa có lượt nào.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Mã lượt</th><th>Quy trình</th><th>Trạng thái</th><th>Người thực hiện</th><th>Tạo lúc</th><th>Hoàn thành</th></tr></thead>
      <tbody>
        ${items.map((e) => `
          <tr>
            <td><a href="#/executions/${esc(e.id)}">${esc(e.code)}</a></td>
            <td>${esc(e.process_name ?? "—")}</td>
            <td>${esc(STATUS_LABELS[e.status] ?? e.status)}</td>
            <td>${esc(e.assignee_name ?? "—")}</td>
            <td class="muted small">${esc((e.created_at ?? "").slice(0, 16).replace("T", " "))}</td>
            <td class="muted small">${esc((e.completed_at ?? "—").slice(0, 16).replace("T", " "))}</td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;
}
