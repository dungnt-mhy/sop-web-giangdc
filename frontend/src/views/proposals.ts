/**
 * Trang Đề xuất lượt công việc (#/proposals).
 * Nhân viên tạo đề xuất → người phê duyệt duyệt/từ chối.
 */
import { api, Proposal } from "../api.js";
import { esc, toast } from "../ui.js";

function openConfirmDialog(dialogRoot: HTMLElement, title: string, message: string, okLabel = "Xác nhận"): Promise<boolean> {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="dialog-overlay">
        <div class="dialog" style="max-width:400px;">
          <h3>${esc(title)}</h3>
          <p>${esc(message)}</p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
            <button class="btn" id="cd-cancel">Hủy</button>
            <button class="btn primary" id="cd-ok">${esc(okLabel)}</button>
          </div>
        </div>
      </div>`;
    const close = (v: boolean) => { dialogRoot.innerHTML = ""; resolve(v); };
    dialogRoot.querySelector("#cd-cancel")?.addEventListener("click", () => close(false));
    dialogRoot.querySelector("#cd-ok")?.addEventListener("click", () => close(true));
  });
}

function openReasonDialog(dialogRoot: HTMLElement, title: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="dialog-overlay">
        <div class="dialog" style="max-width:400px;">
          <h3>${esc(title)}</h3>
          <textarea id="rd-reason" class="input" rows="3" placeholder="${esc(placeholder)}"></textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
            <button class="btn" id="rd-cancel">Hủy</button>
            <button class="btn primary" id="rd-ok">Xác nhận</button>
          </div>
        </div>
      </div>`;
    const close = (v: string | null) => { dialogRoot.innerHTML = ""; resolve(v); };
    dialogRoot.querySelector("#rd-cancel")?.addEventListener("click", () => close(null));
    dialogRoot.querySelector("#rd-ok")?.addEventListener("click", () => {
      const v = dialogRoot.querySelector<HTMLTextAreaElement>("#rd-reason")!.value.trim();
      close(v || null);
    });
  });
}

function statusPill(status: string): string {
  const map: Record<string, string> = {
    PENDING: '<span class="pill" style="background:#fef3c7;color:#92400e;">⏳ Chờ duyệt</span>',
    APPROVED: '<span class="pill" style="background:#d1fae5;color:#065f46;">✅ Đã duyệt</span>',
    REJECTED: '<span class="pill" style="background:#fee2e2;color:#991b1b;">❌ Bị từ chối</span>',
    CANCELLED: '<span class="pill" style="background:#f3f4f6;color:#6b7280;">Đã hủy</span>',
  };
  return map[status] ?? esc(status);
}

function proposalCard(p: Proposal, isReceived: boolean): string {
  const canDecide = isReceived && p.status === "PENDING";
  return `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div>
          <div style="font-weight:600;">${esc(p.process_name ?? "—")}${p.title ? ` — ${esc(p.title)}` : ""}</div>
          <div class="muted small">Người đề xuất: ${esc(p.proposer_name ?? "—")} · ${esc(p.created_at?.slice(0, 16).replace("T", " ") ?? "")}</div>
          ${p.expected_start_at ? `<div class="muted small">Bắt đầu dự kiến: ${esc(p.expected_start_at.slice(0, 16).replace("T", " "))}</div>` : ""}
        </div>
        ${statusPill(p.status)}
      </div>
      <div style="margin-top:8px;padding:8px;background:#f9fafb;border-radius:6px;">
        <div class="small" style="font-weight:600;">Lý do đề xuất:</div>
        <div class="small">${esc(p.reason)}</div>
      </div>
      ${p.status === "REJECTED" && p.reject_reason ? `
        <div style="margin-top:8px;padding:8px;background:#fef2f2;border-radius:6px;">
          <div class="small" style="font-weight:600;color:#991b1b;">Lý do từ chối:</div>
          <div class="small">${esc(p.reject_reason)}</div>
        </div>` : ""}
      ${canDecide ? `
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn primary sm" data-proposal="approve" data-id="${esc(p.id)}">✅ Duyệt & tạo lượt</button>
          <button class="btn sm" data-proposal="reject" data-id="${esc(p.id)}">❌ Từ chối</button>
        </div>` : ""}
    </div>`;
}

