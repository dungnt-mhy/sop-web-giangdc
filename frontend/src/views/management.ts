// views/management.ts — Trang quản lý ngoại lệ và bằng chứng tổng hợp.

import { api } from "../api.js";
import { esc, toast } from "../ui.js";

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message);
  return "Lỗi không xác định.";
}

const SEV_LABEL: Record<string, string> = { LOW: "Thấp", MEDIUM: "Trung bình", HIGH: "Cao", CRITICAL: "Nghiêm trọng" };
const ST_LABEL: Record<string, string> = { OPEN: "Mới", IN_PROGRESS: "Đang xử lý", RESOLVED: "Đã khắc phục", CLOSED: "Đã đóng" };
const ST_PILL: Record<string, string> = { OPEN: "orange", IN_PROGRESS: "blue", RESOLVED: "green", CLOSED: "gray" };

/** Trang quản lý ngoại lệ (#/exceptions). */
export async function renderExceptions(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Quản lý ngoại lệ</h2>
      <p class="page-sub">Theo dõi và xử lý các sự cố phát sinh trong thực hiện công việc.</p></div>
    </div>
    <div class="filter-bar">
      <select id="exc-flt-status" class="input" aria-label="Trạng thái">
        <option value="">Tất cả trạng thái</option>
        <option value="OPEN">Mới</option>
        <option value="IN_PROGRESS">Đang xử lý</option>
        <option value="RESOLVED">Đã khắc phục</option>
        <option value="CLOSED">Đã đóng</option>
      </select>
      <select id="exc-flt-sev" class="input" aria-label="Mức độ">
        <option value="">Tất cả mức độ</option>
        <option value="LOW">Thấp</option>
        <option value="MEDIUM">Trung bình</option>
        <option value="HIGH">Cao</option>
        <option value="CRITICAL">Nghiêm trọng</option>
      </select>
      <button class="btn" id="exc-btn-filter">Lọc</button>
    </div>
    <div id="exc-list"><p class="empty">Đang tải…</p></div>`;

  const listEl = root.querySelector<HTMLElement>("#exc-list")!;
  const selStatus = root.querySelector<HTMLSelectElement>("#exc-flt-status")!;
  const selSev = root.querySelector<HTMLSelectElement>("#exc-flt-sev")!;

  async function reload(): Promise<void> {
    listEl.innerHTML = `<p class="empty">Đang tải…</p>`;
    try {
      const qs = new URLSearchParams();
      if (selStatus.value) qs.set("status", selStatus.value);
      if (selSev.value) qs.set("severity", selSev.value);
      const { items } = await api.listAllExceptions(qs.toString());
      if (items.length === 0) {
        listEl.innerHTML = `<p class="empty">Không có ngoại lệ nào.</p>`;
        return;
      }
      listEl.innerHTML = items.map((ex) => `
        <div class="exception-item" data-exid="${esc(ex.id)}">
          <div class="exception-head">
            <strong>${esc(ex.title)}</strong>
            <span class="pill ${ST_PILL[ex.status] ?? "gray"}">${esc(ST_LABEL[ex.status] ?? ex.status)}</span>
            <span class="pill gray">${esc(SEV_LABEL[ex.severity] ?? ex.severity)}</span>
          </div>
          <p class="exception-desc">${esc(ex.description)}</p>
          <div class="muted small">
            Lượt: <a href="#/executions/${esc(ex.execution_id)}">${esc((ex as unknown as Record<string, unknown>).execution_code as string ?? "—")}</a>
            ${(ex as unknown as Record<string, unknown>).execution_date ? ` · Ngày TH: ${esc(String((ex as unknown as Record<string, unknown>).execution_date))}` : ""}
            ${ex.step_code ? ` · Bước: ${esc(ex.step_code)}` : ""}
          </div>
          ${ex.resolution ? `<div class="muted small">Khắc phục: ${esc(ex.resolution)}</div>` : ""}
          <div class="muted small">Báo bởi ${esc(ex.creator_name ?? "—")} · ${esc(ex.created_at.slice(0, 16).replace("T", " "))}</div>
          <div class="exception-actions">
            <a class="btn sm" href="#/executions/${esc(ex.execution_id)}">Xem lượt</a>
            ${ex.status === "OPEN" ? `<button class="btn sm" data-act="start">Nhận xử lý</button>` : ""}
            ${["OPEN", "IN_PROGRESS"].includes(ex.status) ? `<button class="btn sm primary" data-act="resolve">Ghi nhận khắc phục</button>` : ""}
            ${ex.status === "RESOLVED" ? `<button class="btn sm" data-act="close">Đóng</button>` : ""}
          </div>
        </div>`).join("");
      listEl.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const exid = btn.closest("[data-exid]")!.getAttribute("data-exid")!;
          const act = btn.dataset.act!;
          try {
            if (act === "start") {
              await api.startException(exid);
              toast("Đã nhận xử lý.");
            } else if (act === "resolve") {
              const r = prompt("Mô tả cách khắc phục:");
              if (!r?.trim()) return;
              await api.resolveException(exid, r.trim());
              toast("Đã ghi nhận khắc phục.");
            } else if (act === "close") {
              await api.closeException(exid);
              toast("Đã đóng.");
            }
            await reload();
          } catch (e) { toast(`Lỗi: ${msg(e)}`); }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#exc-btn-filter")!.addEventListener("click", reload);
  await reload();
}

/** Trang quản lý bằng chứng (#/evidence). */
export async function renderEvidence(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Quản lý bằng chứng</h2>
      <p class="page-sub">Tất cả ảnh và tệp bằng chứng đã tải lên.</p></div>
    </div>
    <div class="filter-bar">
      <select id="ev-flt-kind" class="input" aria-label="Loại">
        <option value="">Tất cả loại</option>
        <option value="PHOTO">Ảnh</option>
        <option value="FILE">Tệp</option>
      </select>
      <input type="date" id="ev-flt-date" class="input" aria-label="Từ ngày" />
      <button class="btn" id="ev-btn-filter">Lọc</button>
    </div>
    <div id="ev-list"><p class="empty">Đang tải…</p></div>`;

  const listEl = root.querySelector<HTMLElement>("#ev-list")!;
  const selKind = root.querySelector<HTMLSelectElement>("#ev-flt-kind")!;
  const inpDate = root.querySelector<HTMLInputElement>("#ev-flt-date")!;

  async function reload(): Promise<void> {
    listEl.innerHTML = `<p class="empty">Đang tải…</p>`;
    try {
      const qs = new URLSearchParams();
      if (selKind.value) qs.set("kind", selKind.value);
      if (inpDate.value) qs.set("from_date", inpDate.value);
      const { items } = await api.listAllEvidence(qs.toString());
      if (items.length === 0) {
        listEl.innerHTML = `<p class="empty">Chưa có bằng chứng nào.</p>`;
        return;
      }
      listEl.innerHTML = `<div class="evidence-manage-grid">` + items.map((ev: Record<string, unknown>) => {
        const isPhoto = ev.kind === "PHOTO";
        return `
        <div class="evidence-manage-item">
          ${isPhoto
            ? `<img src="${esc(api.evidenceDownloadUrl(String(ev.id)))}" alt="${esc(String(ev.original_name))}" loading="lazy" />`
            : `<div class="evidence-file-icon">📄</div>`}
          <div class="evidence-manage-info">
            <strong class="evidence-manage-name">${esc(String(ev.original_name))}</strong>
            <div class="muted small">${isPhoto ? "Ảnh" : "Tệp"} · ${formatBytes(Number(ev.size_bytes))}</div>
            <div class="muted small">Lượt: <a href="#/executions/${esc(String(ev.execution_id))}">${esc(String(ev.execution_code ?? "—"))}</a>
              ${ev.step_code ? ` · ${esc(String(ev.step_code))}` : ""}</div>
            <div class="muted small">${esc(String(ev.uploader_name ?? "—"))} · ${esc(String(ev.created_at).slice(0, 16).replace("T", " "))}</div>
            <a class="link small" href="${esc(api.evidenceDownloadUrl(String(ev.id)))}" target="_blank" rel="noopener">Xem / Tải</a>
          </div>
        </div>`;
      }).join("") + `</div>`;
    } catch (e) {
      listEl.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#ev-btn-filter")!.addEventListener("click", reload);
  await reload();
}

function formatBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
