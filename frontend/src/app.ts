// app.ts — điều phối chính (Task 1.2).
// Luồng: trang giới thiệu (công khai) → đăng nhập → trang chủ theo vai trò.
// Route guard: chưa đăng nhập → về trang giới thiệu, không tải dữ liệu nghiệp vụ.

import { api, isUnauthenticated, type SessionInfo } from "./api.js";
import { EYE_OFF_SVG, EYE_OPEN_SVG, esc, setLoading, toast } from "./ui.js";
import { renderHome } from "./views/home.js";
import { renderExecutionDetail, renderMyWork } from "./views/executions.js";
import { renderProcessDetail, renderProcesses } from "./views/processes.js";
import { renderUsers } from "./views/users.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderExceptions, renderEvidence, renderPositions } from "./views/management.js";

let session: SessionInfo | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

function can(perm: string): boolean {
  return !!session && (session.permissions.includes("*") || session.permissions.includes(perm));
}

function hideBootLoading(): void {
  const el = document.getElementById("boot-loading");
  if (el) el.hidden = true;
}

function showLanding(): void {
  hideBootLoading();
  $("#landing").hidden = false;
  $("#app").hidden = true;
  $("#force-change").hidden = true;
}

function showApp(): void {
  hideBootLoading();
  $("#landing").hidden = true;
  $("#app").hidden = true;
  $("#force-change").hidden = true;
  if (session && session.must_change_password) {
    $("#force-change").hidden = false;
    renderForceChange();
  } else if (session) {
    $("#app").hidden = false;
    renderShell();
    route();
  } else {
    showLanding();
  }
}

function navigate(hash: string): void {
  if (window.location.hash === hash) route();
  else window.location.hash = hash;
}

// ---- Khung ứng dụng (sidebar + header) ----
function renderShell(): void {
  if (!session) return;
  const name = session.user.display_name || session.user.username;
  const navItems: Array<{ hash: string; label: string; perm?: string }> = [
    { hash: "#/home", label: "Trang chủ" },
    { hash: "#/my-work", label: "Công việc của tôi", perm: "executions.perform" },
    { hash: "#/processes", label: "Quy trình" },
    { hash: "#/dashboard", label: "Báo cáo", perm: "reports.view" },
    { hash: "#/exceptions", label: "Ngoại lệ", perm: "exceptions.handle" },
    { hash: "#/evidence", label: "Bằng chứng", perm: "executions.view" },
    { hash: "#/positions", label: "Chức vụ", perm: "users.manage" },
    { hash: "#/users", label: "Người dùng", perm: "users.manage" },
  ];
  $("#sidebar-nav").innerHTML = navItems
    .filter((i) => !i.perm || can(i.perm))
    .map(
      (i) =>
        `<a href="${i.hash}" data-route="${i.hash}" class="nav-item">
           <span class="nav-dot" aria-hidden="true"></span>${esc(i.label)}</a>`
    )
    .join("");
  $("#user-chip").innerHTML = `
    <span class="avatar" aria-hidden="true">${esc(initial(name))}</span>
    <span class="user-name">${esc(name)}</span>`;
  $("#btn-logout").onclick = async () => {
    try {
      await api.logout();
    } catch {
      // Đăng xuất local ngay cả khi server lỗi — không giữ trạng thái nhạy cảm (ONB-006).
    }
    session = null;
    showLanding();
    toast("Đã đăng xuất.", "ok");
  };
  const notif = $("#btn-notif") as HTMLButtonElement;
  notif.onclick = () => toast("Chưa có thông báo mới.", "ok");
  // Nút thu gọn sidebar (chỉ có tác dụng trên desktop, CSS ẩn trên mobile).
  const brand = document.querySelector("#sidebar .brand");
  if (brand && !document.getElementById("btn-collapse")) {
    const collapse = document.createElement("button");
    collapse.id = "btn-collapse";
    collapse.textContent = "«";
    collapse.setAttribute("aria-label", "Thu gọn menu");
    collapse.onclick = () => {
      const collapsed = document.body.classList.toggle("sidebar-collapsed");
      collapse.textContent = collapsed ? "»" : "«";
      collapse.setAttribute("aria-label", collapsed ? "Mở rộng menu" : "Thu gọn menu");
    };
    brand.appendChild(collapse);
  }
  $("#btn-menu").onclick = () => {
    document.body.classList.toggle("sidebar-open");
  };
  $("#sidebar-scrim").onclick = () => document.body.classList.remove("sidebar-open");
}

function initial(name: string): string {
  const t = name.trim();
  return t ? t[0].toUpperCase() : "?";
}

