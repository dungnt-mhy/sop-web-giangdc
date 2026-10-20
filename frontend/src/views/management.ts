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

/** Trang quản lý đơn vị tổ chức (#/org-units). */
export async function renderOrgUnits(root: HTMLElement): Promise<void> {
  const TYPE_OPTIONS = [
    { value: "REGION", label: "Khu vực" },
    { value: "BRANCH", label: "Chi nhánh" },
    { value: "STORE", label: "Cửa hàng" },
    { value: "WAREHOUSE", label: "Kho" },
  ];
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Đơn vị tổ chức</h2>
      <p class="page-sub">Quản lý khu vực, chi nhánh, cửa hàng, kho — dùng cho đơn vị áp dụng quy trình.</p></div>
      <button class="btn primary" id="ou-add">+ Thêm đơn vị</button>
    </div>
    <div id="ou-list"><p class="empty">Đang tải…</p></div>
    <div id="ou-dialog-root"></div>`;

  const listEl = root.querySelector<HTMLElement>("#ou-list")!;
  const dialogRoot = root.querySelector<HTMLElement>("#ou-dialog-root")!;

  async function reload(): Promise<void> {
    try {
      const { items } = await api.listOrgUnits();
      if (items.length === 0) {
        listEl.innerHTML = `<p class="empty">Chưa có đơn vị nào.</p>`;
        return;
      }
      listEl.innerHTML = `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Mã</th><th>Tên đơn vị</th><th>Loại</th><th>Trực thuộc</th><th>Liên hệ</th><th>Người quản lý</th><th>Trạng thái</th><th style="width:120px"></th></tr></thead>
        <tbody>${items.map((u) => `
          <tr data-id="${esc(u.id)}">
            <td><strong>${u.code ? esc(u.code) : '<span class="muted">—</span>'}</strong></td>
            <td><strong>${esc(u.name)}</strong>${u.address ? `<div class="muted small">📍 ${esc(u.address)}</div>` : ""}</td>
            <td><span class="pill blue">${esc(u.type_label)}</span></td>
            <td class="muted">${u.parent_name ? esc(u.parent_name) : "—"}</td>
            <td class="muted small">${u.phone ? `📞 ${esc(u.phone)}<br/>` : ""}${u.email ? `✉️ ${esc(u.email)}` : ""}${!u.phone && !u.email ? "—" : ""}</td>
            <td>${u.manager_name ? esc(u.manager_name) : '<span class="muted">—</span>'}</td>
            <td><span class="pill ${u.status === "active" ? "green" : "gray"}">${esc(u.status_label)}</span></td>
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
          if (btn.dataset.act === "edit") openOrgUnitDialog(dialogRoot, item, items, TYPE_OPTIONS, reload);
          else if (btn.dataset.act === "del") {
            if (confirm(`Xoá đơn vị "${item.name}"?`)) {
              api.deleteOrgUnit(id).then(() => { toast("Đã xoá."); reload(); })
                .catch((e) => toast(`Lỗi: ${msg(e)}`));
            }
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#ou-add")!.addEventListener("click", async () => {
    const { items } = await api.listOrgUnits().catch(() => ({ items: [] }));
    openOrgUnitDialog(dialogRoot, null, items, TYPE_OPTIONS, reload);
  });
  await reload();
}

function openOrgUnitDialog(
  dialogRoot: HTMLElement,
  existing: { id: string; code: string | null; name: string; type: string; parent_id: string | null; description: string | null; address: string | null; phone: string | null; email: string | null; manager_id: string | null; status: string } | null,
  allUnits: { id: string; name: string }[],
  typeOptions: { value: string; label: string }[],
  onDone: () => void
): void {
  const parentOpts = allUnits.filter((u) => !existing || u.id !== existing.id);
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog wide" role="dialog" aria-modal="true">
        <h3>${existing ? "Sửa đơn vị" : "Thêm đơn vị"}</h3>
        <form id="ou-form">
          <div class="form-grid">
            <label>Mã đơn vị
              <input class="input" name="code" maxlength="32" value="${existing?.code ? esc(existing.code) : ""}" placeholder="VD: CN-HN, KHO-01" style="text-transform:uppercase" />
              <span class="hint">Mã ngắn gọn để tra cứu nhanh</span></label>
            <label>Tên đơn vị <span class="req">*</span>
              <input class="input" name="name" required maxlength="100" value="${existing ? esc(existing.name) : ""}" placeholder="VD: Chi nhánh Hà Nội, Kho chính…" /></label>
          </div>
          <div class="form-grid">
            <label>Loại đơn vị <span class="req">*</span>
              <select class="input" name="type">
                ${typeOptions.map((o) => `<option value="${o.value}" ${existing?.type === o.value ? "selected" : ""}>${o.label}</option>`).join("")}
              </select></label>
            <label>Trực thuộc
              <select class="input" name="parent_id">
                <option value="">— Không có —</option>
                ${parentOpts.map((u) => `<option value="${esc(u.id)}" ${existing?.parent_id === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}
              </select>
              <span class="hint">VD: Cửa hàng trực thuộc Chi nhánh</span></label>
          </div>
          <label>Địa chỉ
            <input class="input" name="address" maxlength="255" value="${existing?.address ? esc(existing.address) : ""}" placeholder="VD: 123 Nguyễn Trãi, Thanh Xuân, Hà Nội" /></label>
          <div class="form-grid">
            <label>Số điện thoại
              <input class="input" name="phone" maxlength="32" value="${existing?.phone ? esc(existing.phone) : ""}" placeholder="VD: 024 3856 7890" /></label>
            <label>Email
              <input class="input" name="email" type="email" maxlength="100" value="${existing?.email ? esc(existing.email) : ""}" placeholder="VD: hanoi@congty.vn" /></label>
          </div>
          <div class="form-grid">
            <label>Người quản lý
              <select class="input" name="manager_id" id="ou-manager"><option value="">— Chưa chọn —</option></select>
              <span class="hint">Chọn từ danh sách nhân viên</span></label>
            <label>Trạng thái
              <select class="input" name="status">
                <option value="active" ${!existing || existing.status === "active" ? "selected" : ""}>Đang hoạt động</option>
                <option value="inactive" ${existing?.status === "inactive" ? "selected" : ""}>Ngừng hoạt động</option>
              </select></label>
          </div>
          <div class="form-grid">
            <label>Phạm vi chọn người phê duyệt
              <select class="input" name="approver_scope">
                <option value="SAME_UNIT" ${(existing as Record<string, string>)?.approver_scope === "SAME_UNIT" ? "selected" : ""}>Chỉ cùng đơn vị</option>
                <option value="UP_HIERARCHY" ${!(existing as Record<string, string>)?.approver_scope || (existing as Record<string, string>)?.approver_scope === "UP_HIERARCHY" ? "selected" : ""}>Cùng đơn vị + cấp trên (mặc định)</option>
                <option value="DIRECT_MANAGER" ${(existing as Record<string, string>)?.approver_scope === "DIRECT_MANAGER" ? "selected" : ""}>Chỉ quản lý trực tiếp</option>
                <option value="ANY_APPROVER" ${(existing as Record<string, string>)?.approver_scope === "ANY_APPROVER" ? "selected" : ""}>Bất kỳ ai có quyền duyệt</option>
              </select>
              <span class="hint">Nhân viên được chọn người phê duyệt trong phạm vi nào</span></label>
            <label>Phạm vi tạo lượt
              <select class="input" name="create_scope">
                <option value="SELF_ONLY" ${(existing as Record<string, string>)?.create_scope === "SELF_ONLY" ? "selected" : ""}>Chỉ đơn vị mình</option>
                <option value="SELF_AND_CHILDREN" ${!(existing as Record<string, string>)?.create_scope || (existing as Record<string, string>)?.create_scope === "SELF_AND_CHILDREN" ? "selected" : ""}>Đơn vị mình + cấp dưới (mặc định)</option>
                <option value="ANY" ${(existing as Record<string, string>)?.create_scope === "ANY" ? "selected" : ""}>Mọi đơn vị</option>
              </select>
              <span class="hint">Quản lý được tạo lượt cho nhân viên ở phạm vi nào</span></label>
          </div>
          <label>Mô tả <input class="input" name="description" maxlength="255" value="${existing?.description ? esc(existing.description) : ""}" placeholder="Ghi chú thêm về đơn vị…" /></label>
          <p class="form-error" id="ou-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="ou-cancel">Huỷ</button>
            <button type="submit" class="btn primary">${existing ? "Lưu" : "Thêm"}</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#ou-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  // Tải danh sách nhân viên cho dropdown người quản lý.
  const managerSel = dialogRoot.querySelector<HTMLSelectElement>("#ou-manager")!;
  api.listActiveUsers().then(({ items }) => {
    managerSel.innerHTML = `<option value="">— Chưa chọn —</option>` + items.map((u: { id: string; display_name: string; position_name?: string | null }) =>
      `<option value="${esc(u.id)}" ${existing?.manager_id === u.id ? "selected" : ""}>${esc(u.display_name)}${u.position_name ? ` — ${esc(u.position_name)}` : ""}</option>`
    ).join("");
  }).catch(() => {});
  dialogRoot.querySelector<HTMLFormElement>("#ou-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const errEl = dialogRoot.querySelector<HTMLElement>("#ou-error")!;
    const str = (k: string) => { const s = String(fd.get(k) ?? "").trim(); return s || undefined; };
    const input = {
      code: str("code"),
      name: String(fd.get("name") ?? "").trim(),
      type: String(fd.get("type") ?? "BRANCH"),
      parent_id: str("parent_id") ?? null,
      description: str("description"),
      address: str("address"),
      phone: str("phone"),
      email: str("email"),
      manager_id: str("manager_id") ?? null,
      status: String(fd.get("status") ?? "active"),
    };
    try {
      if (existing) await api.updateOrgUnit(existing.id, input);
      else await api.createOrgUnit(input);
      toast(existing ? "Đã lưu." : "Đã thêm đơn vị.");
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
  const sess = await api.session().catch(() => null);
  const isManager = !!sess && (sess.permissions.includes("*") || sess.permissions.includes("executions.manage"));
  const defaultTab: string = isManager ? "all" : "related";
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Quản lý bằng chứng</h2>
      <p class="page-sub">${isManager ? "Bằng chứng trong phạm vi quản lý của bạn." : "Bằng chứng bạn tải lên hoặc thuộc lượt/bước bạn tham gia."}</p></div>
    </div>
    <div class="tabs" role="tablist" aria-label="Phạm vi bằng chứng">
      <button class="tab${defaultTab === "mine" ? " active" : ""}" data-scope="mine" role="tab">📷 Tôi tải lên</button>
      <button class="tab${defaultTab === "related" ? " active" : ""}" data-scope="related" role="tab">👥 Tôi tham gia</button>
      ${isManager ? `<button class="tab${defaultTab === "all" ? " active" : ""}" data-scope="all" role="tab">🌐 Tất cả trong phạm vi</button>` : ""}
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
  let scopeTab: string = defaultTab;

  root.querySelectorAll<HTMLButtonElement>(".tabs .tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".tabs .tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      scopeTab = btn.dataset.scope ?? defaultTab;
      void reload();
    });
  });

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
      qs.set("scope", scopeTab);
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
              <div class="muted small" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">Lượt: <a href="#/executions/${esc(String(ev.execution_id))}">${esc(String(ev.execution_code ?? "—"))}</a>
                ${ev.step_code ? ` · ${esc(String(ev.step_code))}` : ""} <span class="pill ${statusCls}" style="white-space:nowrap">${esc(statusLabel)}</span></div>
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

/** Dịch mã sự kiện audit sang tiếng Việt dễ hiểu. */
const AUDIT_LABELS: Record<string, string> = {
  // Auth
  AUTH_LOGIN: "Đăng nhập", AUTH_LOGOUT: "Đăng xuất", AUTH_LOGIN_FAIL: "Đăng nhập thất bại",
  AUTH_PASSWORD_CHANGED: "Đổi mật khẩu", AUTH_PASSWORD_RESET: "Đặt lại mật khẩu",
  // User
  USER_CREATED: "Tạo tài khoản", USER_UPDATED: "Sửa tài khoản", USER_DELETED: "Xóa tài khoản",
  USER_LOCKED: "Khóa tài khoản", USER_UNLOCKED: "Mở khóa tài khoản",
  // Process
  PROCESS_CREATED: "Tạo quy trình", PROCESS_UPDATED: "Sửa quy trình",
  PROCESS_VERSION_CREATED: "Tạo phiên bản", PROCESS_VERSION_SUBMITTED: "Gửi duyệt phiên bản",
  PROCESS_VERSION_APPROVED: "Duyệt phiên bản", PROCESS_VERSION_RETURNED: "Trả về sửa",
  PROCESS_VERSION_ACTIVATED: "Kích hoạt phiên bản", PROCESS_VERSION_RETIRED: "Ngừng phiên bản",
  PROCESS_VERSION_REACTIVATION_REQUESTED: "Yêu cầu kích hoạt lại",
  PROCESS_VERSION_REACTIVATION_APPROVED: "Duyệt kích hoạt lại",
  PROCESS_VERSION_REACTIVATION_REJECTED: "Từ chối kích hoạt lại",
  // Step
  STEP_CREATED: "Thêm bước", STEP_UPDATED: "Sửa bước", STEP_DELETED: "Xóa bước", STEP_REORDERED: "Sắp xếp bước",
  // Execution
  EXECUTION_CREATED: "Tạo lượt công việc", EXECUTION_UPDATED: "Sửa lượt công việc",
  EXECUTION_STARTED: "Bắt đầu lượt", EXECUTION_PAUSED: "Tạm dừng lượt", EXECUTION_RESUMED: "Tiếp tục lượt",
  EXECUTION_CANCELLED: "Hủy lượt", EXECUTION_REPORTED_COMPLETE: "Báo hoàn thành lượt",
  EXECUTION_COMPLETED: "Xác nhận hoàn thành lượt",
  EXECUTION_CONFIRM_REJECTED_REDO: "Từ chối — yêu cầu làm lại",
  EXECUTION_CONFIRM_REJECTED_CANCEL: "Từ chối — hủy lượt",
  EXECUTION_STEP_STARTED: "Bắt đầu bước", EXECUTION_STEP_COMPLETED: "Hoàn thành bước",
  EXECUTION_STEP_SKIPPED: "Bỏ qua bước",
  // Evidence
  EVIDENCE_UPLOADED: "Tải bằng chứng", EVIDENCE_DELETED: "Xóa bằng chứng",
  // Exception
  EXCEPTION_CREATED: "Báo ngoại lệ", EXCEPTION_ASSIGNED: "Giao xử lý ngoại lệ",
  EXCEPTION_RESOLVED: "Khắc phục ngoại lệ", EXCEPTION_CLOSED: "Đóng ngoại lệ",
  // Org
  ORG_UNIT_CREATED: "Tạo đơn vị", ORG_UNIT_UPDATED: "Sửa đơn vị", ORG_UNIT_DELETED: "Xóa đơn vị",
  POSITION_CREATED: "Tạo chức vụ", POSITION_UPDATED: "Sửa chức vụ", POSITION_DELETED: "Xóa chức vụ",
  ROLE_CREATED: "Tạo vai trò", ROLE_UPDATED: "Sửa vai trò", ROLE_DELETED: "Xóa vai trò",
};

function auditLabel(code: string): string {
  return AUDIT_LABELS[code] ?? code;
}

/** Dịch loại đối tượng sang tiếng Việt. */
const OBJECT_LABELS: Record<string, string> = {
  execution: "Lượt công việc",
  process: "Quy trình",
  process_version: "Phiên bản quy trình",
  execution_step: "Bước công việc",
  exception: "Ngoại lệ",
  evidence: "Bằng chứng",
  user: "Tài khoản",
  role: "Vai trò",
  position: "Chức vụ",
  org_unit: "Đơn vị",
};

function objectLabel(type: string | null): string {
  if (!type) return "—";
  return OBJECT_LABELS[type] ?? type;
}

/** Trang nhật ký audit (#/audit) — xem lịch sử thao tác. */
export async function renderAudit(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>📋 Nhật ký hoạt động</h2>
      <p class="page-sub">Lịch sử mọi thao tác trong hệ thống (ai làm gì, lúc nào).</p></div>
    </div>
    <div class="filter-bar">
      <input class="input" id="audit-q" placeholder="Tìm theo loại sự kiện…" style="max-width:200px;" />
      <select class="input" id="audit-type" style="max-width:200px;"><option value="">— Tất cả loại —</option></select>
      <select class="input" id="audit-actor" style="max-width:180px;"><option value="">— Mọi người —</option></select>
      <input class="input" type="date" id="audit-from" style="max-width:150px;" title="Từ ngày" />
      <input class="input" type="date" id="audit-to" style="max-width:150px;" title="Đến ngày" />
      <button class="btn primary" id="audit-filter">Lọc</button>
    </div>
    <div id="audit-list"><p class="empty">Đang tải…</p></div>`;

  const listEl = root.querySelector<HTMLElement>("#audit-list")!;
  const qEl = root.querySelector<HTMLInputElement>("#audit-q")!;
  const typeEl = root.querySelector<HTMLSelectElement>("#audit-type")!;
  const actorEl = root.querySelector<HTMLSelectElement>("#audit-actor")!;
  const fromEl = root.querySelector<HTMLInputElement>("#audit-from")!;
  const toEl = root.querySelector<HTMLInputElement>("#audit-to")!;

  // Tải danh sách người dùng cho bộ lọc.
  try {
    const { items } = await api.listUsers();
    actorEl.innerHTML = `<option value="">— Mọi người —</option>` +
      items.map((u) => `<option value="${esc(u.id)}">${esc(u.display_name || u.username)}</option>`).join("");
  } catch { /* ignore */ }

  try {
    const { items } = await api.listAuditEventTypes();
    typeEl.innerHTML = `<option value="">— Tất cả loại —</option>` +
      items.map((t) => `<option value="${esc(t)}">${esc(auditLabel(t))}</option>`).join("");
  } catch { /* ignore */ }

  async function reload(): Promise<void> {
    const params = new URLSearchParams();
    if (qEl.value.trim()) params.set("q", qEl.value.trim());
    if (typeEl.value) params.set("event_type", typeEl.value);
    if (actorEl.value) params.set("actor_id", actorEl.value);
    if (fromEl.value) params.set("from_date", fromEl.value);
    if (toEl.value) params.set("to_date", toEl.value);
    params.set("limit", "50");
    try {
      const { items, total } = await api.listAudit(params.toString());
      if (items.length === 0) {
        listEl.innerHTML = `<p class="empty">Chưa có dữ liệu.</p>`;
        return;
      }
      listEl.innerHTML = `
        <p class="muted small">Tổng ${total} sự kiện (hiện 50 mới nhất).</p>
        <div class="table-wrap"><table class="table audit-table">
          <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th class="hide-mobile">Mã sự kiện</th><th>Đối tượng</th></tr></thead>
          <tbody>
            ${items.map((a) => `
              <tr>
                <td class="muted small">${esc(a.occurred_at)}</td>
                <td>${esc(a.actor_name ?? "—")}</td>
                <td><strong>${esc(auditLabel(a.event_type))}</strong></td>
                <td class="hide-mobile"><span class="pill gray" title="${esc(a.event_type)}">${esc(a.event_type)}</span></td>
                <td class="muted small">${esc(a.object_type ?? "—")}${a.object_id ? ` · ${esc(a.object_id.slice(0, 8))}…` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table></div>`;
    } catch (e) {
      listEl.innerHTML = `<p class="empty">Không tải được: ${esc(msg(e))}</p>`;
    }
  }

  root.querySelector("#audit-filter")!.addEventListener("click", reload);
  qEl.addEventListener("keydown", (ev) => { if (ev.key === "Enter") reload(); });
  await reload();
}
