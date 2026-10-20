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
import { renderProposals } from "./views/proposals.js";
import { renderAudit, renderExceptions, renderEvidence, renderOrgUnits, renderPositions, renderRoles } from "./views/management.js";
import { renderStatsDaily, renderStatsPerson, renderStatsProcess, renderStatsShift, renderStatsUnit } from "./views/stats.js";

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

/** Cập nhật badge số lượng trên menu. */
async function updateMenuBadges(): Promise<void> {
  try {
    // Công việc của tôi: badge đỏ = cần hành động, badge xanh = đang chờ người khác.
    const myWorkBadge = document.querySelector<HTMLElement>('[data-badge="my-work"]');
    const myWorkWaitBadge = document.querySelector<HTMLElement>('[data-badge="my-work-wait"]');
    if (myWorkBadge || myWorkWaitBadge) {
      try {
        const { items } = await api.listExecutions({ mine: true });
        const needAction = items.filter((e: { status: string }) => ["CREATED", "IN_PROGRESS", "PAUSED"].includes(e.status)).length;
        const waiting = items.filter((e: { status: string }) => e.status === "PENDING_CONFIRMATION").length;
        if (myWorkBadge && needAction > 0) { myWorkBadge.textContent = String(needAction); myWorkBadge.hidden = false; }
        if (myWorkWaitBadge && waiting > 0) { myWorkWaitBadge.textContent = String(waiting); myWorkWaitBadge.hidden = false; }
      } catch { /* bỏ qua */ }
    }
    // Ngoại lệ: đếm ngoại lệ đang mở.
    const exBadge = document.querySelector<HTMLElement>('[data-badge="exceptions"]');
    if (exBadge) {
      try {
        const { items } = await api.listExceptions("");
        const open = items.filter((x: { status: string }) => ["OPEN", "IN_PROGRESS"].includes(x.status)).length;
        if (open > 0) { exBadge.textContent = String(open); exBadge.hidden = false; }
      } catch { /* bỏ qua */ }
    }
  } catch { /* bỏ qua */ }
}

