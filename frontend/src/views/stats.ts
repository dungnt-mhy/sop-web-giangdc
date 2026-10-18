// views/stats.ts — Các module thống kê theo tiêu chí (đơn vị, người, quy trình, ca, ngày).

import { api } from "../api.js";
import { esc, toast } from "../ui.js";

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message);
  return "Lỗi không xác định.";
}

const SHIFT_LABEL: Record<string, string> = {
  MORNING: "Ca sáng", NOON: "Ca trưa", AFTERNOON: "Ca chiều", NIGHT: "Ca tối",
};

const STATUS_COLOR: Record<string, string> = {
  completed: "#22c55e", in_progress: "#3b82f6", created: "#94a3b8",
  pending: "#f59e0b", cancelled: "#ef4444",
};

/** Vẽ biểu đồ cột ngang đẹp. */
function barChart(items: { label: string; value: number; color?: string }[], maxVal?: number): string {
  const max = maxVal ?? Math.max(...items.map((i) => i.value), 1);
  const rows = items.map((it) => {
    const w = Math.max(2, Math.round((it.value / max) * 100));
    return `
      <div class="chart-row">
        <div class="chart-label" title="${esc(it.label)}">${esc(it.label)}</div>
        <div class="chart-bar-wrap"><div class="chart-bar" style="width:${w}%;background:${it.color || "#3b82f6"}"></div></div>
        <div class="chart-val">${it.value}</div>
      </div>`;
  }).join("");
  return `<div class="chart-bars">${rows}</div>`;
}

/** Vẽ biểu đồ donut SVG. */
function donutChart(segments: { label: string; value: number; color: string }[]): string {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const circles = segments.map((s) => {
    const frac = s.value / total;
    const dash = `${(frac * 100).toFixed(1)} ${(100 - frac * 100).toFixed(1)}`;
    const offset = 25 - acc * 100;
    acc += frac;
    return `<circle cx="60" cy="60" r="45" fill="none" stroke="${s.color}" stroke-width="18"
      stroke-dasharray="${dash}" stroke-dashoffset="${offset.toFixed(1)}" />`;
  }).join("");
  const legend = segments.map((s) =>
    `<div class="donut-legend-item"><span class="dot" style="background:${s.color}"></span>${esc(s.label)}: <strong>${s.value}</strong></div>`
  ).join("");
  return `<div class="donut-wrap"><svg viewBox="0 0 120 120" class="donut">${circles}</svg><div class="donut-legend">${legend}</div></div>`;
}

