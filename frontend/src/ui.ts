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