export async function renderProposals(root: HTMLElement): Promise<void> {
  const url = new URL(window.location.href);
  const hashTab = (window.location.hash.match(/tab=(\w+)/) || [])[1];
  let tab: "received" | "sent" = hashTab === "sent" ? "sent" : "received";

  root.innerHTML = `
    <div class="page-head">
      <h2>💡 Đề xuất lượt công việc</h2>
      <button class="btn primary" id="btn-new-proposal">+ Đề xuất mới</button>
    </div>
    <div class="tabs" style="margin-bottom:16px;">
      <button class="tab ${tab === "received" ? "active" : ""}" data-tab="received">📥 Gửi đến tôi duyệt</button>
      <button class="tab ${tab === "sent" ? "active" : ""}" data-tab="sent">📤 Tôi đã đề xuất</button>
    </div>
    <div id="proposal-list"><div class="muted">Đang tải…</div></div>
    <div id="proposal-dialog-root"></div>`;

  const listEl = root.querySelector<HTMLElement>("#proposal-list")!;
  const dialogRoot = root.querySelector<HTMLElement>("#proposal-dialog-root")!;

  async function loadList(): Promise<void> {
    try {
      const { items } = await api.listProposals(tab);
      if (items.length === 0) {
        listEl.innerHTML = `<div class="muted" style="text-align:center;padding:32px;">Chưa có đề xuất nào.</div>`;
        return;
      }
      listEl.innerHTML = items.map((p) => proposalCard(p, tab === "received")).join("");
    } catch (e) {
      listEl.innerHTML = `<div class="error">Không tải được danh sách: ${esc((e as Error).message)}</div>`;
    }
  }

  // Chuyển tab.
  root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tab = btn.dataset.tab as "received" | "sent";
      root.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      window.location.hash = `#/proposals?tab=${tab}`;
      loadList();
    });
  });

  // Xử lý duyệt / từ chối.
  listEl.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-proposal]");
    if (!btn) return;
    const id = btn.dataset.id!;
    const action = btn.dataset.proposal!;

    if (action === "approve") {
      const confirmed = await openConfirmDialog(dialogRoot,
        "Duyệt đề xuất",
        "Duyệt đề xuất này? Lượt công việc sẽ được tạo với bạn là người phê duyệt.",
        "✅ Duyệt",
      );
      if (!confirmed) return;
      try {
        const result = await api.approveProposal(id);
        toast("Đã duyệt đề xuất.", "ok");
        // Chuyển sang trang tạo lượt với thông tin gợi ý.
        const s = result.suggest as Record<string, string>;
        const params = new URLSearchParams({
          process_id: String(s.process_id ?? ""),
          title: String(s.title ?? ""),
          assignee_id: String(s.assignee_id ?? ""),
          approver_ids: JSON.stringify(s.approver_ids ?? []),
        });
        if (s.expected_start_at) params.set("expected_start_at", String(s.expected_start_at));
        window.location.hash = `#/executions/new?${params.toString()}`;
      } catch (e) {
        toast(`Lỗi: ${(e as Error).message}`, "err");
      }
    } else if (action === "reject") {
      const reason = await openReasonDialog(dialogRoot,
        "Từ chối đề xuất",
        "Nhập lý do từ chối…",
      );
      if (!reason) return;
      try {
        await api.rejectProposal(id, reason);
        toast("Đã từ chối đề xuất.", "ok");
        loadList();
      } catch (e) {
        toast(`Lỗi: ${(e as Error).message}`, "err");
      }
    }
  });

  // Nút đề xuất mới.
  root.querySelector("#btn-new-proposal")?.addEventListener("click", () => {
    openProposalDialog(dialogRoot, loadList);
  });

  await loadList();
}

