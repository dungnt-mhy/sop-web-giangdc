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