// ---- Router hash ----
function route(): void {
  if (!session) {
    showLanding();
    return;
  }
  const page = $("#page");
  const hash = window.location.hash || "#/home";
  document
    .querySelectorAll(".nav-item")
    .forEach((a) => a.classList.toggle("active", (a as HTMLAnchorElement).dataset.route === hash));
  document.body.classList.remove("sidebar-open");

  if (hash === "#/users") {
    if (!can("users.manage")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền quản trị người dùng.</p></div>`;
      return;
    }
    void renderUsers(page, session.user.id);
    return;
  }
  if (hash === "#/processes") {
    const canManage = can("processes.manage");
    void renderProcesses(page, canManage);
    return;
  }
  const pm = /^#\/processes\/([0-9a-f-]{36})$/.exec(hash);
  if (pm) {
    void renderProcessDetail(page, pm[1], session.permissions);
    return;
  }
  if (hash === "#/my-work") {
    if (!can("executions.perform")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền thực hiện công việc.</p></div>`;
      return;
    }
    void renderMyWork(page);
    return;
  }
  if (hash === "#/dashboard") {
    if (!can("reports.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền xem báo cáo.</p></div>`;
      return;
    }
    void renderDashboard(page);
    return;
  }
  if (hash === "#/exceptions") {
    if (!can("exceptions.handle")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền quản lý ngoại lệ.</p></div>`;
      return;
    }
    void renderExceptions(page);
    return;
  }
  if (hash === "#/evidence") {
    if (!can("executions.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền xem bằng chứng.</p></div>`;
      return;
    }
    void renderEvidence(page);
    return;
  }
  if (hash === "#/positions") {
    if (!can("users.manage")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền quản lý chức vụ.</p></div>`;
      return;
    }
    void renderPositions(page);
    return;
  }
  const em = /^#\/executions\/([0-9a-f-]{36})$/.exec(hash);
  if (em) {
    void renderExecutionDetail(page, em[1]);
    return;
  }
  // Mặc định: trang chủ.
  if (hash !== "#/home") window.location.hash = "#/home";
  renderHome(page, { session, navigate });
}

// ---- Bắt buộc đổi mật khẩu (lần đầu / khi admin yêu cầu) ----
function renderForceChange(): void {
  const root = $("#force-change");
  root.innerHTML = `
    <div class="force-wrap">
      <div class="card force-card">
        <h2>Đổi mật khẩu</h2>
        <p class="muted">Vì lý do bảo mật, bạn cần đặt mật khẩu mới trước khi tiếp tục.</p>
        <form id="force-form" novalidate>
          <label>Mật khẩu hiện tại
            <input type="password" name="current_password" required autocomplete="current-password" /></label>
          <label>Mật khẩu mới
            <input type="password" name="new_password" required minlength="8" autocomplete="new-password" />
            <span class="hint">Ít nhất 8 ký tự.</span></label>
          <label>Nhập lại mật khẩu mới
            <input type="password" name="confirm_password" required autocomplete="new-password" /></label>
          <p class="form-error" id="force-error" role="alert" hidden></p>
          <button type="submit" class="btn primary block" id="force-submit">Đổi mật khẩu</button>
        </form>
      </div>
    </div>`;
  const form = $("#force-form") as HTMLFormElement;
  const errBox = $("#force-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const fd = new FormData(form);
    const cur = String(fd.get("current_password") ?? "");
    const next = String(fd.get("new_password") ?? "");
    const confirm = String(fd.get("confirm_password") ?? "");
    if (next !== confirm) {
      errBox.textContent = "Mật khẩu nhập lại chưa khớp.";
      errBox.hidden = false;
      return;
    }
    const btn = $("#force-submit") as HTMLButtonElement;
    const restore = setLoading(btn, true, "Đang đổi…");
    try {
      await api.changePassword(cur, next);
      if (session) session.must_change_password = false;
      restore(); // Tắt trạng thái loading trước khi chuyển màn hình.
      toast("Đổi mật khẩu thành công.", "ok");
      showApp();
    } catch (err) {
      errBox.textContent = err instanceof Error ? err.message : "Có lỗi xảy ra.";
      errBox.hidden = false;
      restore();
    }
  });
}

// ---- Đăng nhập trên trang giới thiệu ----
function wireLogin(): void {
  const form = $("#login-form") as HTMLFormElement;
  const errBox = $("#login-error");
  const toggle = $("#toggle-password") as HTMLButtonElement;
  const pwInput = $("#login-password") as HTMLInputElement;

  toggle.addEventListener("click", () => {
    const show = pwInput.type === "password";
    pwInput.type = show ? "text" : "password";
    toggle.innerHTML = show ? EYE_OFF_SVG : EYE_OPEN_SVG;
    toggle.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const fd = new FormData(form);
    const username = String(fd.get("username") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    if (!username || !password) {
      errBox.textContent = "Vui lòng nhập tên đăng nhập và mật khẩu.";
      errBox.hidden = false;
      return;
    }
    const btn = $("#login-submit") as HTMLButtonElement;
    const restore = setLoading(btn, true, "Đang đăng nhập…");
    try {
      session = await api.login(username, password);
      restore(); // Tắt trạng thái loading trước khi chuyển màn hình (tránh nút kẹt).
      showApp();
    } catch (err) {
      // Lỗi luôn chung chung từ server (ONB-003) — hiển thị nguyên văn.
      errBox.textContent = err instanceof Error ? err.message : "Đăng nhập thất bại.";
      errBox.hidden = false;
      restore();
    }
  });
}

// ---- Khởi động ----
async function boot(): Promise<void> {
  wireLogin();
  window.addEventListener("hashchange", () => {
    if (session && !session.must_change_password) route();
  });

  // Có phiên cũ (cookie còn hạn) → vào thẳng app; hết hạn → ở lại trang giới thiệu.
  try {
    session = await api.session();
  } catch (e) {
    if (!isUnauthenticated(e)) {
      console.warn("[sop] kiểm tra phiên thất bại:", e);
    }
    session = null;
  }
  showApp();

  // Service worker: chỉ đăng ký khi không phải file:// (giữ từ Task 01).
  if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("[sop] Không đăng ký được service worker:", err);
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  void boot();
});
