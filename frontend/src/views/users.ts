// views/users.ts — quản trị người dùng (quyền users.manage, SPEC ADM-001).

import { api, type PublicUser } from "../api.js";
import {
  esc,
  ICON_EDIT,
  ICON_KEY,
  ICON_LOCK,
  ICON_TRASH,
  ICON_UNLOCK,
  roleLabel,
  setLoading,
  toast,
} from "../ui.js";

const ALL_ROLES = [
  "admin",
  "process_owner",
  "editor",
  "reviewer",
  "approver",
  "executor",
  "monitor",
  "viewer",
];

export async function renderUsers(root: HTMLElement, selfId: string): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Quản lý người dùng</h2>
      <p class="page-sub">Tạo tài khoản, phân vai trò, khoá/mở và bắt buộc đổi mật khẩu.</p></div>
      <button class="btn primary" id="btn-create">+ Tạo tài khoản</button>
    </div>
    <div class="table-wrap"><table class="tbl" id="users-table">
      <thead><tr>
        <th>Tên đăng nhập</th><th>Tên hiển thị</th><th>Vai trò</th>
        <th>Trạng thái</th><th>Thao tác</th>
      </tr></thead>
      <tbody><tr><td colspan="5" class="empty">Đang tải…</td></tr></tbody>
    </table></div>
    <div id="user-dialog-root"></div>`;

  const tbody = root.querySelector<HTMLTableSectionElement>("#users-table tbody")!;
  const dialogRoot = root.querySelector<HTMLElement>("#user-dialog-root")!;
  // Giữ danh sách đã tải để mở dialog Sửa mà không phải gọi API lại (nhanh hơn).
  let cachedItems: PublicUser[] = [];

  async function reload(): Promise<void> {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Đang tải…</td></tr>`;
    try {
      const { items } = await api.listUsers();
      cachedItems = items;
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty">Chưa có tài khoản nào.</td></tr>`;
        return;
      }
      tbody.innerHTML = items.map((u) => rowHtml(u, selfId)).join("");
      wireRows(tbody, dialogRoot, selfId, reload, cachedItems);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Không tải được danh sách: ${esc(msg(e))}</td></tr>`;
    }
  }

  root.querySelector("#btn-create")!.addEventListener("click", () => {
    openUserDialog(dialogRoot, null, reload);
  });

  await reload();
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "lỗi không xác định";
}

function statusLabel(u: PublicUser): string {
  if (u.status === "disabled") return `<span class="pill gray">Vô hiệu hoá</span>`;
  if (u.locked_until && u.locked_until > new Date().toISOString()) {
    return `<span class="pill red">Đang khoá</span>`;
  }
  if (u.must_change_password) return `<span class="pill amber">Chờ đổi MK</span>`;
  return `<span class="pill green">Hoạt động</span>`;
}

function rowHtml(u: PublicUser, selfId: string): string {
  const isSelf = u.id === selfId;
  const locked = !!(u.locked_until && u.locked_until > new Date().toISOString());
  return `<tr data-id="${esc(u.id)}">
    <td><strong>${esc(u.username)}</strong>${isSelf ? ' <span class="muted">(bạn)</span>' : ""}</td>
    <td>${esc(u.display_name)}${u.position ? `<div class="muted small">${esc(u.position)}</div>` : ""}${u.email ? `<div class="muted small">${esc(u.email)}</div>` : ""}</td>
    <td>${u.roles.map((r) => `<span class="role-badge sm">${esc(roleLabel(r))}</span>`).join(" ")}</td>
    <td>${statusLabel(u)}</td>
    <td class="actions">
      <button class="link" data-act="edit" title="Sửa">${ICON_EDIT}<span>Sửa</span></button>
      ${locked
        ? `<button class="link" data-act="unlock" title="Mở khoá">${ICON_UNLOCK}<span>Mở khoá</span></button>`
        : isSelf ? "" : `<button class="link danger" data-act="lock" title="Khoá">${ICON_LOCK}<span>Khoá</span></button>`}
      <button class="link" data-act="force" title="Bắt đổi mật khẩu">${ICON_KEY}<span>Bắt đổi MK</span></button>
      ${isSelf ? "" : `<button class="link" data-act="resetpw" title="Đặt lại mật khẩu">${ICON_KEY}<span>Đặt lại MK</span></button>`}
      ${isSelf ? "" : `<button class="link danger" data-act="delete" title="Xoá vĩnh viễn">${ICON_TRASH}<span>Xoá</span></button>`}
    </td>
  </tr>`;
}

function wireRows(
  tbody: HTMLTableSectionElement,
  dialogRoot: HTMLElement,
  selfId: string,
  reload: () => Promise<void>,
  items: PublicUser[]
): void {
  tbody.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr")!;
      const id = tr.dataset.id!;
      const act = btn.dataset.act!;
      if (act === "edit") {
        // Dùng dữ liệu đã có, không gọi API lại.
        const u = items.find((x) => x.id === id);
        if (u) openUserDialog(dialogRoot, u, reload);
        else toast("Không tìm thấy tài khoản.", "err");
        return;
      }
      if (act === "delete") {
        const u = items.find((x) => x.id === id);
        if (u) openDeleteConfirmDialog(dialogRoot, u, reload);
        else toast("Không tìm thấy tài khoản.", "err");
        return;
      }
      if (act === "resetpw") {
        const u = items.find((x) => x.id === id);
        if (u) openResetPasswordDialog(dialogRoot, u, reload);
        else toast("Không tìm thấy tài khoản.", "err");
        return;
      }
      const confirmMsg =
        act === "lock"
          ? "Khoá tài khoản này? Người dùng sẽ bị đăng xuất ngay."
          : act === "unlock"
            ? "Mở khoá tài khoản này?"
            : "Bắt người dùng đổi mật khẩu ở lần đăng nhập tới? (Đăng xuất mọi phiên hiện tại)";
      if (!window.confirm(confirmMsg)) return;
      const restore = setLoading(btn, true, "Đang xử lý…");
      try {
        if (act === "lock") await api.lockUser(id);
        else if (act === "unlock") await api.unlockUser(id);
        else await api.forcePasswordChange(id);
        toast("Đã thực hiện.", "ok");
        await reload();
      } catch (e) {
        toast(msg(e), "err");
        restore();
      }
    });
  });
  void selfId;
}

function openUserDialog(
  dialogRoot: HTMLElement,
  existing: PublicUser | null,
  reload: () => Promise<void>
): void {
  const isNew = !existing;
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" id="dlg-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="${isNew ? "Tạo tài khoản" : "Sửa tài khoản"}">
        <h3>${isNew ? "Tạo tài khoản" : "Sửa tài khoản"}</h3>
        <form id="user-form" novalidate>
          <label>Tên đăng nhập ${isNew ? '<input name="username" required minlength="3" maxlength="32" autocomplete="off" />' : `<input value="${esc(existing!.username)}" disabled />`}
            <span class="hint">3–32 ký tự: chữ thường, số, . _ -</span></label>
          <label>Tên hiển thị <input name="display_name" required maxlength="100" value="${existing ? esc(existing.display_name) : ""}" /></label>
          <label>Chức vụ
            <select name="position_id" id="user-position">
              <option value="">— Chưa chọn —</option>
            </select></label>
          <label>Email <input name="email" type="email" maxlength="120" value="${existing?.email ? esc(existing.email) : ""}" /></label>
          ${isNew ? `<label>Mật khẩu tạm <input name="password" type="password" required minlength="8" autocomplete="new-password" />
            <span class="hint">Ít nhất 8 ký tự. Người dùng bắt buộc đổi ở lần đăng nhập đầu.</span></label>` : ""}
          <fieldset><legend>Vai trò hệ thống</legend>
            <div class="roles-grid">
              ${ALL_ROLES.map((r) => `
                <label class="check"><input type="checkbox" name="role" value="${r}"
                  ${existing && existing.roles.includes(r) ? "checked" : ""} /> ${esc(roleLabel(r))}</label>`).join("")}
            </div></fieldset>
          ${!isNew ? `<label>Trạng thái
            <select name="status">
              <option value="active" ${existing!.status === "active" ? "selected" : ""}>Hoạt động</option>
              <option value="disabled" ${existing!.status === "disabled" ? "selected" : ""}>Vô hiệu hoá</option>
            </select></label>` : ""}
          <p class="form-error" id="user-form-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn secondary" id="dlg-cancel">Huỷ</button>
            <button type="submit" class="btn primary" id="dlg-submit">${isNew ? "Tạo tài khoản" : "Lưu"}</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => {
    dialogRoot.innerHTML = "";
    document.removeEventListener("keydown", escHandler);
  };
  function escHandler(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  const cancelBtn = dialogRoot.querySelector<HTMLButtonElement>("#dlg-cancel")!;
  // Dùng cả click và touchend để chắc chắn hoạt động trên mobile.
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  dialogRoot.querySelector("#dlg-backdrop")!.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "dlg-backdrop") close();
  });
  document.addEventListener("keydown", escHandler);

  const form = dialogRoot.querySelector<HTMLFormElement>("#user-form")!;
  const errBox = dialogRoot.querySelector<HTMLElement>("#user-form-error")!;
  // Tải danh sách chức vụ.
  const selPos = dialogRoot.querySelector<HTMLSelectElement>("#user-position")!;
  api.listPositions().then(({ items }) => {
    selPos.innerHTML = `<option value="">— Chưa chọn —</option>` + items.map((p) =>
      `<option value="${esc(p.id)}" ${existing?.position_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`
    ).join("");
  }).catch(() => {});
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const fd = new FormData(form);
    const roles = fd.getAll("role").map(String);
    if (roles.length === 0) {
      errBox.textContent = "Vui lòng chọn ít nhất một vai trò.";
      errBox.hidden = false;
      return;
    }
    const submit = dialogRoot.querySelector<HTMLButtonElement>("#dlg-submit")!;
    const restore = setLoading(submit, true, "Đang lưu…");
    try {
      if (isNew) {
        await api.createUser({
          username: String(fd.get("username") ?? ""),
          display_name: String(fd.get("display_name") ?? ""),
          position_id: String(fd.get("position_id") ?? "") || undefined,
          email: String(fd.get("email") ?? "") || undefined,
          password: String(fd.get("password") ?? ""),
          roles,
        });
        toast("Đã tạo tài khoản.", "ok");
      } else {
        await api.patchUser(existing!.id, {
          display_name: String(fd.get("display_name") ?? ""),
          position_id: String(fd.get("position_id") ?? "") || undefined,
          email: String(fd.get("email") ?? "") || null,
          status: String(fd.get("status") ?? "active"),
          roles,
        });
        toast("Đã lưu thay đổi.", "ok");
      }
      close();
      await reload();
    } catch (err) {
      errBox.textContent = msg(err);
      errBox.hidden = false;
      restore();
    }
  });

  const first = dialogRoot.querySelector<HTMLInputElement>("input[name=username], input[name=display_name]");
  first?.focus();
}

/** Dialog đặt lại mật khẩu cho user (admin). */
function openResetPasswordDialog(
  dialogRoot: HTMLElement,
  user: PublicUser,
  reload: () => Promise<void>
): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" id="dlg-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Đặt lại mật khẩu">
        <h3>Đặt lại mật khẩu</h3>
        <p class="muted">Tài khoản: <strong>${esc(user.username)}</strong> (${esc(user.display_name)})</p>
        <form id="resetpw-form" novalidate>
          <label>Mật khẩu mới <input name="password" type="password" required minlength="8" autocomplete="new-password" />
            <span class="hint">Ít nhất 8 ký tự. Người dùng sẽ bị đăng xuất và bắt buộc đổi ở lần đăng nhập tới.</span></label>
          <label>Nhập lại mật khẩu mới <input name="password2" type="password" required minlength="8" autocomplete="new-password" /></label>
          <p class="form-error" id="resetpw-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn secondary" id="dlg-cancel">Huỷ</button>
            <button type="submit" class="btn primary" id="dlg-submit">Đặt lại mật khẩu</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => {
    dialogRoot.innerHTML = "";
    document.removeEventListener("keydown", escHandler);
  };
  function escHandler(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  const cancelBtn = dialogRoot.querySelector<HTMLButtonElement>("#dlg-cancel")!;
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  dialogRoot.querySelector("#dlg-backdrop")!.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "dlg-backdrop") close();
  });
  document.addEventListener("keydown", escHandler);

  const form = dialogRoot.querySelector<HTMLFormElement>("#resetpw-form")!;
  const errBox = dialogRoot.querySelector<HTMLElement>("#resetpw-error")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const fd = new FormData(form);
    const pw1 = String(fd.get("password") ?? "");
    const pw2 = String(fd.get("password2") ?? "");
    if (pw1.length < 8) {
      errBox.textContent = "Mật khẩu mới phải có ít nhất 8 ký tự.";
      errBox.hidden = false;
      return;
    }
    if (pw1 !== pw2) {
      errBox.textContent = "Mật khẩu nhập lại chưa khớp.";
      errBox.hidden = false;
      return;
    }
    const submit = dialogRoot.querySelector<HTMLButtonElement>("#dlg-submit")!;
    const restore = setLoading(submit, true, "Đang đặt lại…");
    try {
      await api.resetPassword(user.id, pw1);
      toast(`Đã đặt lại mật khẩu cho ${user.username}.`, "ok");
      close();
      await reload();
    } catch (err) {
      errBox.textContent = msg(err);
      errBox.hidden = false;
      restore();
    }
  });

  const first = dialogRoot.querySelector<HTMLInputElement>("input[name=password]");
  first?.focus();
}

/** Dialog xác nhận xoá cứng tài khoản. */
function openDeleteConfirmDialog(
  dialogRoot: HTMLElement,
  user: PublicUser,
  reload: () => Promise<void>
): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" id="dlg-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Xác nhận xoá">
        <h3>Xoá tài khoản?</h3>
        <p>XOÁ VĨNH VIỄN tài khoản <strong>${esc(user.username)}</strong> (${esc(user.display_name)})?</p>
        <p class="muted small">Chỉ xoá được tài khoản chưa từng đăng nhập/hoạt động. Hành động này không thể hoàn tác.</p>
        <p class="form-error" id="delete-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn secondary" id="dlg-cancel">Huỷ</button>
          <button type="button" class="btn danger" id="dlg-confirm-delete">Xoá vĩnh viễn</button>
        </div>
      </div>
    </div>`;

  const close = () => {
    dialogRoot.innerHTML = "";
    document.removeEventListener("keydown", escHandler);
  };
  function escHandler(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  dialogRoot.querySelector<HTMLButtonElement>("#dlg-cancel")!.addEventListener("click", (e) => {
    e.preventDefault();
    close();
  });
  dialogRoot.querySelector("#dlg-backdrop")!.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "dlg-backdrop") close();
  });
  document.addEventListener("keydown", escHandler);

  const confirmBtn = dialogRoot.querySelector<HTMLButtonElement>("#dlg-confirm-delete")!;
  const errBox = dialogRoot.querySelector<HTMLElement>("#delete-error")!;
  confirmBtn.addEventListener("click", async () => {
    errBox.hidden = true;
    const restore = setLoading(confirmBtn, true, "Đang xoá…");
    try {
      await api.deleteUser(user.id);
      toast("Đã xoá tài khoản.", "ok");
      close();
      await reload();
    } catch (err) {
      errBox.textContent = msg(err);
      errBox.hidden = false;
      restore();
    }
  });
}
