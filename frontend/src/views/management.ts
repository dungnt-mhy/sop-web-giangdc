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

/** Trang quản lý vai trò ứng dụng (#/roles) — phân quyền qua checkbox. */
export async function renderRoles(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Vai trò ứng dụng</h2>
      <p class="page-sub">Vai trò quyết định ai được làm gì trong app. Khác với <strong>Chức vụ</strong> (làm gì ở công ty).</p></div>
      <button class="btn primary" id="role-add">+ Thêm vai trò</button>
    </div>
    <div id="role-list"><p class="empty">Đang tải…</p></div>
    <div id="role-dialog-root"></div>`;

  const listEl = root.querySelector<HTMLElement>("#role-list")!;
  const dialogRoot = root.querySelector<HTMLElement>("#role-dialog-root")!;

  async function reload(): Promise<void> {
    try {
      const { items, catalog } = await api.listRoles();
      if (items.length === 0) {
        listEl.innerHTML = `<p class="empty">Chưa có vai trò nào.</p>`;
        return;
      }
      const permLabel = (code: string) => catalog.find((c) => c.code === code)?.label ?? code;
      listEl.innerHTML = `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Tên vai trò</th><th>Quyền</th><th style="width:120px"></th></tr></thead>
        <tbody>${items.map((r) => `
          <tr data-id="${esc(r.id)}">
            <td><strong>${esc(r.name)}</strong>${r.is_system ? ` <span class="pill">Hệ thống</span>` : ""}
              ${r.description ? `<div class="muted small">${esc(r.description)}</div>` : ""}</td>
            <td class="small">${r.permissions.includes("*") ? "<strong>Toàn quyền</strong>" : r.permissions.map((p) => `<span class="pill">${esc(permLabel(p))}</span>`).join(" ") || `<span class="muted">—</span>`}</td>
            <td class="actions">
              <button class="btn sm" data-act="edit">Sửa</button>
              ${r.is_system ? "" : `<button class="btn sm danger" data-act="del">Xoá</button>`}
            </td>
          </tr>`).join("")}
        </tbody></table></div>`;
      listEl.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.closest("tr")!.dataset.id!;
          const item = items.find((x) => x.id === id)!;
          if (btn.dataset.act === "edit") openRoleDialog(dialogRoot, item, catalog, reload);
          else if (btn.dataset.act === "del") {
            if (confirm(`Xoá vai trò "${item.name}"?`)) {
              api.deleteRole(id).then(() => { toast("Đã xoá."); reload(); })
                .catch((e) => toast(`Lỗi: ${msg(e)}`));
            }
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#role-add")!.addEventListener("click", async () => {
    const { catalog } = await api.listRoles();
    openRoleDialog(dialogRoot, null, catalog, reload);
  });
  await reload();
}

function openRoleDialog(
  dialogRoot: HTMLElement,
  existing: { id: string; name: string; description: string | null; permissions: string[] } | null,
  catalog: { code: string; label: string; group: string }[],
  onDone: () => void
): void {
  // Nhóm quyền theo group.
  const groups = new Map<string, { code: string; label: string }[]>();
  for (const c of catalog) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }
  const currentPerms = new Set(existing?.permissions ?? []);

  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" style="max-width:560px">
        <h3>${existing ? "Sửa vai trò" : "Thêm vai trò"}</h3>
        <form id="role-form">
          <label>Tên vai trò <span class="req">*</span>
            <input class="input" name="name" required maxlength="100" value="${existing ? esc(existing.name) : ""}" placeholder="VD: Thủ kho kho A" /></label>
          <label>Mô tả <input class="input" name="description" maxlength="255" value="${existing?.description ? esc(existing.description) : ""}" /></label>
          <fieldset style="margin-top:12px">
            <legend><strong>Quyền của vai trò</strong></legend>
            ${[...groups.entries()].map(([g, perms]) => `
              <div style="margin-bottom:10px">
                <div class="muted small" style="margin-bottom:4px">${esc(g)}</div>
                ${perms.map((p) => `
                  <label class="assign-item">
                    <input type="checkbox" name="permissions" value="${esc(p.code)}" ${currentPerms.has(p.code) ? "checked" : ""} />
                    <span>${esc(p.label)}</span>
                  </label>`).join("")}
              </div>`).join("")}
          </fieldset>
          <p class="form-error" id="role-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="role-cancel">Huỷ</button>
            <button type="submit" class="btn primary">${existing ? "Lưu" : "Thêm"}</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#role-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#role-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const errEl = dialogRoot.querySelector<HTMLElement>("#role-error")!;
    const input = {
      name: String(fd.get("name") ?? "").trim(),
      description: String(fd.get("description") ?? "").trim() || undefined,
      permissions: fd.getAll("permissions").map(String),
    };
    try {
      if (existing) await api.updateRole(existing.id, input);
      else await api.createRole(input);
      toast(existing ? "Đã lưu." : "Đã thêm vai trò.");
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
    }
  });
}

/** Trang quản lý chức vụ (#/positions). */
export async function renderPositions(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Chức vụ</h2>
      <p class="page-sub">Danh mục chức vụ dùng chung cho nhân viên và bước quy trình.</p></div>
      <button class="btn primary" id="pos-add">+ Thêm chức vụ</button>
    </div>
    <div id="pos-list"><p class="empty">Đang tải…</p></div>
    <div id="pos-dialog-root"></div>`;

  const listEl = root.querySelector<HTMLElement>("#pos-list")!;
  const dialogRoot = root.querySelector<HTMLElement>("#pos-dialog-root")!;

  async function reload(): Promise<void> {
    try {
      const { items } = await api.listPositions();
      if (items.length === 0) {
        listEl.innerHTML = `<p class="empty">Chưa có chức vụ nào.</p>`;
        return;
      }
      listEl.innerHTML = `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Tên chức vụ</th><th>Mô tả</th><th style="width:120px"></th></tr></thead>
        <tbody>${items.map((p) => `
          <tr data-id="${esc(p.id)}">
            <td><strong>${esc(p.name)}</strong></td>
            <td class="muted">${esc(p.description ?? "—")}</td>
            <td class="actions">
              <button class="btn sm" data-act="edit">Sửa</button>
              <button class="btn sm danger" data-act="del">Xoá</button>
            </td>
          </tr>`).join("")}
        </tbody></table></div>`;
      listEl.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.closest("tr")!.dataset.id!;
          const item = items.find((x) => x.id === id)!;
          if (btn.dataset.act === "edit") openPositionDialog(dialogRoot, item, reload);
          else if (btn.dataset.act === "del") {
            if (confirm(`Xoá chức vụ "${item.name}"?`)) {
              api.deletePosition(id).then(() => { toast("Đã xoá."); reload(); })
                .catch((e) => toast(`Lỗi: ${msg(e)}`));
            }
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#pos-add")!.addEventListener("click", () => openPositionDialog(dialogRoot, null, reload));
  await reload();
}

function openPositionDialog(dialogRoot: HTMLElement, existing: { id: string; name: string; description: string | null } | null, onDone: () => void): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${existing ? "Sửa chức vụ" : "Thêm chức vụ"}</h3>
        <form id="pos-form">
          <label>Tên chức vụ <span class="req">*</span>
            <input class="input" name="name" required maxlength="100" value="${existing ? esc(existing.name) : ""}" placeholder="VD: Kế toán, Thủ kho…" /></label>
          <label>Mô tả <input class="input" name="description" maxlength="255" value="${existing?.description ? esc(existing.description) : ""}" /></label>
          <p class="form-error" id="pos-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="pos-cancel">Huỷ</button>
            <button type="submit" class="btn primary">${existing ? "Lưu" : "Thêm"}</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#pos-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#pos-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const errEl = dialogRoot.querySelector<HTMLElement>("#pos-error")!;
    const input = { name: String(fd.get("name") ?? "").trim(), description: String(fd.get("description") ?? "").trim() || undefined };
    try {
      if (existing) await api.updatePosition(existing.id, input);
      else await api.createPosition(input);
      toast(existing ? "Đã lưu." : "Đã thêm chức vụ.");
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
    }
  });
}

