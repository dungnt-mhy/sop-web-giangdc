// views/processes.ts — danh mục quy trình + phiên bản (Task 1.4).
// Khớp SRS v1.6: PRC-001–003; §7.1 (máy trạng thái ProcessVersion); AC-01, AC-02.

import { api, type ProcessVersion, type SopProcess } from "../api.js";
import { esc, setLoading, toast } from "../ui.js";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Bản nháp",
  IN_REVIEW: "Đang thẩm định",
  APPROVED: "Đã duyệt",
  SCHEDULED: "Chờ hiệu lực",
  ACTIVE: "Đang hiệu lực",
  SUPERSEDED: "Đã thay thế",
  RETIRED: "Đã ngừng",
};

const STATUS_PILL: Record<string, string> = {
  DRAFT: "gray",
  IN_REVIEW: "amber",
  APPROVED: "blue",
  SCHEDULED: "blue",
  ACTIVE: "green",
  SUPERSEDED: "gray",
  RETIRED: "red",
};

function statusPill(status: string): string {
  const cls = STATUS_PILL[status] ?? "gray";
  return `<span class="pill ${cls}">${esc(STATUS_LABELS[status] ?? status)}</span>`;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "lỗi không xác định";
}

/** Trang danh sách quy trình (#/processes). */
export async function renderProcesses(root: HTMLElement, canManage: boolean): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Danh mục quy trình</h2>
      <p class="page-sub">Khai báo quy trình, quản lý phiên bản và phê duyệt phát hành.</p></div>
      ${canManage ? `<button class="btn primary" id="btn-create">+ Tạo quy trình</button>` : ""}
    </div>
    <div class="filter-bar">
      <input type="search" id="flt-q" class="input" placeholder="Tìm theo mã hoặc tên…" aria-label="Tìm kiếm" />
      <button class="btn" id="btn-search">Tìm</button>
    </div>
    <div class="table-wrap"><table class="tbl" id="proc-table">
      <thead><tr>
        <th>Mã</th><th>Tên quy trình</th><th>Nhóm</th><th>Phiên bản hiệu lực</th><th>Thao tác</th>
      </tr></thead>
      <tbody><tr><td colspan="5" class="empty">Đang tải…</td></tr></tbody>
    </table></div>
    <div id="proc-dialog-root"></div>`;

  const tbody = root.querySelector<HTMLTableSectionElement>("#proc-table tbody")!;
  const dialogRoot = root.querySelector<HTMLElement>("#proc-dialog-root")!;
  const inputQ = root.querySelector<HTMLInputElement>("#flt-q")!;

  async function reload(): Promise<void> {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Đang tải…</td></tr>`;
    try {
      const { items } = await api.listProcesses({ q: inputQ.value.trim() || undefined });
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty">Chưa có quy trình nào.</td></tr>`;
        return;
      }
      tbody.innerHTML = items.map(rowHtml).join("");
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Không tải được danh sách: ${esc(msg(e))}</td></tr>`;
    }
  }

  tbody.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (!btn) return;
    const id = btn.closest("tr")!.dataset.id!;
    if (btn.dataset.act === "view") location.hash = "#/processes/" + id;
  });

  const doSearch = () => reload();
  root.querySelector("#btn-search")!.addEventListener("click", doSearch);
  inputQ.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") doSearch();
  });

  root.querySelector("#btn-create")?.addEventListener("click", () => {
    openProcessDialog(dialogRoot, reload);
  });

  await reload();
}

function rowHtml(p: SopProcess): string {
  const av = p.active_version;
  return `<tr data-id="${esc(p.id)}">
    <td><strong>${esc(p.code)}</strong></td>
    <td>${esc(p.name)}${p.group_name ? `<div class="muted small">${esc(p.group_name)}</div>` : ""}</td>
    <td>${p.group_name ? esc(p.group_name) : '<span class="muted">—</span>'}</td>
    <td>${av ? `v${av.version_number} ${statusPill(av.status)}` : '<span class="muted">Chưa có</span>'}</td>
    <td class="actions"><button class="link" data-act="view"><span>Chi tiết</span></button></td>
  </tr>`;
}

/** Dialog tạo quy trình mới (PRC-001). */
function openProcessDialog(dialogRoot: HTMLElement, onDone: () => void): void {
  dialogRoot.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Tạo quy trình">
      <h3>Tạo quy trình mới</h3>
      <form id="proc-form" novalidate>
        <label>Mã quy trình <span class="req">*</span>
          <input class="input" name="code" required maxlength="32" placeholder="VD: XUAT-HANG-DL" style="text-transform:uppercase" />
          <span class="hint">2–32 ký tự: chữ, số, dấu . _ -</span></label>
        <label>Tên quy trình <span class="req">*</span>
          <input class="input" name="name" required maxlength="200" placeholder="VD: Xuất hàng đến đại lý" /></label>
        <label>Nhóm <input class="input" name="group_name" maxlength="100" placeholder="VD: Kho vận" /></label>
        <label>Mục đích <textarea class="input" name="purpose" rows="2"></textarea></label>
        <label>Phạm vi áp dụng <textarea class="input" name="scope" rows="2"></textarea></label>
        <label>Đơn vị áp dụng <input class="input" name="applying_unit" maxlength="200" /></label>
        <p class="form-error" id="proc-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn" id="proc-cancel">Huỷ</button>
          <button type="submit" class="btn primary" id="proc-submit">Tạo quy trình</button>
        </div>
      </form>
    </div>`;

  const close = () => {
    dialogRoot.innerHTML = "";
  };
  dialogRoot.querySelector("#proc-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-scrim")!.addEventListener("click", close);

  const form = dialogRoot.querySelector<HTMLFormElement>("#proc-form")!;
  const errEl = dialogRoot.querySelector<HTMLElement>("#proc-error")!;
  const submitBtn = dialogRoot.querySelector<HTMLButtonElement>("#proc-submit")!;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errEl.hidden = true;
    const fd = new FormData(form);
    const input: Record<string, unknown> = {};
    for (const k of ["code", "name", "group_name", "purpose", "scope", "applying_unit"]) {
      const s = String(fd.get(k) ?? "").trim();
      if (s) input[k] = s;
    }
    setLoading(submitBtn, true, "Đang tạo…");
    try {
      await api.createProcess(input);
      toast("Đã tạo quy trình.");
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
      setLoading(submitBtn, false, "");
    }
  });
  dialogRoot.querySelector<HTMLInputElement>('input[name="code"]')!.focus();
}

