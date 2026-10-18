// views/dashboard.ts — Dashboard chuyên nghiệp với biểu đồ SVG.

import { api } from "../api.js";
import { esc, toast } from "../ui.js";

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Mới tạo",
  IN_PROGRESS: "Đang thực hiện",
  PAUSED: "Tạm dừng",
  PENDING_CONFIRMATION: "Chờ xác nhận",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const STATUS_COLORS: Record<string, string> = {
  CREATED: "#94a3b8",
  IN_PROGRESS: "#3b82f6",
  PAUSED: "#f59e0b",
  PENDING_CONFIRMATION: "#a855f7",
  COMPLETED: "#22c55e",
  CANCELLED: "#ef4444",
};

const SEVERITY_LABELS: Record<string, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  CRITICAL: "Nghiêm trọng",
};

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "#22c55e",
  MEDIUM: "#f59e0b",
  HIGH: "#f97316",
  CRITICAL: "#ef4444",
};

export async function renderDashboard(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>📊 Thống kê tổng quan</h2>
        <p class="page-sub">Thống kê toàn bộ hoạt động: lượt công việc, ngoại lệ, bằng chứng, người dùng.</p>
      </div>
      <div class="dashboard-filters">
        <input type="date" id="db-from" class="input sm" />
        <input type="date" id="db-to" class="input sm" />
        <button class="btn sm primary" id="db-apply">Áp dụng</button>
        <button class="btn sm" id="db-export">Xuất CSV</button>
      </div>
    </div>
    <div id="db-content"><p class="empty">Đang tải…</p></div>`;

  const fromEl = root.querySelector<HTMLInputElement>("#db-from")!;
  const toEl = root.querySelector<HTMLInputElement>("#db-to")!;
  const contentEl = root.querySelector<HTMLElement>("#db-content")!;

  async function load(): Promise<void> {
    const params: Record<string, string> = {};
    if (fromEl.value) params.from = fromEl.value;
    if (toEl.value) params.to = toEl.value;
    contentEl.innerHTML = `<p class="empty">Đang tải…</p>`;
    try {
      const [summary, overview] = await Promise.all([
        api.dashboardSummary(params),
        api.dashboardOverview(params),
      ]);
      renderFullDashboard(contentEl, summary, overview);
    } catch (e) {
      contentEl.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
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

// ============ SVG CHART HELPERS ============

/** Biểu đồ donut cho phân bố trạng thái. */
function donutChart(data: { label: string; value: number; color: string }[], size = 180): string {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total === 0) return `<p class="empty">Chưa có dữ liệu.</p>`;

  const cx = size / 2, cy = size / 2, r = size / 2 - 12, innerR = r * 0.62;
  let angle = -90;
  const paths = data.map((d) => {
    const pct = d.value / total;
    const startAngle = angle;
    const endAngle = angle + pct * 360;
    angle = endAngle;
    const large = pct > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos((startAngle * Math.PI) / 180);
    const y1 = cy + r * Math.sin((startAngle * Math.PI) / 180);
    const x2 = cx + r * Math.cos((endAngle * Math.PI) / 180);
    const y2 = cy + r * Math.sin((endAngle * Math.PI) / 180);
    const ix1 = cx + innerR * Math.cos((endAngle * Math.PI) / 180);
    const iy1 = cy + innerR * Math.sin((endAngle * Math.PI) / 180);
    const ix2 = cx + innerR * Math.cos((startAngle * Math.PI) / 180);
    const iy2 = cy + innerR * Math.sin((startAngle * Math.PI) / 180);
    return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z"
      fill="${d.color}" opacity="0.9"><title>${esc(d.label)}: ${d.value}</title></path>`;
  }).join("");

  const legend = data.map((d) => `
    <div class="chart-legend-item">
      <span class="legend-dot" style="background:${d.color}"></span>
      <span>${esc(d.label)}</span><strong>${d.value}</strong>
    </div>`).join("");

  return `
    <div class="chart-flex">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${paths}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-center-num">${total}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-center-label">tổng</text>
      </svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}

/** Biểu đồ cột cho dữ liệu theo ngày. */
function barChart(dates: string[], values: number[], color = "#3b82f6"): string {
  if (dates.length === 0) return `<p class="empty">Chưa có dữ liệu.</p>`;
  const max = Math.max(...values, 1);
  const W = 520, H = 180, padL = 36, padB = 28, padT = 12;
  const cw = (W - padL - 8) / dates.length;
  const bw = Math.min(cw * 0.7, 36);

  const bars = dates.map((d, i) => {
    const h = ((H - padB - padT) * values[i]) / max;
    const x = padL + i * cw + (cw - bw) / 2;
    const y = H - padB - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"
      fill="${color}" rx="3" opacity="0.85"><title>${esc(d)}: ${values[i]}</title></rect>
      ${i % Math.ceil(dates.length / 7) === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="chart-axis">${esc(d.slice(5))}</text>` : ""}`;
  }).join("");

  // Lưới ngang.
  const grid = [0, 0.5, 1].map((f) => {
    const y = H - padB - f * (H - padB - padT);
    const v = Math.round(max * f);
    return `<line x1="${padL}" y1="${y}" x2="${W - 8}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="3"/>
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" class="chart-axis">${v}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg">${grid}${bars}</svg>`;
}

/** Thanh ngang cho xếp hạng. */
function hbarChart(items: { label: string; value: number; sub?: string; color?: string }[], maxBars = 8): string {
  if (items.length === 0) return `<p class="empty">Chưa có dữ liệu.</p>`;
  const max = Math.max(...items.slice(0, maxBars).map((i) => i.value), 1);
  return `<div class="hbar-list">` + items.slice(0, maxBars).map((it, i) => {
    const pct = (it.value / max) * 100;
    const color = it.color ?? ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#84cc16"][i % 8];
    return `
      <div class="hbar-row">
        <div class="hbar-label">${esc(it.label)}${it.sub ? ` <span class="muted small">${esc(it.sub)}</span>` : ""}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
        <div class="hbar-value">${it.value}</div>
      </div>`;
  }).join("") + `</div>`;
}

// ============ RENDER ============

function kpiCard(icon: string, label: string, value: string, sub?: string, accent = "#3b82f6"): string {
  return `
    <div class="kpi-card-pro" style="--accent:${accent}">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-body">
        <div class="kpi-value">${esc(value)}</div>
        <div class="kpi-label">${esc(label)}</div>
        ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
      </div>
    </div>`;
}

function renderFullDashboard(root: HTMLElement, s: any, o: any): void {
  const k = s.kpis;
  const fmtPct = (v: number | null): string => (v === null ? "—" : `${v}%`);

  // Chuẩn bị dữ liệu biểu đồ trạng thái.
  const statusData = Object.entries(s.executions.by_status as Record<string, number>).map(([st, cnt]) => ({
    label: STATUS_LABELS[st] ?? st,
    value: cnt as number,
    color: STATUS_COLORS[st] ?? "#94a3b8",
  }));

  // Dữ liệu theo ngày (gộp theo ngày, 14 ngày gần nhất).
  const byDateMap = new Map<string, number>();
  for (const r of (o.executions_by_date as { d: string; cnt: number }[])) {
    byDateMap.set(r.d, (byDateMap.get(r.d) ?? 0) + r.cnt);
  }
  const sortedDates = [...byDateMap.keys()].sort().slice(-14);
  const dateValues = sortedDates.map((d) => byDateMap.get(d) ?? 0);

  // Ngoại lệ theo mức độ.
  const sevData = Object.entries(o.exceptions.by_severity as Record<string, number>).map(([sv, cnt]) => ({
    label: SEVERITY_LABELS[sv] ?? sv,
    value: cnt as number,
    color: SEVERITY_COLORS[sv] ?? "#94a3b8",
  }));

  root.innerHTML = `
    <!-- KPI CARDS -->
    <section class="kpi-grid-pro">
      ${kpiCard("📋", "Tổng lượt công việc", String(s.executions.total), `${s.executions.by_status.COMPLETED ?? 0} hoàn thành`, "#3b82f6")}
      ${kpiCard("✅", "Tỉ lệ hoàn thành", fmtPct(k.completion_rate), `${k.completion_rate_detail.done}/${k.completion_rate_detail.total} bước`, "#22c55e")}
      ${kpiCard("⏱️", "Đúng hạn", fmtPct(k.on_time_rate), `${k.on_time_detail.ontime}/${k.on_time_detail.total} lượt`, "#8b5cf6")}
      ${kpiCard("⚠️", "Ngoại lệ đang mở", String(o.exceptions.open), Object.entries(o.exceptions.by_severity as Record<string, number>).map(([sv, c]) => `${SEVERITY_LABELS[sv] ?? sv}: ${c}`).join(" · ") || "Không có", "#f59e0b")}
      ${kpiCard("📷", "Bằng chứng", String(o.evidence.total), Object.entries(o.evidence.by_kind as Record<string, number>).map(([kd, c]) => `${kd === "photo" ? "Ảnh" : "Tệp"}: ${c}`).join(" · ") || "Chưa có", "#06b6d4")}
      ${kpiCard("👥", "Người dùng hoạt động", String(o.active_users), `${(o.workload as unknown[]).length} người có lượt`, "#ec4899")}
    </section>

    <!-- CHARTS ROW 1 -->
    <div class="dash-grid-2">
      <section class="card">
        <h3>Trạng thái lượt công việc</h3>
        ${donutChart(statusData)}
      </section>
      <section class="card">
        <h3>Lượt công việc theo ngày (14 ngày gần nhất)</h3>
        ${barChart(sortedDates, dateValues)}
      </section>
    </div>

    <!-- CHARTS ROW 2 -->
    <div class="dash-grid-2">
      <section class="card">
        <h3>Ngoại lệ đang mở theo mức độ</h3>
        ${hbarChart(sevData)}
        ${(o.exceptions.recent_open as any[]).length > 0 ? `
          <h4 style="margin-top:16px">Mới nhất</h4>
          <ul class="exc-list">
            ${(o.exceptions.recent_open as any[]).map((x: any) => `
              <li>
                <span class="pill" style="background:${SEVERITY_COLORS[x.severity] ?? "#94a3b8"}22;color:${SEVERITY_COLORS[x.severity] ?? "#666"}">${esc(SEVERITY_LABELS[x.severity] ?? x.severity)}</span>
                <strong>${esc(x.title)}</strong>
                <span class="muted small">${esc(x.exec_code ?? "")} · ${esc((x.created_at ?? "").slice(0, 10))}</span>
              </li>`).join("")}
          </ul>` : ""}
      </section>
      <section class="card">
        <h3>Top quy trình (theo số lượt)</h3>
        ${hbarChart((o.top_processes as any[]).map((p: any) => ({
          label: p.name,
          value: p.cnt,
          sub: `${p.done_cnt} hoàn thành`,
        })))}
      </section>
    </div>

    <!-- WORKLOAD -->
    <section class="card">
      <h3>📊 Khối lượng công việc theo người</h3>
      ${(o.workload as any[]).length === 0 ? `<p class="empty">Chưa có dữ liệu.</p>` : `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Người thực hiện</th><th>Tổng lượt</th><th>Hoàn thành</th><th>Đang làm</th><th>Tiến độ</th></tr></thead>
        <tbody>
          ${(o.workload as any[]).map((w: any) => {
            const pctDone = w.total > 0 ? Math.round((w.done / w.total) * 100) : 0;
            return `<tr>
              <td><strong>${esc(w.display_name)}</strong> <span class="muted small">(${esc(w.username)})</span></td>
              <td>${w.total}</td>
              <td><span class="pill green">${w.done}</span></td>
              <td><span class="pill blue">${w.active}</span></td>
              <td><div class="progress"><div class="progress-bar" style="width:${pctDone}%"></div></div> ${pctDone}%</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>`}
    </section>

    <!-- KPI CHI TIẾT -->
    <div class="dash-grid-2">
      <section class="card">
        <h3>Chỉ số chi tiết</h3>
        <dl class="detail-list">
          <div><dt>Tỉ lệ hoàn thành bước</dt><dd>${fmtPct(k.completion_rate)} <span class="muted">(${k.completion_rate_detail.done}/${k.completion_rate_detail.total})</span></dd></div>
          <div><dt>Đầy đủ bằng chứng</dt><dd>${fmtPct(k.evidence_completeness)} <span class="muted">(${k.evidence_detail.satisfied}/${k.evidence_detail.required})</span></dd></div>
          <div><dt>Thời gian chu kỳ (trung vị)</dt><dd>${k.cycle_time_hours.median !== null ? k.cycle_time_hours.median + "h" : "—"}</dd></div>
          <div><dt>Thời gian chu kỳ (P95)</dt><dd>${k.cycle_time_hours.p95 !== null ? k.cycle_time_hours.p95 + "h" : "—"} <span class="muted">(${k.cycle_time_hours.samples} mẫu)</span></dd></div>
        </dl>
      </section>
      <section class="card">
        <h3>Lượt công việc gần đây</h3>
        <div id="db-recent"><p class="empty">Đang tải…</p></div>
      </section>
    </div>

    <!-- THỐNG KÊ THEO NGÀY -->
    <section class="card" id="db-daily-section">
      <div class="page-head" style="margin-bottom:12px">
        <div><h3>📅 Thống kê theo ngày</h3>
        <p class="page-sub">Chi tiết từng ngày: lượt tạo mới, lượt hoàn thành, ngoại lệ, bằng chứng.</p></div>
        <div class="dashboard-filters">
          <input type="date" id="db-daily-from" class="input sm" />
          <input type="date" id="db-daily-to" class="input sm" />
          <button class="btn sm primary" id="db-daily-apply">Xem</button>
        </div>
      </div>
      <div id="db-daily"><p class="empty">Đang tải…</p></div>
    </section>`;

  // Tải danh sách lượt gần đây.
  api.dashboardExecutions({ limit: "8" }).then(({ items }) => {
    const el = root.querySelector("#db-recent");
    if (!el) return;
    if (items.length === 0) {
      el.innerHTML = `<p class="empty">Chưa có lượt nào.</p>`;
      return;
    }
    el.innerHTML = `<ul class="exc-list">` + items.map((e: any) => `
      <li>
        <a href="#/executions/${esc(e.id)}"><strong>${esc(e.code)}</strong></a>
        <span>${esc(e.process_name ?? "")}</span>
        <span class="pill" style="background:${STATUS_COLORS[e.status] ?? "#94a3b8"}22">${esc(STATUS_LABELS[e.status] ?? e.status)}</span>
      </li>`).join("") + `</ul>`;
  }).catch(() => {});

  // Thống kê theo ngày.
  const dailyFrom = root.querySelector<HTMLInputElement>("#db-daily-from")!;
  const dailyTo = root.querySelector<HTMLInputElement>("#db-daily-to")!;
  // Mặc định 14 ngày gần nhất.
  const today = new Date();
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(today.getDate() - 13);
  dailyTo.value = today.toISOString().slice(0, 10);
  dailyFrom.value = twoWeeksAgo.toISOString().slice(0, 10);

  async function loadDaily(): Promise<void> {
    const el = root.querySelector<HTMLElement>("#db-daily")!;
    el.innerHTML = `<p class="empty">Đang tải…</p>`;
    const params: Record<string, string> = {};
    if (dailyFrom.value) params.from = dailyFrom.value;
    if (dailyTo.value) params.to = dailyTo.value;
    try {
      const data = await api.dashboardDaily(params);
      renderDaily(el, data);
    } catch (e) {
      el.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#db-daily-apply")!.addEventListener("click", loadDaily);
  loadDaily();
}

function renderDaily(el: HTMLElement, data: {
  from: string; to: string;
  days: { date: string; created: number; completed: number; exc_opened: number; exc_closed: number; evidence: number }[];
  totals: { created: number; completed: number; exc_opened: number; exc_closed: number; evidence: number };
}): void {
  const t = data.totals;
  // Biểu đồ cột kép: lượt tạo vs hoàn thành.
  const dates = data.days.map((d) => d.date);
  const createdVals = data.days.map((d) => d.created);
  const completedVals = data.days.map((d) => d.completed);

  el.innerHTML = `
    <div class="daily-totals">
      <div class="daily-total"><strong>${t.created}</strong><span>Lượt tạo mới</span></div>
      <div class="daily-total"><strong>${t.completed}</strong><span>Lượt hoàn thành</span></div>
      <div class="daily-total"><strong>${t.exc_opened}</strong><span>Ngoại lệ mới</span></div>
      <div class="daily-total"><strong>${t.exc_closed}</strong><span>Ngoại lệ đã xử lý</span></div>
      <div class="daily-total"><strong>${t.evidence}</strong><span>Bằng chứng</span></div>
    </div>
    <h4>Lượt công việc theo ngày (${esc(data.from)} → ${esc(data.to)})</h4>
    ${dualBarChart(dates, createdVals, completedVals)}
    <h4 style="margin-top:16px">Chi tiết từng ngày</h4>
    <div class="table-wrap"><table class="tbl">
      <thead><tr>
        <th>Ngày</th><th>Lượt tạo mới</th><th>Lượt hoàn thành</th>
        <th>Ngoại lệ mới</th><th>Ngoại lệ xử lý</th><th>Bằng chứng</th>
      </tr></thead>
      <tbody>
        ${[...data.days].reverse().map((d) => `
          <tr>
            <td><strong>${esc(formatDateVn(d.date))}</strong> <span class="muted small">${esc(d.date.slice(5))}</span></td>
            <td>${d.created > 0 ? `<span class="pill blue">${d.created}</span>` : `<span class="muted">—</span>`}</td>
            <td>${d.completed > 0 ? `<span class="pill green">${d.completed}</span>` : `<span class="muted">—</span>`}</td>
            <td>${d.exc_opened > 0 ? `<span class="pill orange">${d.exc_opened}</span>` : `<span class="muted">—</span>`}</td>
            <td>${d.exc_closed > 0 ? `<span class="pill">${d.exc_closed}</span>` : `<span class="muted">—</span>`}</td>
            <td>${d.evidence > 0 ? `<span class="pill">${d.evidence}</span>` : `<span class="muted">—</span>`}</td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;
}

function formatDateVn(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Biểu đồ cột kép: so sánh 2 chuỗi dữ liệu theo ngày. */
function dualBarChart(dates: string[], vals1: number[], vals2: number[]): string {
  if (dates.length === 0) return `<p class="empty">Chưa có dữ liệu.</p>`;
  const max = Math.max(...vals1, ...vals2, 1);
  const W = 640, H = 200, padL = 36, padB = 28, padT = 16;
  const cw = (W - padL - 8) / dates.length;
  const bw = Math.min(cw * 0.32, 18);

  const bars = dates.map((d, i) => {
    const h1 = ((H - padB - padT) * vals1[i]) / max;
    const h2 = ((H - padB - padT) * vals2[i]) / max;
    const x = padL + i * cw + (cw - bw * 2 - 2) / 2;
    const y1 = H - padB - h1, y2 = H - padB - h2;
    return `
      <rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${h1.toFixed(1)}" fill="#3b82f6" rx="2" opacity="0.85"><title>${esc(d)} tạo mới: ${vals1[i]}</title></rect>
      <rect x="${(x + bw + 2).toFixed(1)}" y="${y2.toFixed(1)}" width="${bw.toFixed(1)}" height="${h2.toFixed(1)}" fill="#22c55e" rx="2" opacity="0.85"><title>${esc(d)} hoàn thành: ${vals2[i]}</title></rect>
      ${i % Math.ceil(dates.length / 10) === 0 ? `<text x="${(x + bw).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="chart-axis">${esc(d.slice(5))}</text>` : ""}`;
  }).join("");

  const grid = [0, 0.5, 1].map((f) => {
    const y = H - padB - f * (H - padB - padT);
    return `<line x1="${padL}" y1="${y}" x2="${W - 8}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="3"/>
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" class="chart-axis">${Math.round(max * f)}</text>`;
  }).join("");

  return `
    <div class="chart-legend" style="flex-direction:row;gap:16px;margin-bottom:8px">
      <div class="chart-legend-item"><span class="legend-dot" style="background:#3b82f6"></span><span>Lượt tạo mới</span></div>
      <div class="chart-legend-item"><span class="legend-dot" style="background:#22c55e"></span><span>Lượt hoàn thành</span></div>
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg">${grid}${bars}</svg>`;
}