function pct(a: number, b: number): string {
  if (!b) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

/** Khung lọc chung: từ ngày, đến ngày + slot lọc riêng. */
function filterBar(extra: string): string {
  return `
    <div class="filter-bar">
      <input class="input" type="date" id="st-from" title="Từ ngày" />
      <input class="input" type="date" id="st-to" title="Đến ngày" />
      ${extra}
      <button class="btn primary" id="st-filter">Lọc</button>
    </div>`;
}

function getDateParams(): string {
  const from = (document.querySelector("#st-from") as HTMLInputElement)?.value;
  const to = (document.querySelector("#st-to") as HTMLInputElement)?.value;
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  return p.toString();
}

/** Thống kê theo đơn vị. */
export async function renderStatsUnit(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head"><div><h2>📊 Thống kê theo đơn vị</h2>
    <p class="page-sub">Số lượt công việc của từng đơn vị tổ chức.</p></div></div>
    ${filterBar(`<select class="input" id="st-unit"><option value="">— Tất cả đơn vị —</option></select>
      <select class="input" id="st-unit-type"><option value="">— Mọi loại —</option>
        <option value="REGION">Khu vực</option><option value="BRANCH">Chi nhánh</option>
        <option value="STORE">Cửa hàng</option><option value="WAREHOUSE">Kho</option>
      </select>`)}
    <div id="st-result"><p class="empty">Đang tải…</p></div>`;

  const resultEl = root.querySelector<HTMLElement>("#st-result")!;
  const unitEl = root.querySelector<HTMLSelectElement>("#st-unit")!;
  const typeEl = root.querySelector<HTMLSelectElement>("#st-unit-type")!;

  try {
    const { items } = await api.listOrgUnits();
    unitEl.innerHTML = `<option value="">— Tất cả đơn vị —</option>` +
      items.map((u: { id: string; name: string }) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("");
  } catch { /* ignore */ }

  async function reload(): Promise<void> {
    try {
      const params = getDateParams();
      const usp = new URLSearchParams(params);
      if (unitEl.value) usp.set("unit_id", unitEl.value);
      const typeEl = root.querySelector<HTMLSelectElement>("#st-unit-type")!;
      if (typeEl.value) usp.set("unit_type", typeEl.value);
      const { items } = await api.statsByUnit(usp.toString());
      if (items.length === 0) {
        resultEl.innerHTML = `<p class="empty">Chưa có dữ liệu.</p>`;
        return;
      }
      const total = items.reduce((a, r) => a + (Number(r.total) || 0), 0);
      resultEl.innerHTML = `
        <div class="stat-cards">
          <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Tổng lượt</div></div>
          <div class="stat-card"><div class="stat-num">${items.length}</div><div class="stat-label">Đơn vị</div></div>
        </div>
        <div class="card"><h3>Biểu đồ theo đơn vị</h3>
          ${barChart(items.map((r) => ({
            label: String(r.unit_name),
            value: Number(r.total) || 0,
            color: "#3b82f6",
          })))}
        </div>
        <div class="card"><h3>Chi tiết</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Đơn vị</th><th>Loại</th><th>Tổng</th><th>Hoàn thành</th><th>Đang làm</th><th>Chờ xác nhận</th><th>Mới tạo</th><th>Đã hủy</th><th>Tỉ lệ HT</th></tr></thead>
            <tbody>
              ${items.map((r) => {
                const t = Number(r.total) || 0, c = Number(r.completed) || 0;
                return `<tr>
                  <td><strong>${esc(String(r.unit_name))}</strong></td>
                  <td>${esc(String(r.unit_type || "—"))}</td>
                  <td>${t}</td><td>${c}</td><td>${Number(r.in_progress) || 0}</td>
                  <td>${Number(r.pending) || 0}</td><td>${Number(r.created) || 0}</td>
                  <td>${Number(r.cancelled) || 0}</td><td>${pct(c, t)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table></div>
        </div>`;
    } catch (e) {
      resultEl.innerHTML = `<p class="empty">Lỗi: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#st-filter")!.addEventListener("click", reload);
  await reload();
}

/** Thống kê theo người thực hiện. */
export async function renderStatsPerson(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head"><div><h2>👤 Thống kê theo người</h2>
    <p class="page-sub">Khối lượng công việc của từng người thực hiện.</p></div></div>
    ${filterBar(`<select class="input" id="st-user"><option value="">— Mọi người —</option></select>`)}
    <div id="st-result"><p class="empty">Đang tải…</p></div>`;

  const resultEl = root.querySelector<HTMLElement>("#st-result")!;
  const userEl = root.querySelector<HTMLSelectElement>("#st-user")!;

  try {
    const { items } = await api.listUsers();
    userEl.innerHTML = `<option value="">— Mọi người —</option>` +
      items.map((u) => `<option value="${esc(u.id)}">${esc(u.display_name || u.username)}</option>`).join("");
  } catch { /* ignore */ }

  async function reload(): Promise<void> {
    try {
      const params = getDateParams();
      const usp = new URLSearchParams(params);
      if (userEl.value) usp.set("user_id", userEl.value);
      const { items } = await api.statsByPerson(usp.toString());
      if (items.length === 0) {
        resultEl.innerHTML = `<p class="empty">Chưa có dữ liệu.</p>`;
        return;
      }
      resultEl.innerHTML = `
        <div class="card"><h3>Biểu đồ khối lượng</h3>
          ${barChart(items.slice(0, 15).map((r) => ({
            label: String(r.display_name || r.username),
            value: Number(r.total) || 0,
            color: "#22c55e",
          })))}
        </div>
        <div class="card"><h3>Chi tiết</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Người</th><th>Tổng lượt</th><th>Hoàn thành</th><th>Đang làm</th><th>Chờ xác nhận</th><th>TB giờ/lượt</th><th>Tỉ lệ HT</th></tr></thead>
            <tbody>
              ${items.map((r) => {
                const t = Number(r.total) || 0, c = Number(r.completed) || 0;
                const avg = r.avg_hours != null ? `${Number(r.avg_hours).toFixed(1)}h` : "—";
                return `<tr>
                  <td><strong>${esc(String(r.display_name || r.username))}</strong></td>
                  <td>${t}</td><td>${c}</td><td>${Number(r.in_progress) || 0}</td>
                  <td>${Number(r.pending) || 0}</td><td>${avg}</td><td>${pct(c, t)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table></div>
        </div>`;
    } catch (e) {
      resultEl.innerHTML = `<p class="empty">Lỗi: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#st-filter")!.addEventListener("click", reload);
  await reload();
}

/** Thống kê theo quy trình. */
export async function renderStatsProcess(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head"><div><h2>📋 Thống kê theo quy trình</h2>
    <p class="page-sub">Tần suất sử dụng và hiệu quả từng quy trình.</p></div></div>
    ${filterBar("")}
    <div id="st-result"><p class="empty">Đang tải…</p></div>`;

  const resultEl = root.querySelector<HTMLElement>("#st-result")!;

  async function reload(): Promise<void> {
    try {
      const { items } = await api.statsByProcess(getDateParams());
      if (items.length === 0) {
        resultEl.innerHTML = `<p class="empty">Chưa có dữ liệu.</p>`;
        return;
      }
      resultEl.innerHTML = `
        <div class="card"><h3>Biểu đồ lượt theo quy trình</h3>
          ${barChart(items.slice(0, 15).map((r) => ({
            label: `${String(r.process_code)} — ${String(r.process_name)}`,
            value: Number(r.total) || 0,
            color: "#8b5cf6",
          })))}
        </div>
        <div class="card"><h3>Chi tiết</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Mã</th><th>Quy trình</th><th>Tổng lượt</th><th>Hoàn thành</th><th>Đang làm</th><th>Đã hủy</th><th>Ngoại lệ</th><th>Tỉ lệ HT</th></tr></thead>
            <tbody>
              ${items.map((r) => {
                const t = Number(r.total) || 0, c = Number(r.completed) || 0;
                return `<tr>
                  <td><span class="pill gray">${esc(String(r.process_code))}</span></td>
                  <td><strong>${esc(String(r.process_name))}</strong></td>
                  <td>${t}</td><td>${c}</td><td>${Number(r.in_progress) || 0}</td>
                  <td>${Number(r.cancelled) || 0}</td><td>${Number(r.exception_count) || 0}</td>
                  <td>${pct(c, t)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table></div>
        </div>`;
    } catch (e) {
      resultEl.innerHTML = `<p class="empty">Lỗi: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#st-filter")!.addEventListener("click", reload);
  await reload();
}

/** Thống kê theo ca làm việc. */
export async function renderStatsShift(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head"><div><h2>🕐 Thống kê theo ca</h2>
    <p class="page-sub">Phân bố công việc theo ca làm việc.</p></div></div>
    ${filterBar("")}
    <div id="st-result"><p class="empty">Đang tải…</p></div>`;

  const resultEl = root.querySelector<HTMLElement>("#st-result")!;

  async function reload(): Promise<void> {
    try {
      const { items } = await api.statsByShift(getDateParams());
      if (items.length === 0) {
        resultEl.innerHTML = `<p class="empty">Chưa có dữ liệu.</p>`;
        return;
      }
      const total = items.reduce((a, r) => a + (Number(r.total) || 0), 0);
      const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6"];
      resultEl.innerHTML = `
        <div class="card"><h3>Phân bố theo ca</h3>
          ${donutChart(items.map((r, i) => ({
            label: SHIFT_LABEL[String(r.shift)] || String(r.shift),
            value: Number(r.total) || 0,
            color: colors[i % colors.length],
          })))}
        </div>
        <div class="card"><h3>Chi tiết</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Ca</th><th>Tổng lượt</th><th>Hoàn thành</th><th>Đang làm</th><th>Đã hủy</th><th>Tỉ lệ HT</th><th>Tỉ trọng</th></tr></thead>
            <tbody>
              ${items.map((r) => {
                const t = Number(r.total) || 0, c = Number(r.completed) || 0;
                return `<tr>
                  <td><strong>${esc(SHIFT_LABEL[String(r.shift)] || String(r.shift))}</strong></td>
                  <td>${t}</td><td>${c}</td><td>${Number(r.in_progress) || 0}</td>
                  <td>${Number(r.cancelled) || 0}</td><td>${pct(c, t)}</td><td>${pct(t, total)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table></div>
        </div>`;
    } catch (e) {
      resultEl.innerHTML = `<p class="empty">Lỗi: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#st-filter")!.addEventListener("click", reload);
  await reload();
}

/** Vẽ biểu đồ cột đứng SVG cho thống kê theo ngày. */
function verticalBarChart(days: { d: string; created: number; completed: number }[]): string {
  if (days.length === 0) return `<p class="empty">Chưa có dữ liệu.</p>`;
  const max = Math.max(...days.map((x) => Math.max(x.created, x.completed)), 1);
  const W = 34, GAP = 8, H = 160;
  const totalW = days.length * (W + GAP) + GAP;
  const bars = days.map((x, i) => {
    const cx = GAP + i * (W + GAP);
    const h1 = Math.round((x.created / max) * H);
    const h2 = Math.round((x.completed / max) * H);
    const lbl = x.d.slice(5);
    return `
      <g>
        <rect x="${cx}" y="${H - h1}" width="${W / 2 - 1}" height="${h1}" fill="#3b82f6" rx="2">
          <title>${x.d}: tạo ${x.created}</title></rect>
        <rect x="${cx + W / 2 + 1}" y="${H - h2}" width="${W / 2 - 1}" height="${h2}" fill="#22c55e" rx="2">
          <title>${x.d}: xong ${x.completed}</title></rect>
        <text x="${cx + W / 2}" y="${H + 14}" font-size="9" text-anchor="middle" fill="#64748b">${lbl}</text>
      </g>`;
  }).join("");
  return `
    <div style="overflow-x:auto"><svg width="${Math.max(totalW, 300)}" height="${H + 20}" style="min-width:100%">
      ${bars}</svg></div>
    <div class="donut-legend" style="margin-top:8px">
      <div class="donut-legend-item"><span class="dot" style="background:#3b82f6"></span>Tạo mới</div>
      <div class="donut-legend-item"><span class="dot" style="background:#22c55e"></span>Hoàn thành</div>
    </div>`;
}

/** Thống kê theo ngày. */
export async function renderStatsDaily(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head"><div><h2>📅 Thống kê theo ngày</h2>
    <p class="page-sub">Số lượt tạo mới và hoàn thành từng ngày.</p></div></div>
    <div class="filter-bar">
      <input class="input" type="date" id="st-from" title="Từ ngày" />
      <input class="input" type="date" id="st-to" title="Đến ngày" />
      <button class="btn primary" id="st-filter">Lọc</button>
    </div>
    <div id="st-result"><p class="empty">Đang tải…</p></div>`;

  const resultEl = root.querySelector<HTMLElement>("#st-result")!;

  async function reload(): Promise<void> {
    try {
      const fromEl = root.querySelector<HTMLInputElement>("#st-from")!;
      const toEl = root.querySelector<HTMLInputElement>("#st-to")!;
      const data = await api.dashboardDaily({ from: fromEl.value, to: toEl.value });
      const days = (data.days || []).map((x) => ({ d: x.date, created: x.created, completed: x.completed }));
      const tc = data.totals?.created || 0;
      const td = data.totals?.completed || 0;
      resultEl.innerHTML = `
        <div class="stat-cards">
          <div class="stat-card"><div class="stat-num">${tc}</div><div class="stat-label">Lượt tạo</div></div>
          <div class="stat-card"><div class="stat-num">${td}</div><div class="stat-label">Lượt xong</div></div>
          <div class="stat-card"><div class="stat-num">${pct(td, tc)}</div><div class="stat-label">Tỉ lệ xong</div></div>
        </div>
        <div class="card"><h3>Biểu đồ theo ngày</h3>${verticalBarChart(days)}</div>
        <div class="card"><h3>Chi tiết từng ngày</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Ngày</th><th>Tạo mới</th><th>Hoàn thành</th><th>Tỉ lệ</th></tr></thead>
            <tbody>
              ${days.map((x) => `<tr><td>${esc(x.d)}</td><td>${x.created || 0}</td><td>${x.completed || 0}</td><td>${pct(x.completed || 0, x.created || 0)}</td></tr>`).join("")}
            </tbody>
          </table></div>
        </div>`;
    } catch (e) {
      resultEl.innerHTML = `<p class="empty">Lỗi: ${esc(msg(e))}</p>`;
    }
  }

  // Mặc định 30 ngày gần nhất.
  const toEl = root.querySelector<HTMLInputElement>("#st-to")!;
  const fromEl = root.querySelector<HTMLInputElement>("#st-from")!;
  const today = new Date();
  toEl.value = today.toISOString().slice(0, 10);
  const d30 = new Date(today); d30.setDate(d30.getDate() - 29);
  fromEl.value = d30.toISOString().slice(0, 10);

  root.querySelector("#st-filter")!.addEventListener("click", reload);
  await reload();
}