/** Dialog tạo đề xuất mới. */
async function openProposalDialog(dialogRoot: HTMLElement, onDone: () => void): Promise<void> {
  // Lấy danh sách quy trình có phiên bản hiệu lực.
  let processes: { id: string; name: string }[] = [];
  try {
    const res = await api.listProcesses({ status: "ACTIVE" });
    processes = res.items ?? [];
  } catch { /* bỏ qua */ }

  dialogRoot.innerHTML = `
    <div class="dialog-overlay">
      <div class="dialog" style="max-width:520px;">
        <h3>💡 Đề xuất lượt công việc mới</h3>
        <div class="form-group">
          <label>Quy trình *</label>
          <select id="pp-process" class="input">
            <option value="">— Chọn quy trình —</option>
            ${processes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Tiêu đề (tùy chọn)</label>
          <input id="pp-title" class="input" placeholder="VD: Xuất hàng đợt sáng" />
        </div>
        <div class="form-group">
          <label>Lý do đề xuất *</label>
          <textarea id="pp-reason" class="input" rows="3" placeholder="Giải thích tại sao cần thực hiện lượt này…"></textarea>
        </div>
        <div class="form-group">
          <label>Người phê duyệt *</label>
          <input id="pp-approver-search" class="input" placeholder="Gõ tên để tìm…" autocomplete="off" />
          <div id="pp-approver-results" class="user-search-results" style="display:none;"></div>
          <input type="hidden" id="pp-approver-id" />
          <div class="hint">Chỉ hiện người trong đơn vị bạn và cấp trên (theo cấu hình đơn vị).</div>
        </div>
        <div class="form-group">
          <label>Bắt đầu dự kiến</label>
          <input id="pp-start" type="datetime-local" class="input" />
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn" id="pp-cancel">Hủy</button>
          <button class="btn primary" id="pp-submit">Gửi đề xuất</button>
        </div>
      </div>
    </div>`;

  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#pp-cancel")?.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-overlay")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains("dialog-overlay")) close();
  });

  // Tìm kiếm người phê duyệt.
  const searchInput = dialogRoot.querySelector<HTMLInputElement>("#pp-approver-search")!;
  const resultsEl = dialogRoot.querySelector<HTMLElement>("#pp-approver-results")!;
  const hiddenId = dialogRoot.querySelector<HTMLInputElement>("#pp-approver-id")!;
  let debounce: ReturnType<typeof setTimeout>;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    hiddenId.value = "";
    if (q.length < 2) { resultsEl.style.display = "none"; return; }
    debounce = setTimeout(async () => {
      try {
        const { items } = await api.listApprovers(q);
        if (items.length === 0) {
          resultsEl.innerHTML = `<div class="user-search-item muted">Không tìm thấy.</div>`;
        } else {
          resultsEl.innerHTML = items.map((u) => `
            <div class="user-search-item" data-id="${esc(u.id)}" data-name="${esc(u.display_name)}">
              <div><strong>${esc(u.display_name)}</strong> <span class="muted small">@${esc(u.username)}</span></div>
              ${u.org_unit_name ? `<div class="muted small">${esc(u.org_unit_name)}</div>` : ""}
            </div>`).join("");
        }
        resultsEl.style.display = "block";
      } catch { /* bỏ qua */ }
    }, 300);
  });
  resultsEl.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".user-search-item[data-id]");
    if (!item) return;
    hiddenId.value = item.dataset.id!;
    searchInput.value = item.dataset.name!;
    resultsEl.style.display = "none";
  });

  // Gửi đề xuất.
  dialogRoot.querySelector("#pp-submit")?.addEventListener("click", async () => {
    const processId = dialogRoot.querySelector<HTMLSelectElement>("#pp-process")!.value;
    const title = dialogRoot.querySelector<HTMLInputElement>("#pp-title")!.value.trim();
    const reason = dialogRoot.querySelector<HTMLTextAreaElement>("#pp-reason")!.value.trim();
    const approverId = hiddenId.value;
    const startAt = dialogRoot.querySelector<HTMLInputElement>("#pp-start")!.value;

    if (!processId) { toast("Vui lòng chọn quy trình.", "err"); return; }
    if (!reason) { toast("Vui lòng nhập lý do đề xuất.", "err"); return; }
    if (!approverId) { toast("Vui lòng chọn người phê duyệt.", "err"); return; }

    try {
      await api.createProposal({
        process_id: processId,
        title: title || undefined,
        reason,
        approver_id: approverId,
        expected_start_at: startAt || undefined,
      });
      toast("Đã gửi đề xuất.", "ok");
      close();
      onDone();
    } catch (e) {
      toast(`Lỗi: ${(e as Error).message}`, "err");
    }
  });
}
