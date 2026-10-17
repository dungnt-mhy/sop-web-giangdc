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

  tbody.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    const tr = (ev.target as HTMLElement).closest("tr");
    if (!tr?.dataset.id) return;
    const id = tr.dataset.id;
    // Nút "Chi tiết" → trang chi tiết đầy đủ.
    if (btn?.dataset.act === "view") {
      location.hash = "#/processes/" + id;
      return;
    }
    // Nhấn vào dòng (không phải nút) → mở sơ đồ ngay.
    if (!(ev.target as HTMLElement).closest("button")) {
      await openProcessDiagram(dialogRoot, id);
    }
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

/** Modal sơ đồ quy trình — mở ngay khi nhấn vào dòng quy trình ở danh mục. */
async function openProcessDiagram(dialogRoot: HTMLElement, processId: string): Promise<void> {
  dialogRoot.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="dialog diagram-dialog" role="dialog" aria-modal="true" aria-label="Sơ đồ quy trình">
      <div class="diagram-header">
        <div><h3 id="dg-name">Đang tải…</h3><p class="muted small" id="dg-sub"></p></div>
        <button class="btn icon-btn" id="dg-close" aria-label="Đóng">✕</button>
      </div>
      <div id="dg-body"><p class="empty">Đang tải sơ đồ…</p></div>
      <div class="dialog-actions">
        <button class="btn" id="dg-detail">Xem chi tiết</button>
      </div>
    </div>`;
  const close = () => {
    dialogRoot.innerHTML = "";
  };
  dialogRoot.querySelector("#dg-close")!.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-scrim")!.addEventListener("click", close);
  dialogRoot.querySelector("#dg-detail")!.addEventListener("click", () => {
    close();
    location.hash = "#/processes/" + processId;
  });

  try {
    const p = await api.getProcess(processId);
    // Ưu tiên bản đang hiệu lực, nếu không có thì lấy bản mới nhất.
    const sorted = [...p.versions].sort((a, b) => b.version_number - a.version_number);
    const ver = sorted.find((v) => v.status === "ACTIVE") ?? sorted[0];
    dialogRoot.querySelector("#dg-name")!.textContent = p.name;
    const verLabel = ver ? `v${ver.version_number} — ${STATUS_LABELS[ver.status] ?? ver.status}` : "Chưa có phiên bản";
    dialogRoot.querySelector("#dg-sub")!.textContent = `Mã: ${p.code} · ${verLabel}`;
    const body = dialogRoot.querySelector("#dg-body")!;
    if (!ver) {
      body.innerHTML = `<p class="empty">Quy trình chưa có phiên bản nào.</p>`;
      return;
    }
    const { items } = await api.listSteps(ver.id);
    if (items.length === 0) {
      body.innerHTML = `<p class="empty">Phiên bản ${verLabel} chưa có bước nào.</p>`;
      return;
    }
    body.innerHTML = renderBeautifulDiagram(items, p.name);
  } catch (e) {
    dialogRoot.querySelector("#dg-body")!.innerHTML =
      `<p class="empty">Không tải được sơ đồ: ${esc(msg(e))}</p>`;
  }
}

/** Vẽ sơ đồ đẹp — gradient, bóng đổ, hiệu ứng. */
function renderBeautifulDiagram(items: import("../api.js").ProcessStep[], processName: string): string {
  return `
    <div class="beauty-diagram" role="img" aria-label="Sơ đồ quy trình ${esc(processName)}">
      <div class="beauty-start"><span>▶</span> Bắt đầu</div>
      ${items.map((st, idx) => `
        <div class="beauty-connector" aria-hidden="true"><span class="beauty-line"></span><span class="beauty-dot"></span></div>
        <div class="beauty-node${st.is_required ? "" : " optional"}" style="--i:${idx}">
          <div class="beauty-num">${idx + 1}</div>
          <div class="beauty-content">
            <div class="beauty-code">${esc(st.code)}${st.is_required ? "" : ' <span class="pill gray">Tùy chọn</span>'}</div>
            <div class="beauty-title">${esc(st.title)}</div>
            ${st.role ? `<div class="beauty-role">👤 ${esc(st.role)}</div>` : ""}
            ${st.target_duration_min ? `<div class="beauty-time">⏱ ~${st.target_duration_min} phút</div>` : ""}
          </div>
        </div>`).join("")}
      <div class="beauty-connector" aria-hidden="true"><span class="beauty-line"></span><span class="beauty-dot"></span></div>
      <div class="beauty-end"><span>■</span> Kết thúc</div>
    </div>`;
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
  // Giữ dữ liệu quy trình hiện tại để handler click dùng (tránh closure cũ).
  let current: import("../api.js").SopProcessDetail | null = null;

  async function reload(): Promise<void> {
    try {
      const p = await api.getProcess(processId);
      current = p;
      root.querySelector("#pd-name")!.textContent = p.name;
      root.querySelector("#pd-code")!.textContent = `Mã: ${p.code}`;
      body.innerHTML = detailHtml(p);
      renderVersionButtons(body, canManage, canApprove);
    } catch (e) {
      body.innerHTML = `<p class="empty">Không tải được quy trình: ${esc(msg(e))}</p>`;
    }
  }

  // Gắn listener MỘT LẦN duy nhất (tránh trùng lặp khi reload).
  body.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-v]");
    if (!btn || !current) return;
    const tr = btn.closest("tr") as HTMLTableRowElement;
    const vid = tr.dataset.vid!;
    const act = btn.dataset.v!;
    const v = current.versions.find((x) => x.id === vid);
    const label = `v${v?.version_number ?? "?"}`;
    const restore = setLoading(btn, true, "…");
    try {
      if (act === "steps") {
        restore();
        await toggleSteps(body, dialogRoot, vid, current, canManage);
        return;
      }
      if (act === "submit") await api.submitVersion(vid);
      else if (act === "approve") await api.approveVersion(vid);
      else if (act === "return") await api.returnVersion(vid);
      else if (act === "activate") await api.activateVersion(vid);
      else if (act === "retire") {
        restore();
        openConfirmDialog(
          dialogRoot,
          `Ngừng phiên bản ${label}?`,
          "Phiên bản ngừng sẽ không dùng cho lượt mới.",
          async () => {
            try {
              await api.retireVersion(vid);
              toast(`Đã ngừng phiên bản ${label}.`);
              await reload();
            } catch (e) {
              toast(`Lỗi: ${msg(e)}`);
            }
          }
        );
        return;
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
      restore();
    }
  });

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
          </tr>
          <tr class="steps-row" data-steps-for="${esc(v.id)}" hidden>
            <td colspan="4"><div class="steps-container" data-steps-container></div></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table></div>
    </section>`;
}