/** Trang chi tiết quy trình (#/processes/{id}) — thông tin + danh sách phiên bản. */
export async function renderProcessDetail(
  root: HTMLElement,
  processId: string,
  perms: string[]
): Promise<void> {
  const canManage = perms.includes("*") || perms.includes("processes.manage");
  const canApprove = perms.includes("*") || perms.includes("processes.approve");

  root.innerHTML = `
    <div class="page-head">
      <div><a href="#/processes" class="link back">← Danh mục quy trình</a>
      <h2 id="pd-name">Đang tải…</h2>
      <p class="page-sub" id="pd-code"></p></div>
      <div class="head-actions">
        ${canManage ? `<button class="btn" id="btn-new-version">+ Tạo phiên bản mới</button>` : ""}
      </div>
    </div>
    <div id="pd-body"><p class="empty">Đang tải…</p></div>
    <div id="proc-dialog-root"></div>`;

  const body = root.querySelector<HTMLElement>("#pd-body")!;
  const dialogRoot = root.querySelector<HTMLElement>("#proc-dialog-root")!;

  async function reload(): Promise<void> {
    try {
      const p = await api.getProcess(processId);
      root.querySelector("#pd-name")!.textContent = p.name;
      root.querySelector("#pd-code")!.textContent = `Mã: ${p.code}`;
      body.innerHTML = detailHtml(p);
      wireVersions(body, dialogRoot, p, canManage, canApprove, reload);
    } catch (e) {
      body.innerHTML = `<p class="empty">Không tải được quy trình: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#btn-new-version")?.addEventListener("click", () => {
    openVersionDialog(dialogRoot, processId, reload);
  });

  await reload();
}

function detailHtml(p: import("../api.js").SopProcessDetail): string {
  const info = (label: string, value: string | null) =>
    value ? `<div class="info-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "";
  return `
    <section class="card">
      <h3>Thông tin quy trình</h3>
      <dl class="info-list">
        ${info("Mục đích", p.purpose)}
        ${info("Phạm vi", p.scope)}
        ${info("Đối tượng áp dụng", p.applicable_objects)}
        ${info("Điều kiện bắt đầu", p.start_condition)}
        ${info("Điều kiện kết thúc", p.end_condition)}
        ${info("Đơn vị áp dụng", p.applying_unit)}
        ${info("Kích hoạt xem xét lại", p.review_trigger)}
        ${info("Nhóm", p.group_name)}
      </dl>
    </section>
    <section class="card">
      <h3>Phiên bản (${p.versions.length})</h3>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Hiệu lực từ</th><th>Thao tác</th></tr></thead>
        <tbody>
          ${p.versions
            .map(
              (v) => `<tr data-vid="${esc(v.id)}" data-status="${esc(v.status)}">
            <td><strong>v${v.version_number}</strong>${
              v.change_summary ? `<div class="muted small">${esc(v.change_summary)}</div>` : ""
            }</td>
            <td>${statusPill(v.status)}</td>
            <td>${v.effective_from ? esc(v.effective_from.slice(0, 10)) : '<span class="muted">—</span>'}</td>
            <td class="actions" data-vact></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table></div>
    </section>`;
}

/** Gắn nút thao tác cho từng phiên bản theo trạng thái + quyền. */
function wireVersions(
  body: HTMLElement,
  dialogRoot: HTMLElement,
  p: import("../api.js").SopProcessDetail,
  canManage: boolean,
  canApprove: boolean,
  reload: () => void
): void {
  const rows = Array.from(body.querySelectorAll("tr[data-vid]")) as HTMLTableRowElement[];
  for (const tr of rows) {
    const vid = tr.dataset.vid!;
    const status = tr.dataset.status!;
    const cell = tr.querySelector("[data-vact]") as HTMLElement;
    const btns: string[] = [];
    if (status === "DRAFT" && canManage) {
      btns.push(`<button class="link" data-v="submit"><span>Gửi duyệt</span></button>`);
    }
    if (status === "IN_REVIEW" && canApprove) {
      btns.push(`<button class="link" data-v="approve"><span>Duyệt</span></button>`);
      btns.push(`<button class="link danger" data-v="return"><span>Trả sửa</span></button>`);
    }
    if ((status === "APPROVED" || status === "SCHEDULED") && canApprove) {
      btns.push(`<button class="link" data-v="activate"><span>Kích hoạt</span></button>`);
    }
    if ((status === "ACTIVE" || status === "SUPERSEDED") && canApprove) {
      btns.push(`<button class="link danger" data-v="retire"><span>Ngừng</span></button>`);
    }
    cell.innerHTML = btns.join("") || '<span class="muted">—</span>';
  }

  body.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-v]");
    if (!btn) return;
    const tr = btn.closest("tr")!;
    const vid = tr.dataset.vid!;
    const act = btn.dataset.v!;
    const v = p.versions.find((x) => x.id === vid);
    const label = `v${v?.version_number ?? "?"}`;
    setLoading(btn, true, "…");
    try {
      if (act === "submit") await api.submitVersion(vid);
      else if (act === "approve") await api.approveVersion(vid);
      else if (act === "return") await api.returnVersion(vid);
      else if (act === "activate") await api.activateVersion(vid);
      else if (act === "retire") {
        if (!confirm(`Ngừng phiên bản ${label}? Phiên bản ngừng sẽ không dùng cho lượt mới.`)) {
          setLoading(btn, false, "");
          return;
        }
        await api.retireVersion(vid);
      }
      const names: Record<string, string> = {
        submit: "gửi duyệt",
        approve: "duyệt",
        return: "trả sửa",
        activate: "kích hoạt",
        retire: "ngừng",
      };
      toast(`Đã ${names[act]} phiên bản ${label}.`);
      await reload();
    } catch (e) {
      toast(`Lỗi: ${msg(e)}`);
      setLoading(btn, false, "");
    }
  });
}

/** Dialog tạo phiên bản mới từ bản mới nhất (PRC-003). */
function openVersionDialog(dialogRoot: HTMLElement, processId: string, onDone: () => void): void {
  dialogRoot.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Tạo phiên bản mới">
      <h3>Tạo phiên bản mới</h3>
      <form id="ver-form" novalidate>
        <label>Tóm tắt thay đổi
          <textarea class="input" name="change_summary" rows="3" placeholder="VD: Bổ sung bước kiểm tra nhiệt độ kho"></textarea></label>
        <p class="form-error" id="ver-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn" id="ver-cancel">Huỷ</button>
          <button type="submit" class="btn primary" id="ver-submit">Tạo bản nháp</button>
        </div>
      </form>
      <p class="hint">Phiên bản mới sao chép từ bản mới nhất và bắt đầu ở trạng thái Bản nháp.</p>
    </div>`;
  const close = () => {
    dialogRoot.innerHTML = "";
  };
  dialogRoot.querySelector("#ver-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-scrim")!.addEventListener("click", close);
  const form = dialogRoot.querySelector<HTMLFormElement>("#ver-form")!;
  const errEl = dialogRoot.querySelector<HTMLElement>("#ver-error")!;
  const submitBtn = dialogRoot.querySelector<HTMLButtonElement>("#ver-submit")!;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errEl.hidden = true;
    const fd = new FormData(form);
    const change_summary = String(fd.get("change_summary") ?? "").trim() || undefined;
    setLoading(submitBtn, true, "Đang tạo…");
    try {
      await api.createVersion(processId, change_summary);
      toast("Đã tạo phiên bản mới.");
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
      setLoading(submitBtn, false, "");
    }
  });
}

export { STATUS_LABELS };