/** Trang quản lý ngoại lệ (#/exceptions). */
export async function renderExceptions(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Quản lý ngoại lệ</h2>
      <p class="page-sub">Theo dõi và xử lý các sự cố phát sinh trong thực hiện công việc.</p></div>
    </div>
    <div class="filter-bar">
      <input type="search" id="exc-flt-q" class="input" placeholder="Tìm theo từ khóa…" aria-label="Tìm kiếm" />
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
  const inpQ = root.querySelector<HTMLInputElement>("#exc-flt-q")!;
  const selStatus = root.querySelector<HTMLSelectElement>("#exc-flt-status")!;
  const selSev = root.querySelector<HTMLSelectElement>("#exc-flt-sev")!;

  async function reload(): Promise<void> {
    listEl.innerHTML = `<p class="empty">Đang tải…</p>`;
    try {
      const qs = new URLSearchParams();
      if (inpQ.value.trim()) qs.set("q", inpQ.value.trim());
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
  const STEP_STATUS_LABELS: Record<string, string> = {
    NOT_STARTED: "Chưa bắt đầu",
    IN_PROGRESS: "Đang làm",
    PASSED: "Đạt",
    FAILED: "Không đạt",
    SKIPPED: "Bỏ qua",
  };
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Quản lý bằng chứng</h2>
      <p class="page-sub">Tất cả ảnh và tệp bằng chứng đã tải lên.</p></div>
    </div>
    <div class="filter-bar">
      <input type="search" id="ev-flt-q" class="input" placeholder="Tìm theo tên tệp…" aria-label="Tìm kiếm" />
      <select id="ev-flt-kind" class="input" aria-label="Loại">
        <option value="">Tất cả loại</option>
        <option value="PHOTO">Ảnh</option>
        <option value="FILE">Tệp</option>
      </select>
      <input type="date" id="ev-flt-date" class="input" aria-label="Từ ngày" />
      <button class="btn" id="ev-btn-filter">Lọc</button>
      <div class="view-toggle" role="group" aria-label="Chế độ xem">
        <button class="btn sm view-btn active" data-view="grid" title="Dạng lưới">▦</button>
        <button class="btn sm view-btn" data-view="list" title="Dạng danh sách">☰</button>
      </div>
    </div>
    <div id="ev-list"><p class="empty">Đang tải…</p></div>`;

  const listEl = root.querySelector<HTMLElement>("#ev-list")!;
  const inpQ = root.querySelector<HTMLInputElement>("#ev-flt-q")!;
  const selKind = root.querySelector<HTMLSelectElement>("#ev-flt-kind")!;
  const inpDate = root.querySelector<HTMLInputElement>("#ev-flt-date")!;
  let viewMode: "grid" | "list" = "grid";

  root.querySelectorAll<HTMLButtonElement>(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      viewMode = btn.dataset.view as "grid" | "list";
      void reload();
    });
  });

  async function reload(): Promise<void> {
    listEl.innerHTML = `<p class="empty">Đang tải…</p>`;
    try {
      const qs = new URLSearchParams();
      if (inpQ.value.trim()) qs.set("q", inpQ.value.trim());
      if (selKind.value) qs.set("kind", selKind.value);
      if (inpDate.value) qs.set("from_date", inpDate.value);
      const { items } = await api.listAllEvidence(qs.toString());
      if (items.length === 0) {
        listEl.innerHTML = `<p class="empty">Chưa có bằng chứng nào.</p>`;
        return;
      }
      if (viewMode === "grid") {
        listEl.innerHTML = `<div class="evidence-manage-grid">` + items.map((ev: Record<string, unknown>) => {
          const isPhoto = ev.kind === "PHOTO";
          const stepStatus = String(ev.step_status ?? "");
          const statusLabel = STEP_STATUS_LABELS[stepStatus] ?? stepStatus;
          const statusCls = stepStatus === "PASSED" ? "green" : stepStatus === "IN_PROGRESS" ? "blue" : "gray";
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
              <div class="muted small"><span class="pill ${statusCls}">${esc(statusLabel)}</span></div>
              <div class="muted small">👤 ${esc(String(ev.uploader_name ?? "—"))} · 🕐 ${esc(String(ev.created_at).slice(0, 16).replace("T", " "))}</div>
              <a class="link small" href="${esc(api.evidenceDownloadUrl(String(ev.id)))}" target="_blank" rel="noopener">Xem / Tải</a>
            </div>
          </div>`;
        }).join("") + `</div>`;
      } else {
        listEl.innerHTML = `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>Tên tệp</th><th>Loại</th><th>Dung lượng</th><th>Lượt</th><th>Trạng thái bước</th><th>Người tải</th><th>Thời gian</th><th></th></tr></thead>
          <tbody>${items.map((ev: Record<string, unknown>) => {
            const stepStatus = String(ev.step_status ?? "");
            const statusLabel = STEP_STATUS_LABELS[stepStatus] ?? stepStatus;
            const statusCls = stepStatus === "PASSED" ? "green" : stepStatus === "IN_PROGRESS" ? "blue" : "gray";
            return `
            <tr>
              <td><strong>${esc(String(ev.original_name))}</strong></td>
              <td>${ev.kind === "PHOTO" ? "Ảnh" : "Tệp"}</td>
              <td>${formatBytes(Number(ev.size_bytes))}</td>
              <td><a href="#/executions/${esc(String(ev.execution_id))}">${esc(String(ev.execution_code ?? "—"))}</a></td>
              <td><span class="pill ${statusCls}">${esc(statusLabel)}</span></td>
              <td>${esc(String(ev.uploader_name ?? "—"))}</td>
              <td class="muted small">${esc(String(ev.created_at).slice(0, 16).replace("T", " "))}</td>
              <td><a class="link small" href="${esc(api.evidenceDownloadUrl(String(ev.id)))}" target="_blank" rel="noopener">Xem</a></td>
            </tr>`;}).join("")}
          </tbody></table></div>`;
      }
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
