// views/home.ts — trang chủ theo vai trò (ONB-005, SPEC §10.3).
// Empty state hướng dẫn hành động tiếp theo; KHÔNG dựng số liệu giả.

import type { SessionInfo } from "../api.js";
import { api } from "../api.js";
import { esc, roleLabel } from "../ui.js";

interface HomeCtx {
  session: SessionInfo;
  navigate: (hash: string) => void;
}

function can(session: SessionInfo, perm: string): boolean {
  return session.permissions.includes("*") || session.permissions.includes(perm);
}

export async function renderHome(root: HTMLElement, ctx: HomeCtx): Promise<void> {
  const { session } = ctx;
  const name = session.user.display_name || session.user.username;
  const cards: string[] = [];

  // Việc của tôi (người thực hiện / giám sát) — dữ liệu thật.
  if (can(session, "executions.perform")) {
    let myWorkHtml = `<p class="empty">Đang tải…</p>`;
    try {
      const { items } = await api.listExecutions({ mine: true });
      const active = items.filter((e) => ["IN_PROGRESS", "PAUSED", "PENDING_CONFIRMATION", "CREATED"].includes(e.status)).slice(0, 5);
      myWorkHtml = active.length === 0
        ? `<p class="empty">Chưa có công việc nào được giao. Khi có lượt thực hiện mới, chúng sẽ hiện ở đây để bạn tiếp tục.</p>`
        : `<ul class="home-list">` + active.map((e) => `
          <li><a href="#/executions/${e.id}"><strong>${esc(e.code)}</strong> — ${esc(e.title || "")}
          <span class="muted small">${esc(e.status)}</span></a></li>`).join("") + `</ul>
          <p><a href="#/my-work" class="btn sm">Xem tất cả</a></p>`;
    } catch { myWorkHtml = `<p class="empty">Không tải được công việc.</p>`; }
    cards.push(`<section class="card"><h3>Công việc của tôi</h3>${myWorkHtml}</section>`);
  }

  // Chờ duyệt / ngoại lệ (người duyệt, giám sát, chủ quy trình) — dữ liệu thật.
  if (
    can(session, "processes.approve") ||
    can(session, "exceptions.handle") ||
    can(session, "executions.manage")
  ) {
    let pendingHtml = `<p class="empty">Đang tải…</p>`;
    try {
      const pendingItems: string[] = [];
      // Quy trình chờ duyệt.
      if (can(session, "processes.approve")) {
        try {
          const { items } = await api.listProcesses({ status: "IN_REVIEW" });
          for (const p of items.slice(0, 3)) {
            pendingItems.push(`<li><a href="#/processes/${p.id}">📋 <strong>${esc(p.code)}</strong> — Quy trình chờ duyệt</a></li>`);
          }
        } catch { /* bỏ qua */ }
      }
      // Ngoại lệ đang mở.
      if (can(session, "exceptions.handle")) {
        try {
          const { items } = await api.listExceptions("");
          const open = items.filter((x) => ["OPEN", "IN_PROGRESS"].includes(x.status)).slice(0, 3);
          for (const x of open) {
            pendingItems.push(`<li><a href="#/exceptions">⚠️ <strong>${esc(x.title)}</strong> — Ngoại lệ cần xử lý</a></li>`);
          }
        } catch { /* bỏ qua */ }
      }
      // Lượt chờ xác nhận.
      if (can(session, "executions.manage")) {
        try {
          const { items } = await api.listExecutions({ status: "PENDING_CONFIRMATION" });
          for (const e of items.slice(0, 3)) {
            pendingItems.push(`<li><a href="#/executions/${e.id}">✅ <strong>${esc(e.code)}</strong> — Lượt chờ xác nhận</a></li>`);
          }
        } catch { /* bỏ qua */ }
      }
      pendingHtml = pendingItems.length === 0
        ? `<p class="empty">Không có quy trình chờ duyệt hay ngoại lệ cần xử lý lúc này.</p>`
        : `<ul class="home-list">${pendingItems.join("")}</ul>`;
    } catch { pendingHtml = `<p class="empty">Không tải được dữ liệu.</p>`; }
    cards.push(`<section class="card"><h3>Chờ xử lý</h3>${pendingHtml}</section>`);
  }

  // Quản trị (admin).
  if (can(session, "users.manage")) {
    cards.push(`
      <section class="card">
        <h3>Quản trị</h3>
        <p class="empty">Cấp tài khoản và phân quyền cho người dùng trong đơn vị.</p>
        <button class="btn secondary" data-nav="#/users">Quản lý người dùng</button>
      </section>`);
  }

  // Quy trình — Task 1.4 đã có danh mục, liên kết tới trang quản lý.
  if (can(session, "processes.manage")) {
    cards.push(`
      <section class="card">
        <h3>Quy trình</h3>
        <p class="empty">Quản lý danh mục quy trình, phiên bản và phê duyệt phát hành.</p>
        <p><a href="#/processes" class="btn">Mở danh mục quy trình</a></p>
      </section>`);
  }

  if (cards.length === 0) {
    cards.push(`
      <section class="card">
        <h3>Bắt đầu</h3>
        <p class="empty">Tài khoản của bạn đã sẵn sàng. Liên hệ quản trị viên
        để được phân công công việc.</p>
      </section>`);
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Xin chào, ${esc(name)}</h2>
        <div class="roles">${session.roles.map((r) => `<span class="role-badge">${esc(roleLabel(r))}</span>`).join("")}</div>
      </div>
    </div>
    <div class="cards">${cards.join("")}</div>`;

  root.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => ctx.navigate(el.dataset.nav!));
  });
}