/** Vẽ nút thao tác cho từng phiên bản theo trạng thái + quyền (không gắn listener). */
function renderVersionButtons(body: HTMLElement, canManage: boolean, canApprove: boolean): void {
  const rows = Array.from(body.querySelectorAll("tr[data-vid]")) as HTMLTableRowElement[];
  for (const tr of rows) {
    const status = tr.dataset.status!;
    const cell = tr.querySelector("[data-vact]") as HTMLElement;
    const btns: string[] = [];
    // Nút xem bước — mọi phiên bản đều xem được.
    btns.push(`<button class="link" data-v="steps"><span>Bước</span></button>`);
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

/** Vẽ sơ đồ tuyến tính chỉ đọc cho các bước (PRC-010). */
function renderStepDiagram(items: import("../api.js").ProcessStep[]): string {
  return `
    <div class="flow-diagram" role="img" aria-label="Sơ đồ quy trình ${items.length} bước">
      <div class="flow-start">Bắt đầu</div>
      ${items.map((st, idx) => `
        ${idx > 0 ? `<div class="flow-arrow" aria-hidden="true">↓</div>` : ""}
        <div class="flow-node${st.is_required ? "" : " optional"}">
          <div class="flow-node-head">
            <span class="flow-num">${idx + 1}</span>
            <strong>${esc(st.code)}</strong>
            ${st.is_required ? "" : '<span class="pill gray">Tùy chọn</span>'}
          </div>
          <div class="flow-title">${esc(st.title)}</div>
          ${st.role ? `<div class="flow-meta">Vai trò: ${esc(st.role)}</div>` : ""}
          ${st.target_duration_min ? `<div class="flow-meta">~${st.target_duration_min} phút</div>` : ""}
        </div>`).join("")}
      <div class="flow-arrow" aria-hidden="true">↓</div>
      <div class="flow-end">Kết thúc</div>
    </div>`;
}

/** Bật/tắt hiển thị danh sách bước của một phiên bản. */
async function toggleSteps(
  body: HTMLElement,
  dialogRoot: HTMLElement,
  versionId: string,
  current: import("../api.js").SopProcessDetail | null,
  canManage: boolean
): Promise<void> {
  const row = body.querySelector(`tr[data-steps-for="${versionId}"]`) as HTMLTableRowElement | null;
  if (!row) return;
  const container = row.querySelector("[data-steps-container]") as HTMLElement;
  // Nếu đang hiện thì ẩn đi.
  if (!row.hidden && container.dataset.loaded === "1") {
    row.hidden = true;
    return;
  }
  const v = current?.versions.find((x) => x.id === versionId);
  const isDraft = v?.status === "DRAFT";
  const editable = isDraft && canManage;

  row.hidden = false;
  container.dataset.loaded = "1";
  container.innerHTML = `<p class="empty">Đang tải bước…</p>`;
  try {
    const { items } = await api.listSteps(versionId);
    if (items.length === 0) {
      container.innerHTML = `
        <p class="empty">Chưa có bước nào.</p>
        ${editable ? `<p><button class="btn primary" data-step-act="add">+ Thêm bước</button></p>` : ""}`;
    } else {
      container.innerHTML = `
        <div class="steps-toolbar">
          ${editable ? `<button class="btn primary" data-step-act="add">+ Thêm bước</button>` : ""}
          <div class="view-toggle" role="tablist" aria-label="Chế độ xem">
            <button class="toggle-btn active" data-view="list">Danh sách</button>
            <button class="toggle-btn" data-view="diagram">Sơ đồ</button>
          </div>
        </div>
        <div data-steps-list>
        <ol class="step-list">
          ${items.map((st, idx) => `
            <li data-sid="${esc(st.id)}">
              <div class="step-head">
                <span class="step-num">${idx + 1}</span>
                <div class="step-title">
                  <strong>${esc(st.code)}</strong> — ${esc(st.title)}
                  ${st.is_required ? "" : ' <span class="pill gray">Tùy chọn</span>'}
                  ${st.role ? `<div class="muted small">Vai trò: ${esc(st.role)}</div>` : ""}
                </div>
                ${editable ? `<div class="step-actions">
                  <button class="link sm" data-step-act="up" title="Lên" ${idx === 0 ? "disabled" : ""}>↑</button>
                  <button class="link sm" data-step-act="down" title="Xuống" ${idx === items.length - 1 ? "disabled" : ""}>↓</button>
                  <button class="link sm" data-step-act="edit"><span>Sửa</span></button>
                  <button class="link sm" data-step-act="copy"><span>Sao chép</span></button>
                  <button class="link sm danger" data-step-act="del"><span>Xóa</span></button>
                </div>` : ""}
              </div>
              ${st.instruction ? `<p class="step-instr">${esc(st.instruction)}</p>` : ""}
            </li>`).join("")}
        </ol>
        </div>
        <div data-steps-diagram hidden>
          ${renderStepDiagram(items)}
        </div>`;
      // Xử lý chuyển đổi chế độ xem.
      const toggleBtns = container.querySelectorAll<HTMLButtonElement>(".toggle-btn");
      const listView = container.querySelector("[data-steps-list]") as HTMLElement;
      const diagramView = container.querySelector("[data-steps-diagram]") as HTMLElement;
      toggleBtns.forEach((tb) => {
        tb.addEventListener("click", () => {
          toggleBtns.forEach((x) => x.classList.remove("active"));
          tb.classList.add("active");
          const isDiagram = tb.dataset.view === "diagram";
          listView.hidden = isDiagram;
          diagramView.hidden = !isDiagram;
        });
      });
    }
    const refresh = async (): Promise<void> => {
      container.dataset.loaded = "";
      row.hidden = true;
      await toggleSteps(body, dialogRoot, versionId, current, canManage);
    };
    container.onclick = async (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-step-act]");
      if (!b) return;
      const act = b.dataset.stepAct!;
      if (act === "add") {
        openStepDialog(dialogRoot, versionId, null, refresh);
        return;
      }
      const li = b.closest("li") as HTMLLIElement;
      const sid = li.dataset.sid!;
      const step = items.find((x) => x.id === sid);
      if (act === "edit") {
        openStepDialog(dialogRoot, versionId, step ?? null, refresh);
      } else if (act === "copy") {
        try {
          await api.copyStep(versionId, sid);
          toast("Đã sao chép bước.");
          refresh();
        } catch (e) {
          toast(`Lỗi: ${msg(e)}`);
        }
      } else if (act === "del") {
        openConfirmDialog(dialogRoot, `Xóa bước "${step?.code}"?`, "Hành động này không thể hoàn tác.", async () => {
          try {
            await api.deleteStep(versionId, sid);
            toast("Đã xóa bước.");
            refresh();
          } catch (e) {
            toast(`Lỗi: ${msg(e)}`);
          }
        });
      } else if (act === "up" || act === "down") {
        const idx = items.findIndex((x) => x.id === sid);
        const newIdx = act === "up" ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= items.length) return;
        const ids = items.map((x) => x.id);
        [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
        try {
          await api.reorderSteps(versionId, ids);
          refresh();
        } catch (e) {
          toast(`Lỗi: ${msg(e)}`);
        }
      }
    };
  } catch (e) {
    container.innerHTML = `<p class="empty">Không tải được bước: ${esc(msg(e))}</p>`;
  }
}

/** Dialog xác nhận tùy chỉnh (không dùng window.confirm). */
function openConfirmDialog(
  dialogRoot: HTMLElement,
  title: string,
  message: string,
  onConfirm: () => void
): void {
  dialogRoot.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      <div class="dialog-actions">
        <button type="button" class="btn" id="cf-cancel">Huỷ</button>
        <button type="button" class="btn danger" id="cf-ok">Xóa</button>
      </div>
    </div>`;
  const close = () => {
    dialogRoot.innerHTML = "";
  };
  dialogRoot.querySelector("#cf-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-scrim")!.addEventListener("click", close);
  dialogRoot.querySelector("#cf-ok")!.addEventListener("click", () => {
    close();
    onConfirm();
  });
}

/** Dialog thêm/sửa bước (PRC-005). */
function openStepDialog(
  dialogRoot: HTMLElement,
  versionId: string,
  step: import("../api.js").ProcessStep | null,
  onDone: () => void
): void {
  const isEdit = !!step;
  const val = (v: string | null | undefined) => esc(v ?? "");
  dialogRoot.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="dialog wide" role="dialog" aria-modal="true" aria-label="${isEdit ? "Sửa bước" : "Thêm bước"}">
      <h3>${isEdit ? "Sửa bước" : "Thêm bước mới"}</h3>
      <form id="step-form" novalidate>
        <div class="form-grid">
          <label>Mã bước <span class="req">*</span>
            <input class="input" name="code" required maxlength="32" value="${val(step?.code)}" style="text-transform:uppercase" /></label>
          <label>Vai trò thực hiện <input class="input" name="role" maxlength="100" value="${val(step?.role)}"
            placeholder="VD: Thủ kho" /></label>
        </div>
        <label>Tiêu đề hành động <span class="req">*</span>
          <input class="input" name="title" required maxlength="200" value="${val(step?.title)}"
            placeholder="VD: Kiểm tra nhiệt độ kho" /></label>
        <label>Hướng dẫn thực hiện
          <textarea class="input" name="instruction" rows="3">${val(step?.instruction)}</textarea></label>
        <div class="form-grid">
          <label>Điều kiện tiên quyết <textarea class="input" name="prerequisite" rows="2">${val(step?.prerequisite)}</textarea></label>
          <label>Kết quả mong đợi <textarea class="input" name="expected_result" rows="2">${val(step?.expected_result)}</textarea></label>
        </div>
        <div class="form-grid">
          <label>Đầu vào <textarea class="input" name="input_desc" rows="2">${val(step?.input_desc)}</textarea></label>
          <label>Đầu ra / bàn giao <textarea class="input" name="output_desc" rows="2">${val(step?.output_desc)}</textarea></label>
        </div>
        <label>Ghi chú <textarea class="input" name="note" rows="2">${val(step?.note)}</textarea></label>
        <div class="form-grid">
          <label>Thời lượng mục tiêu (phút)
            <input class="input" name="target_duration_min" type="number" min="0" step="1"
              value="${step?.target_duration_min ?? ""}" /></label>
          <label class="check"><input type="checkbox" name="is_required" ${step?.is_required !== false ? "checked" : ""} />
            Bước bắt buộc</label>
        </div>
        <label>Cảnh báo <input class="input" name="warning" maxlength="500" value="${val(step?.warning)}"
          placeholder="VD: Cẩn thận hàng dễ vỡ" /></label>
        <p class="form-error" id="step-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn" id="step-cancel">Huỷ</button>
          <button type="submit" class="btn primary" id="step-submit">${isEdit ? "Lưu" : "Thêm bước"}</button>
        </div>
      </form>
    </div>`;
  const close = () => {
    dialogRoot.innerHTML = "";
  };
  dialogRoot.querySelector("#step-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-scrim")!.addEventListener("click", close);

  const form = dialogRoot.querySelector<HTMLFormElement>("#step-form")!;
  const errEl = dialogRoot.querySelector<HTMLElement>("#step-error")!;
  const submitBtn = dialogRoot.querySelector<HTMLButtonElement>("#step-submit")!;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errEl.hidden = true;
    const fd = new FormData(form);
    const input: Record<string, unknown> = {
      code: String(fd.get("code") ?? "").trim(),
      title: String(fd.get("title") ?? "").trim(),
      is_required: fd.get("is_required") === "on",
    };
    for (const k of ["prerequisite", "input_desc", "instruction", "expected_result", "output_desc", "note", "role", "warning"]) {
      const s = String(fd.get(k) ?? "").trim();
      if (s) input[k] = s;
    }
    const dur = String(fd.get("target_duration_min") ?? "").trim();
    if (dur) input.target_duration_min = parseInt(dur, 10);
    setLoading(submitBtn, true, isEdit ? "Đang lưu…" : "Đang thêm…");
    try {
      if (isEdit) {
        await api.patchStep(versionId, step!.id, input);
        toast("Đã lưu bước.");
      } else {
        await api.createStep(versionId, input);
        toast("Đã thêm bước.");
      }
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

export { STATUS_LABELS };