// ---- Khung ứng dụng (sidebar + header) ----
function renderShell(): void {
  if (!session) return;
  const name = session.user.display_name || session.user.username;
  type NavItem = { hash: string; label: string; perm?: string; badgeId?: string; children?: NavItem[]; hideWhen?: () => boolean };
  const navItems: NavItem[] = [
    { hash: "#/home", label: "Tổng quan" },
    {
      hash: "#/dashboard", label: "Thống kê", perm: "reports.view",
      children: [
        { hash: "#/dashboard", label: "Tổng quan", perm: "reports.view" },
        { hash: "#/stats/unit", label: "Theo đơn vị", perm: "reports.view" },
        { hash: "#/stats/person", label: "Theo người", perm: "reports.view" },
        { hash: "#/stats/process", label: "Theo quy trình", perm: "reports.view" },
        { hash: "#/stats/shift", label: "Theo ca", perm: "reports.view" },
        { hash: "#/stats/daily", label: "Theo ngày", perm: "reports.view" },
      ],
    },
    { hash: "#/my-work", label: "Công việc của tôi", perm: "executions.perform", badgeId: "my-work" },
    { hash: "#/proposals", label: "💡 Đề xuất lượt", perm: "executions.perform" },
    { hash: "#/processes", label: "Quy trình" },
    { hash: "#/exceptions", label: "Ngoại lệ", perm: "exceptions.handle", badgeId: "exceptions" },
    { hash: "#/evidence", label: "Bằng chứng", perm: "executions.view" },
    {
      hash: "#/users", label: "Quản lý người dùng", perm: "users.manage",
      children: [
        { hash: "#/users", label: "Người dùng", perm: "users.manage" },
        { hash: "#/roles", label: "Vai trò", perm: "users.manage" },
        { hash: "#/positions", label: "Chức vụ", perm: "users.manage" },
        { hash: "#/org-units", label: "Đơn vị", perm: "users.manage" },
      ],
    },
    { hash: "#/audit", label: "Nhật ký", perm: "audit.view" },
  ];
  const visibleItems = navItems.filter((i) => (!i.perm || can(i.perm)) && !(i.hideWhen && i.hideWhen()));
  $("#sidebar-nav").innerHTML = visibleItems
    .map((i) => {
      let badge = "";
      if (i.badgeId) {
        badge = `<span class="nav-badge" data-badge="${i.badgeId}" title="Số việc cần bạn hành động" hidden></span>`;
        // Badge xanh cho "đang chờ" của Công việc của tôi.
        if (i.badgeId === "my-work") badge += `<span class="nav-badge blue" data-badge="my-work-wait" title="Số việc đang chờ người khác duyệt" hidden></span>`;
      }
      if (i.children) {
        const visibleChildren = i.children.filter((c) => !c.perm || can(c.perm));
        if (visibleChildren.length === 0) return "";
        const isActive = visibleChildren.some((c) => location.hash.startsWith(c.hash));
        return `<div class="nav-group ${isActive ? "open" : ""}">
          <button class="nav-item nav-parent" data-parent>
            <span class="nav-dot" aria-hidden="true"></span>${esc(i.label)}${badge}
            <span class="nav-arrow">▾</span>
          </button>
          <div class="nav-children">
            ${visibleChildren.map((c) => {
              const cBadge = c.badgeId ? `<span class="nav-badge" data-badge="${c.badgeId}" hidden></span>` : "";
              return `
              <a href="${c.hash}" data-route="${c.hash}" class="nav-item nav-child">
                <span class="nav-dot" aria-hidden="true"></span>${esc(c.label)}${cBadge}</a>`;
            }).join("")}
          </div>
        </div>`;
      }
      return `<a href="${i.hash}" data-route="${i.hash}" class="nav-item">
         <span class="nav-dot" aria-hidden="true"></span>${esc(i.label)}${badge}</a>`;
    })
    .join("");
  // Cập nhật badge số lượng.
  updateMenuBadges();
  // Toggle menu cha.
  document.querySelectorAll<HTMLButtonElement>("[data-parent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".nav-group")?.classList.toggle("open");
    });
  });
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
  // Nút liên kết Telegram.
  const tgBtn = $("#btn-telegram") as HTMLButtonElement;
  async function refreshTelegramBtn(): Promise<void> {
    try {
      const { configured, linked } = await api.telegramLinkUrl();
      if (!configured) { tgBtn.style.display = "none"; return; }
      tgBtn.style.display = "";
      tgBtn.textContent = linked ? "✅" : "✈️";
      tgBtn.title = linked ? "Đã liên kết Telegram — bấm để hủy" : "Nhận thông báo qua Telegram";
    } catch { /* bỏ qua */ }
  }
  tgBtn.onclick = async () => {
    try {
      const { configured, linked, link_url } = await api.telegramLinkUrl();
      if (!configured) { toast("Chưa cấu hình Telegram Bot.", "err"); return; }
      if (linked) {
        if (!confirm("Hủy liên kết Telegram? Bạn sẽ không nhận thông báo SOP qua Telegram nữa.")) return;
        await api.telegramUnlink();
        toast("Đã hủy liên kết Telegram.", "ok");
        refreshTelegramBtn();
        return;
      }
      if (link_url) {
        window.open(link_url, "_blank");
        toast("Mở Telegram và bấm Start để liên kết.", "ok");
        // Kiểm tra lại sau vài giây.
        setTimeout(refreshTelegramBtn, 5000);
      }
    } catch (e) {
      toast("Không tải được thông tin Telegram.", "err");
    }
  };
  refreshTelegramBtn();
  // Dropdown thông báo.
  let notifOpen = false;
  let notifPanel: HTMLElement | null = null;
  async function refreshNotifBadge(): Promise<void> {
    try {
      const { unread } = await api.unreadCount();
      notif.innerHTML = `🔔${unread > 0 ? `<span class="notif-badge">${unread > 9 ? "9+" : unread}</span>` : ""}`;
      notif.classList.toggle("has-unread", unread > 0);
    } catch { /* ignore */ }
  }
  async function toggleNotifPanel(): Promise<void> {
    if (notifOpen && notifPanel) {
      notifPanel.remove();
      notifPanel = null;
      notifOpen = false;
      return;
    }
    notifOpen = true;
    notifPanel = document.createElement("div");
    notifPanel.id = "notif-panel";
    notifPanel.innerHTML = `<div class="notif-head"><strong>Thông báo</strong><button class="link" id="notif-read-all">Đánh dấu đã đọc</button></div><div class="notif-list"><p class="muted" style="padding:12px;">Đang tải…</p></div>`;
    document.body.appendChild(notifPanel);
    // Đóng khi bấm ra ngoài.
    const closeOnOutside = (ev: MouseEvent) => {
      if (notifPanel && !notifPanel.contains(ev.target as Node) && ev.target !== notif) {
        notifPanel.remove();
        notifPanel = null;
        notifOpen = false;
        document.removeEventListener("click", closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener("click", closeOnOutside), 0);
    notifPanel.querySelector("#notif-read-all")!.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await api.markAllNotificationsRead();
      await refreshNotifBadge();
      toggleNotifPanel();
    });
    try {
      const { items } = await api.listNotifications(20);
      const listEl = notifPanel.querySelector(".notif-list")!;
      if (items.length === 0) {
        listEl.innerHTML = `<p class="muted" style="padding:12px;">Chưa có thông báo nào.</p>`;
      } else {
        const fmtVnTime = (iso: string): string => {
          if (!iso) return "";
          const d = new Date(iso);
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yyyy = d.getFullYear();
          const hh = String(d.getHours()).padStart(2, "0");
          const min = String(d.getMinutes()).padStart(2, "0");
          return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
        };
        listEl.innerHTML = items.map((n) => `
          <div class="notif-item ${n.is_read ? "" : "unread"}" data-nid="${esc(n.id)}" data-link="${esc(n.link ?? "")}">
            <div class="notif-title">${esc(n.title)}</div>
            ${n.message ? `<div class="notif-msg">${esc(n.message)}</div>` : ""}
            <div class="notif-time muted small">🕐 ${esc(fmtVnTime(n.created_at))}</div>
          </div>`).join("");
        listEl.querySelectorAll(".notif-item").forEach((el) => {
          el.addEventListener("click", async () => {
            const nid = (el as HTMLElement).dataset.nid!;
            const link = (el as HTMLElement).dataset.link!;
            await api.markNotificationRead(nid);
            await refreshNotifBadge();
            if (notifPanel) { notifPanel.remove(); notifPanel = null; notifOpen = false; }
            if (link) location.hash = link;
          });
        });
      }
    } catch {
      const listEl = notifPanel.querySelector(".notif-list")!;
      listEl.innerHTML = `<p class="muted" style="padding:12px;">Không tải được thông báo.</p>`;
    }
  }
  notif.onclick = (ev) => { ev.stopPropagation(); toggleNotifPanel(); };
  refreshNotifBadge();
  // Tự động làm mới badge mỗi 60s.
  setInterval(refreshNotifBadge, 60000);
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
  if (hash === "#/org-units") {
    if (!can("users.manage")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền quản lý đơn vị.</p></div>`;
      return;
    }
    void renderOrgUnits(page);
    return;
  }
  if (hash === "#/roles") {
    if (!can("users.manage")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền quản lý vai trò.</p></div>`;
      return;
    }
    void renderRoles(page);
    return;
  }
  if (hash === "#/audit") {
    if (!can("audit.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3>
        <p class="empty">Tài khoản của bạn không có quyền xem nhật ký.</p></div>`;
      return;
    }
    void renderAudit(page);
    return;
  }
  if (hash === "#/stats/unit") {
    if (!can("reports.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3></div>`;
      return;
    }
    void renderStatsUnit(page);
    return;
  }
  if (hash === "#/stats/person") {
    if (!can("reports.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3></div>`;
      return;
    }
    void renderStatsPerson(page);
    return;
  }
  if (hash === "#/stats/process") {
    if (!can("reports.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3></div>`;
      return;
    }
    void renderStatsProcess(page);
    return;
  }
  if (hash === "#/stats/shift") {
    if (!can("reports.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3></div>`;
      return;
    }
    void renderStatsShift(page);
    return;
  }
  if (hash === "#/stats/daily") {
    if (!can("reports.view")) {
      page.innerHTML = `<div class="card"><h3>Không có quyền</h3></div>`;
      return;
    }
    void renderStatsDaily(page);
    return;
  }
  const em = /^#\/executions\/([0-9a-f-]{36})$/.exec(hash);
  if (em) {
    void renderExecutionDetail(page, em[1]);
    return;
  }
  if (hash.startsWith("#/proposals")) {
    void renderProposals(page);
    return;
  }
  // Mặc định: trang chủ.
  if (hash !== "#/home") window.location.hash = "#/home";
  void renderHome(page, { session, navigate });
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
    const remember = (form.querySelector("#login-remember") as HTMLInputElement)?.checked ?? false;
    if (!username || !password) {
      errBox.textContent = "Vui lòng nhập tên đăng nhập và mật khẩu.";
      errBox.hidden = false;
      return;
    }
    const btn = $("#login-submit") as HTMLButtonElement;
    const restore = setLoading(btn, true, "Đang đăng nhập…");
    try {
      session = await api.login(username, password, remember);
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
