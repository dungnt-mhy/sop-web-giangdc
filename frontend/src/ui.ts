// ui.ts — helper DOM dùng chung (Task 1.2).

/** Escape HTML để chống XSS khi render dữ liệu user nhập. */
export function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nhãn tiếng Việt cho vai trò hệ thống. */
export const ROLE_LABELS: Record<string, string> = {
  admin: "Quản trị viên",
  process_owner: "Chủ quy trình",
  editor: "Soạn thảo",
  reviewer: "Thẩm định",
  approver: "Phê duyệt",
  executor: "Thực hiện",
  monitor: "Giám sát",
  viewer: "Xem",
};

/** Biểu tượng mắt mở / mắt đóng cho nút hiện-ẩn mật khẩu. */
export const EYE_OPEN_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
export const EYE_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="23" x2="23" y2="1"/></svg>';

/**
 * Ô nhập mật khẩu kèm nút hiện/ẩn (mắt). Dùng chung cho mọi form.
 * Gắn sự kiện bằng wirePasswordToggles(root) sau khi render.
 */
export function passwordField(opts: {
  name: string;
  id?: string;
  required?: boolean;
  minlength?: number;
  autocomplete?: string;
  placeholder?: string;
}): string {
  const attrs = [
    `type="password"`,
    `name="${esc(opts.name)}"`,
    opts.id ? `id="${esc(opts.id)}"` : "",
    opts.required ? "required" : "",
    opts.minlength ? `minlength="${opts.minlength}"` : "",
    `autocomplete="${esc(opts.autocomplete ?? "off")}"`,
    opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : "",
  ].filter(Boolean).join(" ");
  return `<span class="pw-wrap"><input ${attrs} /><button type="button" class="pw-toggle icon" data-pw-toggle aria-label="Hiện mật khẩu">${EYE_OPEN_SVG}</button></span>`;
}

/** Gắn sự kiện hiện/ẩn cho mọi ô mật khẩu trong root. */
export function wirePasswordToggles(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-pw-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".pw-wrap");
      const input = wrap?.querySelector<HTMLInputElement>("input");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF_SVG : EYE_OPEN_SVG;
      btn.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    });
  });
}

/** Icon cho các nút thao tác ở trang quản trị. */
const ICON_ATTRS = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
export const ICON_EDIT =
  `<svg ${ICON_ATTRS}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
export const ICON_LOCK =
  `<svg ${ICON_ATTRS}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
export const ICON_UNLOCK =
  `<svg ${ICON_ATTRS}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
export const ICON_KEY =
  `<svg ${ICON_ATTRS}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
export const ICON_TRASH =
  `<svg ${ICON_ATTRS}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Thông báo nổi (toast) — tự ẩn sau vài giây. */
export function toast(message: string, kind: "ok" | "err" = "ok"): void {
  let box = document.getElementById("toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast";
    box.setAttribute("role", "status");
    document.body.appendChild(box);
  }
  box.className = "toast show " + kind;
  box.textContent = message;
  window.clearTimeout((box as unknown as { _t?: number })._t);
  (box as unknown as { _t: number })._t = window.setTimeout(() => {
    box!.classList.remove("show");
  }, 3500);
}

/** Gắn loading cho nút submit: vô hiệu hoá + đổi nhãn, trả hàm khôi phục. */
export function setLoading(btn: HTMLButtonElement, loading: boolean, label: string): () => void {
  const original = btn.innerHTML;
  btn.disabled = loading;
  if (loading) {
    btn.innerHTML =
      '<span class="spinner" aria-hidden="true"></span>' + esc(label);
  }
  return () => {
    btn.disabled = false;
    btn.innerHTML = original;
  };
}
