// views/executions.ts — lượt thực hiện quy trình (Task 1.6).
// Khớp SRS v1.6: EXE-001–009, EXE-011–013; §7.2; AC-04.

import { api, type Execution, type ExecutionDetail } from "../api.js";
import { esc, setLoading, toast } from "../ui.js";

/** Định dạng ngày giờ theo giờ địa phương (dd/mm/yyyy hh:mm). */
function fmtVn(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "—";
  }
}

const EXEC_STATUS_LABELS: Record<string, string> = {
  CREATED: "Mới tạo",
  IN_PROGRESS: "Đang thực hiện",
  PAUSED: "Tạm dừng",
  PENDING_CONFIRMATION: "Chờ xác nhận",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const EXEC_STATUS_PILL: Record<string, string> = {
  CREATED: "gray",
  IN_PROGRESS: "blue",
  PAUSED: "amber",
  PENDING_CONFIRMATION: "amber",
  COMPLETED: "green",
  CANCELLED: "red",
};

const STEP_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Chưa bắt đầu",
  IN_PROGRESS: "Đang làm",
  PENDING_REVIEW: "Chờ duyệt",
  PASSED: "Đạt",
  FAILED: "Không đạt",
  SKIPPED: "Bỏ qua",
  CANCELLED: "Đã hủy",
};

function execPill(status: string): string {
  return `<span class="pill ${EXEC_STATUS_PILL[status] ?? "gray"}">${esc(EXEC_STATUS_LABELS[status] ?? status)}</span>`;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "lỗi không xác định";
}

/** Trang "Công việc của tôi" (#/my-work) — danh sách lượt được giao (EXE-011). */
export async function renderMyWork(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Công việc của tôi</h2>
      <p class="page-sub">Các lượt thực hiện được giao cho bạn.</p></div>
      <button class="btn primary" id="btn-create-exec">+ Tạo lượt công việc mới</button>
    </div>
    <div class="filter-bar">
      <select id="flt-status" class="input" aria-label="Trạng thái">
        <option value="">Tất cả trạng thái</option>
        <option value="CREATED">Mới tạo</option>
        <option value="IN_PROGRESS">Đang thực hiện</option>
        <option value="PAUSED">Tạm dừng</option>
        <option value="PENDING_CONFIRMATION">Chờ xác nhận</option>
        <option value="COMPLETED">Hoàn thành</option>
        <option value="CANCELLED">Đã hủy</option>
      </select>
      <input type="date" id="flt-from" class="input" aria-label="Từ ngày" />
      <input type="date" id="flt-to" class="input" aria-label="Đến ngày" />
      <select id="flt-creator" class="input" aria-label="Người tạo">
        <option value="">Tất cả người tạo</option>
      </select>
      <button class="btn" id="btn-filter">Lọc</button>
    </div>
    <div class="table-wrap"><table class="tbl clickable-rows" id="exec-table">
      <thead><tr>
        <th>Mã lượt</th><th>Quy trình</th><th>Người tạo</th><th>Người thực hiện</th><th>Thời gian tạo</th><th>Bắt đầu (dự kiến)</th><th>Bắt đầu (thực tế)</th><th>Hoàn thành (thực tế)</th><th>Tiến độ</th><th>Trạng thái</th>
      </tr></thead>
      <tbody><tr><td colspan="10" class="empty">Đang tải…</td></tr></tbody>
    </table></div>
    <div class="pagination" id="exec-pagination" style="display:flex;gap:8px;justify-content:center;align-items:center;margin-top:12px;"></div>
    <div id="exec-dialog-root"></div>`;

  const tbody = root.querySelector<HTMLTableSectionElement>("#exec-table tbody")!;
  const dialogRoot = root.querySelector<HTMLElement>("#exec-dialog-root")!;
  const selStatus = root.querySelector<HTMLSelectElement>("#flt-status")!;
  const fromEl = root.querySelector<HTMLInputElement>("#flt-from")!;
  const toEl = root.querySelector<HTMLInputElement>("#flt-to")!;
  const creatorEl = root.querySelector<HTMLSelectElement>("#flt-creator")!;
  const paginationEl = root.querySelector<HTMLElement>("#exec-pagination")!;
  let currentPage = 1;
  const PAGE_SIZE = 20;

  // Tải danh sách người tạo.
  api.listUsers().then(({ items }) => {
    creatorEl.innerHTML = `<option value="">Tất cả người tạo</option>` + items.map((u) => `<option value="${esc(u.id)}">${esc(u.display_name || u.username)}</option>`).join("");
  }).catch(() => { /* bỏ qua */ });

  async function reload(): Promise<void> {
    tbody.innerHTML = `<tr><td colspan="10" class="empty">Đang tải…</td></tr>`;
    try {
      const { items, total, totalPages } = await api.listExecutions({
        mine: true,
        status: selStatus.value || undefined,
        from: fromEl.value || undefined,
        to: toEl.value || undefined,
        creator_id: creatorEl.value || undefined,
        page: currentPage,
        limit: PAGE_SIZE,
      });
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty">Chưa có lượt nào được giao cho bạn.</td></tr>`;
        return;
      }
      tbody.innerHTML = items.map((e) => {
        const p = e.progress;
        const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        const fmtDt = fmtVn;
        const ex = e as unknown as Record<string, unknown>;
        const createdAt = fmtDt(e.created_at);
        const expectedStart = ex.expected_start_at ? fmtDt(ex.expected_start_at as string) : "—";
        const startedAt = e.started_at ? fmtDt(e.started_at) : "—";
        const completedAt = e.completed_at ? fmtDt(e.completed_at) : "—";
        const creatorName = (ex.creator_name as string) || (ex.creator_display_name as string) || "—";
        const assigneeName = (ex.assignee_name as string) || "—";
        return `<tr data-id="${esc(e.id)}">
          <td><strong>${esc(e.code)}</strong>${e.title ? `<div class="muted small">${esc(e.title)}</div>` : ""}</td>
          <td>${esc(e.process_name ?? "—")}</td>
          <td>${esc(creatorName)}</td>
          <td>${esc(assigneeName)}</td>
          <td class="muted small">${createdAt}</td>
          <td class="muted small">${expectedStart}</td>
          <td>${startedAt}</td>
          <td class="muted small">${completedAt}</td>
          <td><div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
            <span class="muted small">${p?.done ?? 0}/${p?.total ?? 0}</span></td>
          <td>${execPill(e.status)}${(e.redo_steps ?? 0) > 0 ? ` <span class="pill amber" title="Bị từ chối: ${esc(e.last_redo_reason ?? "")}&#10;Người từ chối: ${esc(e.last_redo_by_name ?? "")}&#10;Lúc: ${esc(e.last_redo_at ?? "")}&#10;Số bước làm lại: ${e.redo_steps}">🔄 Trả lại (${e.redo_steps})</span>` : ""}</td>
        </tr>`;
      }).join("");
      // Phân trang.
      const tp = totalPages ?? 1;
      if (tp > 1) {
        paginationEl.innerHTML = `
          <button class="btn sm" id="pg-prev" ${currentPage <= 1 ? "disabled" : ""}>‹ Trước</button>
          <span class="muted small">Trang ${currentPage} / ${tp} (${total} lượt)</span>
          <button class="btn sm" id="pg-next" ${currentPage >= tp ? "disabled" : ""}>Sau ›</button>`;
        paginationEl.querySelector("#pg-prev")?.addEventListener("click", () => { if (currentPage > 1) { currentPage--; reload(); } });
        paginationEl.querySelector("#pg-next")?.addEventListener("click", () => { if (currentPage < tp) { currentPage++; reload(); } });
      } else {
        paginationEl.innerHTML = total > 0 ? `<span class="muted small">${total} lượt</span>` : "";
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">Không tải được: ${esc(msg(e))}</td></tr>`;
      paginationEl.innerHTML = "";
    }
  }

  tbody.addEventListener("click", (ev) => {
    const tr = (ev.target as HTMLElement).closest("tr");
    if (!tr?.dataset.id) return;
    const id = tr.dataset.id;
    // Nhấn vào dòng (không phải nút) → mở xem luôn.
    location.hash = "#/executions/" + id;
  });

  root.querySelector("#btn-filter")!.addEventListener("click", () => { currentPage = 1; reload(); });
  root.querySelector("#btn-create-exec")!.addEventListener("click", () => {
    openCreateExecDialog(dialogRoot, reload);
  });

  await reload();
}

/** Dialog tạo lượt mới — chọn quy trình có bản hiệu lực (EXE-001). */
function openCreateExecDialog(dialogRoot: HTMLElement, onDone: () => void): void {
  dialogRoot.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Tạo lượt thực hiện">
      <h3>Tạo lượt công việc mới</h3>
      <form id="exec-form" novalidate>
        <label>Quy trình <span class="req">*</span>
          <select class="input" name="process_id" id="exec-process" required>
            <option value="">Đang tải…</option>
          </select>
          <span class="hint">Chỉ hiện quy trình có phiên bản đang hiệu lực.</span></label>
        <label>Tiêu đề lượt <input class="input" name="title" maxlength="200"
          placeholder="VD: Xuất hàng đợt sáng 17/10" /></label>
        <label>Thời gian bắt đầu (dự kiến) <span class="req">*</span>
          <input class="input" type="datetime-local" name="expected_start_at" id="exec-start" required />
          <span class="hint">Có thể tạo trước, thực hiện sau.</span></label>
        <label>Thời gian hoàn thành (dự kiến)
          <input class="input" type="datetime-local" name="expected_end_at" id="exec-end" />
          <span class="hint">Ca làm việc sẽ tự xác định theo giờ bắt đầu.</span></label>
        <label>Người thực hiện chính
          <select class="input" name="assignee_id" id="exec-assignee">
            <option value="">Tôi (mặc định)</option>
          </select>
          <span class="hint">Để trống = người tạo cũng là người thực hiện chính.</span></label>
        <label>Người giám sát <span class="hint">(chọn nhiều)</span></label>
        <input class="input" type="search" id="exec-sup-search" placeholder="🔍 Tìm theo tên…" style="margin-bottom:6px" />
        <div class="check-list" id="exec-supervisors" style="max-height:120px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px"></div>
        <label>Người phê duyệt hoàn thành <span class="hint">(chọn nhiều)</span></label>
        <input class="input" type="search" id="exec-apr-search" placeholder="🔍 Tìm theo tên…" style="margin-bottom:6px" />
        <div class="check-list" id="exec-approvers" style="max-height:120px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px"></div>
        <span class="hint">Nếu chọn cụ thể: chỉ những người đó (hoặc quản trị viên) mới được phê duyệt hoàn thành. Để trống: giám sát/quản lý duyệt.</span>
        <p class="form-error" id="exec-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button type="button" class="btn" id="exec-cancel">Huỷ</button>
          <button type="submit" class="btn primary" id="exec-submit">Tạo lượt</button>
        </div>
      </form>
    </div>`;
  const close = () => {
    dialogRoot.innerHTML = "";
  };
  dialogRoot.querySelector("#exec-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-scrim")!.addEventListener("click", close);

  const sel = dialogRoot.querySelector<HTMLSelectElement>("#exec-process")!;
  const selAssignee = dialogRoot.querySelector<HTMLSelectElement>("#exec-assignee")!;
  const supList = dialogRoot.querySelector<HTMLElement>("#exec-supervisors")!;
  const aprList = dialogRoot.querySelector<HTMLElement>("#exec-approvers")!;
  // Tải danh sách người dùng cho ô chọn người thực hiện / giám sát / phê duyệt.
  const renderChecks = (el: HTMLElement, users: { id: string; display_name: string; username: string; position: string | null; position_name: string | null }[]) => {
    el.innerHTML = users.map((u) => {
      const posName = u.position_name ?? u.position;
      const label = posName ? `${esc(u.display_name)} — ${esc(posName)}` : esc(u.display_name);
      const checked = el.querySelector<HTMLInputElement>(`input[value="${u.id}"]:checked`) ? "checked" : "";
      return `<label class="check"><input type="checkbox" value="${esc(u.id)}" ${checked} /> ${label}</label>`;
    }).join("") || `<p class="empty">Không tìm thấy.</p>`;
  };
  let supUsers: { id: string; display_name: string; username: string; position: string | null; position_name: string | null }[] = [];
  let aprUsers: typeof supUsers = [];
  api.listActiveUsers().then((res) => {
    const items = res?.items ?? [];
    if (items.length > 0) {
      const opts = items.map((u) => {
        const posName = u.position_name ?? u.position;
        const label = posName ? `${esc(u.display_name)} — ${esc(posName)}` : esc(u.display_name);
        return `<option value="${esc(u.id)}">${label} (${esc(u.username)})</option>`;
      }).join("");
      selAssignee.innerHTML = `<option value="">Tôi (mặc định)</option>` + opts;
      supUsers = items;
      aprUsers = items;
      renderChecks(supList, supUsers);
      renderChecks(aprList, aprUsers);
    }
  }).catch(() => { /* giữ mặc định */ });
  // Tìm kiếm theo tên.
  const supSearch = dialogRoot.querySelector<HTMLInputElement>("#exec-sup-search")!;
  const aprSearch = dialogRoot.querySelector<HTMLInputElement>("#exec-apr-search")!;
  let supTimer: number | undefined;
  supSearch.addEventListener("input", () => {
    clearTimeout(supTimer);
    supTimer = window.setTimeout(async () => {
      const { items } = await api.listActiveUsers(supSearch.value.trim());
      supUsers = items ?? [];
      renderChecks(supList, supUsers);
    }, 300);
  });
  let aprTimer: number | undefined;
  aprSearch.addEventListener("input", () => {
    clearTimeout(aprTimer);
    aprTimer = window.setTimeout(async () => {
      const { items } = await api.listActiveUsers(aprSearch.value.trim());
      aprUsers = items ?? [];
      renderChecks(aprList, aprUsers);
    }, 300);
  });
  // Mặc định thời gian bắt đầu là hiện tại (giờ Việt Nam), hoàn thành dự kiến +3h.
  const startInput = dialogRoot.querySelector<HTMLInputElement>("#exec-start")!;
  const endInput = dialogRoot.querySelector<HTMLInputElement>("#exec-end")!;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  startInput.value = fmtLocal(now);
  const endDefault = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  endInput.value = fmtLocal(endDefault);
  // Khi đổi giờ bắt đầu, tự cập nhật giờ hoàn thành = +3h (nếu chưa sửa tay).
  let endTouched = false;
  endInput.addEventListener("input", () => { endTouched = true; });
  startInput.addEventListener("input", () => {
    if (!endTouched && startInput.value) {
      const s = new Date(startInput.value);
      if (!isNaN(s.getTime())) endInput.value = fmtLocal(new Date(s.getTime() + 3 * 60 * 60 * 1000));
    }
  });
  api.listProcesses({ status: "ACTIVE" }).then(({ items }) => {
    const available = items.filter((p) => p.active_version);
    if (available.length === 0) {
      sel.innerHTML = `<option value="">Chưa có quy trình nào hiệu lực</option>`;
      return;
    }
    sel.innerHTML = `<option value="">— Chọn quy trình —</option>` + available.map((p) =>
      `<option value="${esc(p.id)}">${esc(p.code)} — ${esc(p.name)}</option>`
    ).join("");
  }).catch(() => {
    sel.innerHTML = `<option value="">Không tải được danh sách</option>`;
  });

  const form = dialogRoot.querySelector<HTMLFormElement>("#exec-form")!;
  const errEl = dialogRoot.querySelector<HTMLElement>("#exec-error")!;
  const submitBtn = dialogRoot.querySelector<HTMLButtonElement>("#exec-submit")!;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errEl.hidden = true;
    const fd = new FormData(form);
    const process_id = String(fd.get("process_id") ?? "").trim();
    if (!process_id) {
      errEl.textContent = "Vui lòng chọn quy trình.";
      errEl.hidden = false;
      return;
    }
    const input: Record<string, unknown> = { process_id };
    const title = String(fd.get("title") ?? "").trim();
    if (title) input.title = title;
    const expected_start_at = String(fd.get("expected_start_at") ?? "").trim();
    if (!expected_start_at) {
      errEl.textContent = "Vui lòng chọn thời gian bắt đầu (dự kiến).";
      errEl.hidden = false;
      return;
    }
    input.expected_start_at = expected_start_at;
    const expected_end_at = String(fd.get("expected_end_at") ?? "").trim();
    if (expected_end_at) input.expected_end_at = expected_end_at;
    const shift = String(fd.get("shift") ?? "").trim();
    if (shift) input.shift = shift;
    const assignee_id = String(fd.get("assignee_id") ?? "").trim();
    if (assignee_id) input.assignee_id = assignee_id;
    const supervisor_ids = Array.from(dialogRoot.querySelectorAll<HTMLInputElement>('#exec-supervisors input:checked')).map((c) => c.value);
    if (supervisor_ids.length > 0) (input as Record<string, unknown>).supervisor_ids = supervisor_ids;
    const approver_ids = Array.from(dialogRoot.querySelectorAll<HTMLInputElement>('#exec-approvers input:checked')).map((c) => c.value);
    if (approver_ids.length > 0) (input as Record<string, unknown>).approver_ids = approver_ids;
    setLoading(submitBtn, true, "Đang tạo…");
    try {
      const created = await api.createExecution(input as { process_id: string; title?: string; expected_start_at: string; expected_end_at?: string; assignee_id?: string; supervisor_ids?: string[]; approver_ids?: string[] });
      toast(`Đã tạo lượt ${created.code}.`);
      close();
      onDone();
      location.hash = "#/executions/" + created.id;
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
      setLoading(submitBtn, false, "");
    }
  });
}

/** Trang chi tiết lượt thực hiện (#/executions/{id}) — thực hiện từng bước. */
export async function renderExecutionDetail(root: HTMLElement, execId: string): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><a href="#/my-work" class="link back">← Công việc của tôi</a>
      <h2 id="ex-code">Đang tải…</h2>
      <p class="page-sub" id="ex-sub"></p></div>
      <div class="head-actions" id="ex-actions"></div>
    </div>
    <div id="ex-body"><p class="empty">Đang tải…</p></div>
    <div id="exec-dialog-root"></div>`;

  const body = root.querySelector<HTMLElement>("#ex-body")!;
  const actionsEl = root.querySelector<HTMLElement>("#ex-actions")!;
  const dialogRoot = root.querySelector<HTMLElement>("#exec-dialog-root")!;
  let current: ExecutionDetail | null = null;

  async function reload(): Promise<void> {
    try {
      const e = await api.getExecution(execId);
      current = e;
      root.querySelector("#ex-code")!.textContent = e.code;
      root.querySelector("#ex-sub")!.textContent =
        `${e.process_name ?? ""}${(e as unknown as Record<string, unknown>).version_number ? ` v${(e as unknown as Record<string, unknown>).version_number}` : ""}${e.title ? " — " + e.title : ""}`;
      renderActions(actionsEl, dialogRoot, e, reload);
      // Lấy danh sách bước đang chờ duyệt bỏ qua (để hiển thị pill + chặn bắt đầu).
      let pendingSkipStepIds = new Set<string>();
      try {
        const { items } = await api.listSkipRequests(execId);
        pendingSkipStepIds = new Set(items.map((r) => String((r as Record<string, unknown>).step_id)));
      } catch { /* bỏ qua */ }
      body.innerHTML = detailHtml(e, pendingSkipStepIds);
      // Tải và hiển thị yêu cầu xin bỏ qua đang chờ.
      try {
        const { items } = await api.listSkipRequests(execId);
        if (items.length > 0) {
          const srHtml = `
            <div class="card" style="margin-bottom:16px;border-left:4px solid #f59e0b;">
              <h4 style="margin:0 0 8px;">🙏 Yêu cầu xin bỏ qua đang chờ (${items.length})</h4>
              ${(items as Record<string, unknown>[]).map((r) => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line);">
                  <div style="flex:1;">
                    <strong>${esc(String(r.step_code))}</strong> — ${esc(String(r.step_title))}<br/>
                    <span class="muted small">${esc(String(r.requester_name))}: ${esc(String(r.reason))}</span>
                  </div>
                  <button class="btn sm primary" data-skip-approve="${esc(String(r.step_id))}">✅ Duyệt</button>
                  <button class="btn sm danger" data-skip-reject="${esc(String(r.step_id))}">❌ Từ chối</button>
                </div>`).join("")}
            </div>`;
          body.insertAdjacentHTML("afterbegin", srHtml);
          body.querySelectorAll<HTMLButtonElement>("[data-skip-approve]").forEach((b) => {
            b.addEventListener("click", async () => {
              const ok = await openConfirmDialog(dialogRoot, "Duyệt yêu cầu", "Duyệt yêu cầu bỏ qua bước này?", "✅ Duyệt");
              if (!ok) return;
              await api.approveSkip(execId, b.dataset.skipApprove!);
              toast("Đã duyệt bỏ qua.");
              await reload();
            });
          });
          body.querySelectorAll<HTMLButtonElement>("[data-skip-reject]").forEach((b) => {
            b.addEventListener("click", async () => {
              const reason = await openReasonDialog(dialogRoot, "Từ chối yêu cầu bỏ qua", "VD: Bước này bắt buộc phải thực hiện...");
              if (!reason) return;
              await api.rejectSkip(execId, b.dataset.skipReject!, reason);
              toast("Đã từ chối.");
              await reload();
            });
          });
        }
      } catch { /* ignore */ }
      // Xử lý chuyển đổi Danh sách / Sơ đồ.
      const toggleBtns = body.querySelectorAll<HTMLButtonElement>(".toggle-btn[data-eview]");
      const listView = body.querySelector("[data-exec-list]") as HTMLElement | null;
      const diagramView = body.querySelector("[data-exec-diagram]") as HTMLElement | null;
      toggleBtns.forEach((tb) => {
        tb.addEventListener("click", () => {
          toggleBtns.forEach((x) => x.classList.remove("active"));
          tb.classList.add("active");
          const isDiagram = tb.dataset.eview === "diagram";
          if (listView) listView.hidden = isDiagram;
          if (diagramView) diagramView.hidden = !isDiagram;
        });
      });
      // Bấm node sơ đồ → chuyển về tab danh sách và cuộn tới bước.
      body.querySelectorAll<HTMLElement>("[data-goto-step]").forEach((node) => {
        node.addEventListener("click", () => {
          const sid = node.dataset.gotoStep!;
          // Chuyển về tab danh sách.
          toggleBtns.forEach((x) => x.classList.toggle("active", x.dataset.eview === "list"));
          if (listView) listView.hidden = false;
          if (diagramView) diagramView.hidden = true;
          // Cuộn tới bước và highlight.
          const li = body.querySelector(`li[data-sid="${sid}"]`);
          if (li) {
            li.scrollIntoView({ behavior: "smooth", block: "center" });
            li.classList.add("flash-highlight");
            setTimeout(() => li.classList.remove("flash-highlight"), 2000);
          }
        });
      });
      // Tải bằng chứng cho từng bước.
      await loadAllEvidence(body, e.id);
      // Hiển thị phân công từ dữ liệu đã có.
      renderAllAssignees(body, e.steps);
      // Tải lịch sử khi mở.
      bindStepHistory(body, e.id);
      // Bấm pill "Làm lại" để xem chi tiết.
      body.querySelectorAll<HTMLElement>(".redo-pill").forEach((pill) => {
        pill.addEventListener("click", async () => {
          const sid = pill.dataset.redoFor!;
          const step = e.steps.find((s) => s.id === sid);
          try {
            const { items } = await api.getStepHistory(e.id, sid);
            openRedoHistoryDialog(dialogRoot, step?.code ?? "", items as { reason: string | null; created_at: string; actor_name: string | null; action: string }[]);
          } catch {
            toast("Không tải được lịch sử làm lại.");
          }
        });
      });
      // Bấm pill "Bị trả lại" ở cấp lượt để xem chi tiết các bước.
      root.querySelectorAll<HTMLElement>(".exec-redo-pill").forEach((pill) => {
        pill.addEventListener("click", async () => {
          await openExecRedoDialog(dialogRoot, e.id, e.steps);
        });
      });
      // Bấm pill "Duyệt bởi" để xem lịch sử duyệt.
      body.querySelectorAll<HTMLElement>(".approve-pill").forEach((pill) => {
        pill.addEventListener("click", async () => {
          const sid = pill.dataset.approveFor!;
          const step = e.steps.find((s) => s.id === sid);
          try {
            const { items } = await api.getStepHistory(e.id, sid);
            openApproveHistoryDialog(dialogRoot, step?.code ?? "", items);
          } catch {
            toast("Không tải được lịch sử duyệt.");
          }
        });
      });
      // Tải danh sách ngoại lệ.
      const isActive = e.status === "IN_PROGRESS" || e.status === "PAUSED";
      await loadExceptions(body, dialogRoot, e.id, isActive, reload);
      // Xử lý chọn ảnh để tải lên (nén trước khi gửi).
      body.querySelectorAll<HTMLInputElement>("[data-ev-input]").forEach((input) => {
        input.addEventListener("change", async () => {
          const li = input.closest("li")!;
          const sid = li.dataset.sid!;
          const files = Array.from(input.files ?? []);
          input.value = "";
          if (files.length === 0) return;
          await uploadEvidenceFiles(body, e.id, sid, files);
        });
      });
    } catch (err) {
      body.innerHTML = `<p class="empty">Không tải được lượt: ${esc(msg(err))}</p>`;
    }
  }

  body.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-step]");
    if (!btn || !current) return;
    const sid = btn.closest("li")!.dataset.sid!;
    const act = btn.dataset.step!;
    const step = current.steps.find((x) => x.id === sid);
    const restore = setLoading(btn, true, "…");
    try {
      if (act === "start") {
        await api.startStep(execId, sid);
        toast("Đã bắt đầu bước.");
      } else if (act === "complete") {
        // Cảnh báo: sau khi hoàn thành không sửa được nữa.
        restore();
        openCompleteConfirm(dialogRoot, step, async (note) => {
          const rb = setLoading(btn, true, "…");
          try {
            await api.completeStep(execId, sid, note);
            toast("Đã hoàn thành bước.");
            await reload();
          } catch (e) {
            toast(`Lỗi: ${msg(e)}`);
            rb();
          }
        });
        return;
      } else if (act === "skip") {
        restore();
        const reason = await openReasonDialog(dialogRoot, `Lý do bỏ qua bước "${step?.code}"`, "VD: Khách không có nhu cầu, thiết bị hỏng...");
        if (!reason) return;
        setLoading(btn, true, "Đang xử lý…");
        await api.skipStep(execId, sid, reason);
        toast("Đã bỏ qua bước.");
      } else if (act === "request-skip") {
        restore();
        const reason = await openReasonDialog(dialogRoot, `Lý do xin bỏ qua bước "${step?.code}"`, "VD: Hết nguyên liệu, chờ xác nhận từ khách...");
        if (!reason) return;
        setLoading(btn, true, "Đang gửi…");
        await api.requestSkip(execId, sid, reason);
        toast("Đã gửi yêu cầu xin bỏ qua. Chờ giám sát duyệt.");
      } else if (act === "assign") {
        restore();
        const stepPositions = ((step as unknown as Record<string, unknown>)?.positions as { id: string; name: string }[] ?? []);
        await openAssignDialog(dialogRoot, execId, sid, step?.code ?? "", stepPositions, async () => {
          const e2 = await api.getExecution(execId);
          current = e2;
          renderAllAssignees(body, e2.steps);
        });
        return;
      } else if (act === "note") {
        restore();
        openNoteDialog(dialogRoot, step?.code ?? "", step?.note ?? "", async (note) => {
          await api.updateStepNote(execId, sid, note);
          // Cập nhật local, không reload toàn bộ.
          if (step) (step as unknown as Record<string, unknown>).note = note || null;
          // Cập nhật DOM trực tiếp.
          const li = body.querySelector(`li[data-sid="${sid}"]`);
          if (li) {
            const noteEl = li.querySelector(".step-head-note");
            const noteTitle = li.querySelector(".step-title > .muted.small");
            if (note) {
              if (noteEl) {
                noteEl.textContent = note;
              } else {
                // Thêm mới nếu chưa có.
                const title = li.querySelector(".step-title");
                if (title) {
                  const div1 = document.createElement("div");
                  div1.className = "muted small";
                  div1.textContent = "📝 Ghi chú:";
                  const div2 = document.createElement("div");
                  div2.className = "step-head-note";
                  div2.textContent = note;
                  title.appendChild(div1);
                  title.appendChild(div2);
                }
              }
            } else {
              // Xóa nếu ghi chú trống.
              if (noteEl) noteEl.remove();
              if (noteTitle && noteTitle.textContent?.includes("Ghi chú")) noteTitle.remove();
            }
          }
        });
        return;
      } else if (act === "approve") {
        restore();
        const ok = await openConfirmDialog(dialogRoot, "Duyệt bước", `Xác nhận bước "${step?.code}" đạt yêu cầu?`, "✅ Duyệt đạt");
        if (!ok) return;
        setLoading(btn, true, "Đang duyệt…");
        await api.approveStep(execId, sid);
        toast("Đã duyệt đạt.");
      } else if (act === "reject") {
        restore();
        const reason = await openReasonDialog(dialogRoot, `Lý do yêu cầu làm lại bước "${step?.code}"`, "VD: Chưa đủ ảnh bằng chứng, số lượng sai…");
        if (!reason) return;
        setLoading(btn, true, "Đang gửi…");
        await api.rejectStep(execId, sid, reason);
        toast("Đã gửi yêu cầu làm lại.");
      }
      await reload();
    } catch (e) {
      toast(`Lỗi: ${msg(e)}`);
      restore();
    }
  });

  await reload();
}

function renderActions(
  el: HTMLElement,
  dialogRoot: HTMLElement,
  e: ExecutionDetail,
  reload: () => void
): void {
  const btns: string[] = [];
  if (e.status === "CREATED") {
    btns.push(`<button class="btn primary" data-ea="start">Bắt đầu</button>`);
    btns.push(`<button class="btn warn" data-ea="edit">✏️ Sửa</button>`);
    btns.push(`<button class="btn danger" data-ea="cancel">🗑️ Hủy lượt</button>`);
  }
  if (e.status === "IN_PROGRESS") {
    btns.push(`<button class="btn" data-ea="pause">⏸️ Tạm dừng</button>`);
    btns.push(`<button class="btn primary" data-ea="report-complete">📢 Báo hoàn thành</button>`);
    btns.push(`<button class="btn danger" data-ea="cancel">🗑️ Hủy lượt</button>`);
  }
  if (e.status === "PENDING_CONFIRMATION") {
    btns.push(`<button class="btn primary" data-ea="confirm-complete">✅ Xác nhận hoàn thành</button>`);
    btns.push(`<button class="btn danger" data-ea="reject-confirmation">❌ Từ chối</button>`);
    btns.push(`<button class="btn danger" data-ea="cancel">🗑️ Hủy lượt</button>`);
  }
  if (e.status === "PAUSED") {
    btns.push(`<button class="btn primary" data-ea="resume">Tiếp tục</button>`);
    btns.push(`<button class="btn danger" data-ea="cancel">Hủy lượt</button>`);
  }
  // Nút xuất Word chỉ hiện khi lượt đã hoàn thành.
  if (e.status === "COMPLETED") {
    btns.push(`<button class="btn" data-ea="export-word">📄 Xuất Word</button>`);
    btns.push(`<button class="btn" data-ea="export-pdf">📕 Xuất PDF</button>`);
  }
  el.innerHTML = btns.join("");
  el.onclick = async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-ea]");
    if (!btn) return;
    const act = btn.dataset.ea!;
    const restore = setLoading(btn, true, "…");
    try {
      if (act === "start") {
        await api.startExecution(e.id);
        toast("Đã bắt đầu lượt.");
      } else if (act === "edit") {
        restore();
        openEditExecutionDialog(dialogRoot, e, async () => { await reload(); });
        return;
      } else if (act === "pause") {
        await api.pauseExecution(e.id);
        toast("Đã tạm dừng.");
      } else if (act === "resume") {
        await api.resumeExecution(e.id);
        toast("Đã tiếp tục.");
      } else if (act === "report-complete") {
        await api.reportComplete(e.id);
        toast("Đã báo hoàn thành. Chờ người phê duyệt xác nhận.");
      } else if (act === "confirm-complete") {
        await api.confirmComplete(e.id);
        toast("Đã xác nhận hoàn thành lượt.");
      } else if (act === "reject-confirmation") {
        restore();
        openRejectConfirmDialog(dialogRoot, e, async () => { await reload(); });
        return;
      } else if (act === "cancel") {
        restore();
        openCancelDialog(dialogRoot, e, async () => { await reload(); });
        return;
      } else if (act === "export-word") {
        restore();
        setLoading(btn, true, "Đang xuất…");
        try {
          await exportExecutionToWord(e);
          toast("Đã xuất file Word.");
        } catch (err) {
          toast(`Lỗi xuất Word: ${msg(err)}`);
        }
        restore();
        return;
      } else if (act === "export-pdf") {
        restore();
        setLoading(btn, true, "Đang xuất…");
        try {
          await exportExecutionToPdf(e);
          toast("Đã mở in PDF. Chọn 'Lưu thành PDF' để tải file.");
        } catch (err) {
          toast(`Lỗi xuất PDF: ${msg(err)}`);
        }
        restore();
        return;
      }
      await reload();
    } catch (err) {
      toast(`Lỗi: ${msg(err)}`);
      restore();
    }
  };
}

/** Xuất báo cáo lượt công việc ra PDF (qua in ấn). */
async function exportExecutionToPdf(e: ExecutionDetail): Promise<void> {
  const html2pdf = (window as unknown as Record<string, unknown>).html2pdf as ((el: HTMLElement, opts: unknown) => Promise<void>) | undefined;
  if (!html2pdf) throw new Error("Chưa tải được thư viện PDF. Hãy kiểm tra mạng và thử lại.");

  // Tạo element ẩn chứa nội dung báo cáo.
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;left:-9999px;top:0;width:800px;background:#fff;font-family:Arial,sans-serif;font-size:14px;padding:20px;";
  
  let html = `
    <h1 style="text-align:center;font-size:20px;">BÁO CÁO LƯỢT CÔNG VIỆC</h1>
    <h2 style="text-align:center;font-size:16px;">${esc(e.code)} — ${esc(e.title || (e as unknown as Record<string, unknown>).process_name as string || "")}</h2>

    <h2 style="font-size:16px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:24px;">I. THÔNG TIN CHUNG</h2>
    <table style="border-collapse:collapse;width:100%;margin:12px 0;">
      <tr><td style="border:1px solid #ccc;padding:8px;width:30%;background:#f5f5f5;"><strong>Mã lượt</strong></td><td style="border:1px solid #ccc;padding:8px;">${esc(e.code)}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:8px;background:#f5f5f5;"><strong>Tiêu đề</strong></td><td style="border:1px solid #ccc;padding:8px;">${esc(e.title || "—")}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:8px;background:#f5f5f5;"><strong>Quy trình</strong></td><td style="border:1px solid #ccc;padding:8px;">${esc((e as unknown as Record<string, unknown>).process_name as string || "")} (${esc((e as unknown as Record<string, unknown>).process_code as string || "")})</td></tr>
      <tr><td style="border:1px solid #ccc;padding:8px;background:#f5f5f5;"><strong>Trạng thái</strong></td><td style="border:1px solid #ccc;padding:8px;">${esc(e.status)}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:8px;background:#f5f5f5;"><strong>Người tạo</strong></td><td style="border:1px solid #ccc;padding:8px;">${esc((e as unknown as Record<string, unknown>).creator_name as string || "—")}</td></tr>
      <tr><td style="border:1px solid #ccc;padding:8px;background:#f5f5f5;"><strong>Người thực hiện chính</strong></td><td style="border:1px solid #ccc;padding:8px;">${esc((e as unknown as Record<string, unknown>).assignee_name as string || "—")}</td></tr>
      ${(e.redo_steps ?? 0) > 0 ? `<tr><td style="border:1px solid #ccc;padding:8px;background:#f5f5f5;"><strong>Số bước bị làm lại</strong></td><td style="border:1px solid #ccc;padding:8px;">${e.redo_steps} bước</td></tr>` : ""}
    </table>`;

  // Ngoại lệ.
  let hasExceptions = false;
  try {
    const { items: exItems } = await api.listExceptions(e.id);
    if (exItems.length > 0) {
      hasExceptions = true;
      html += `<h2 style="font-size:16px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:24px;">II. NGOẠI LỆ</h2>`;
      for (const ex of exItems) {
        html += `<div style="margin-bottom:16px;border:1px solid #ddd;padding:12px;border-radius:8px;"><h3 style="font-size:14px;">${esc(ex.title)} (${esc(ex.status)})</h3>`;
        if (ex.description) html += `<p>${esc(ex.description)}</p>`;
        if (ex.resolution) html += `<p><strong>Cách xử lý:</strong> ${esc(ex.resolution)}</p>`;
        html += `</div>`;
      }
    }
  } catch { /* bỏ qua */ }

  // Chi tiết bước.
  html += `<h2 style="font-size:16px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:24px;">${hasExceptions ? "III" : "II"}. CHI TIẾT CÁC BƯỚC</h2>`;
  for (let idx = 0; idx < e.steps.length; idx++) {
    const st = e.steps[idx] as unknown as Record<string, unknown>;
    html += `<div style="margin-bottom:20px;border:1px solid #ddd;padding:12px;border-radius:8px;page-break-inside:avoid;"><h3 style="font-size:14px;">Bước ${idx + 1}: ${esc(st.code as string)} — ${esc(st.title as string)}</h3>`;
    html += `<p><strong>Trạng thái:</strong> ${esc(st.status as string)}</p>`;
    const assignees = (st.assignees as { display_name: string }[] | undefined) || [];
    if (assignees.length > 0) html += `<p><strong>Người thực hiện:</strong> ${esc(assignees.map((a) => a.display_name).join(", "))}</p>`;
    if (st.note) html += `<p><strong>Ghi chú:</strong> ${esc(st.note as string)}</p>`;
    if (st.approved_by_name) html += `<p><strong>Duyệt bởi:</strong> ${esc(st.approved_by_name as string)}</p>`;

    try {
      const { items } = await api.listEvidence(e.id, st.id as string);
      const photos = items.filter((ev) => ev.kind === "PHOTO");
      const files = items.filter((ev) => ev.kind !== "PHOTO");
      if (photos.length > 0) {
        html += `<p><strong>Ảnh bằng chứng (${photos.length}):</strong></p>`;
        for (const photo of photos.slice(0, 5)) {
          try {
            const resp = await fetch(api.evidenceDownloadUrl(photo.id), { credentials: "include" });
            const blob = await resp.blob();
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            html += `<img src="${dataUrl}" style="max-width:400px;max-height:300px;margin:8px 0;display:block;" /><p><em>${esc(photo.original_name)}</em></p>`;
          } catch { /* bỏ qua ảnh lỗi */ }
        }
      }
      if (files.length > 0) {
        html += `<p><strong>Tệp đính kèm (${files.length}):</strong></p><ul>`;
        for (const f of files) {
          const fileUrl = new URL(api.evidenceDownloadUrl(f.id), window.location.origin).href;
          html += `<li>📄 <a href="${esc(fileUrl)}">${esc(f.original_name)}</a></li>`;
        }
        html += `</ul>`;
      }
    } catch { /* bỏ qua */ }
    html += `</div>`;
  }

  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await html2pdf(container, {
      margin: 10,
      filename: `BaoCao_${e.code}.pdf`,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    });
  } finally {
    document.body.removeChild(container);
  }
}

/** Xuất báo cáo lượt công việc ra file Word. */
async function exportExecutionToWord(e: ExecutionDetail): Promise<void> {
  const docxLib = (window as unknown as Record<string, unknown>).docx as {
    Document: new (opts: unknown) => unknown;
    Packer: { toBlob: (doc: unknown) => Promise<Blob> };
    Paragraph: new (opts: unknown) => unknown;
    TextRun: new (opts: unknown) => unknown;
    HeadingLevel: Record<string, string>;
    ImageRun: new (opts: unknown) => unknown;
    AlignmentType: Record<string, string>;
  } | undefined;
  if (!docxLib) throw new Error("Chưa tải được thư viện Word. Hãy kiểm tra mạng và thử lại.");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType } = docxLib;

  const children: any[] = [];

  // Tiêu đề.
  children.push(new Paragraph({
    text: `BÁO CÁO LƯỢT CÔNG VIỆC`,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
  }));
  children.push(new Paragraph({
    text: `${e.code} — ${e.title || (e as unknown as Record<string, unknown>).process_name as string || ""}`,
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.CENTER,
  }));
  children.push(new Paragraph({ text: "" }));

  // Thông tin chung.
  children.push(new Paragraph({ text: "I. THÔNG TIN CHUNG", heading: HeadingLevel.HEADING_1 }));
  const infoRows: [string, string][] = [
    ["Mã lượt", e.code],
    ["Quy trình", `${(e as unknown as Record<string, unknown>).process_name || ""} (${(e as unknown as Record<string, unknown>).process_code || ""})`],
    ["Trạng thái", e.status],
    ["Người tạo", (e as unknown as Record<string, unknown>).creator_name as string || "—"],
    ["Người thực hiện chính", (e as unknown as Record<string, unknown>).assignee_name as string || "—"],
    ["Tiêu đề", e.title || "—"],
  ];
  for (const [k, v] of infoRows) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] }));
  }
  children.push(new Paragraph({ text: "" }));

  // Ngoại lệ (nếu có).
  try {
    const { items: exItems } = await api.listExceptions(e.id);
    if (exItems.length > 0) {
      children.push(new Paragraph({ text: "II. NGOẠI LỆ", heading: HeadingLevel.HEADING_1 }));
      for (const ex of exItems) {
        children.push(new Paragraph({ children: [new TextRun({ text: `${ex.title}`, bold: true }), new TextRun(` (${ex.status})`)] }));
        if (ex.description) children.push(new Paragraph(ex.description));
        if (ex.resolution) children.push(new Paragraph({ children: [new TextRun({ text: "Cách xử lý: ", bold: true }), new TextRun(ex.resolution)] }));
        children.push(new Paragraph({ text: "" }));
      }
    }
  } catch { /* bỏ qua */ }

  // Chi tiết từng bước.
  children.push(new Paragraph({ text: "III. CHI TIẾT CÁC BƯỚC", heading: HeadingLevel.HEADING_1 }));
  
  for (let idx = 0; idx < e.steps.length; idx++) {
    const st = e.steps[idx] as unknown as Record<string, unknown>;
    children.push(new Paragraph({
      text: `Bước ${idx + 1}: ${st.code} — ${st.title}`,
      heading: HeadingLevel.HEADING_2,
    }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Trạng thái: ", bold: true }), new TextRun(STEP_STATUS_LABELS[st.status as string] || (st.status as string))] }));
    
    const assignees = (st.assignees as { display_name: string }[] | undefined) || [];
    if (assignees.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "Người thực hiện: ", bold: true }), new TextRun(assignees.map((a) => a.display_name).join(", "))] }));
    }
    const supAssignees = (st.supervisor_assignees as { display_name: string }[] | undefined) || [];
    if (supAssignees.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "Người giám sát: ", bold: true }), new TextRun(supAssignees.map((a) => a.display_name).join(", "))] }));
    }
    if (st.note) {
      children.push(new Paragraph({ children: [new TextRun({ text: "Ghi chú: ", bold: true }), new TextRun(st.note as string)] }));
    }
    if (st.approved_by_name) {
      children.push(new Paragraph({ children: [new TextRun({ text: "Duyệt bởi: ", bold: true }), new TextRun(`${st.approved_by_name}${st.approved_at ? ` (${fmtVn(st.approved_at as string)})` : ""}`)] }));
    }

    // Tải ảnh bằng chứng.
    try {
      const { items } = await api.listEvidence(e.id, st.id as string);
      const photos = items.filter((ev) => ev.kind === "PHOTO");
      const files = items.filter((ev) => ev.kind !== "PHOTO");
      if (photos.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: `Ảnh bằng chứng (${photos.length}):`, bold: true })] }));
        for (const photo of photos.slice(0, 10)) {
          try {
            const resp = await fetch(api.evidenceDownloadUrl(photo.id));
            const blob = await resp.blob();
            const arrayBuffer = await blob.arrayBuffer();
            children.push(new Paragraph({
              children: [new ImageRun({
                data: arrayBuffer,
                transformation: { width: 400, height: 300 },
                type: "png",
              })],
            }));
            children.push(new Paragraph({ text: photo.original_name, style: "Caption" }));
          } catch { /* bỏ qua ảnh lỗi */ }
        }
      }
      if (files.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: `Tệp đính kèm (${files.length}):`, bold: true })] }));
        for (const f of files) {
          const fileUrl = api.evidenceDownloadUrl(f.id);
          children.push(new Paragraph({
            children: [
              new TextRun("📄 "),
              new (docxLib as any).ExternalHyperlink({
                children: [new TextRun({ text: f.original_name, style: "Hyperlink" })],
                link: fileUrl,
              }),
            ],
            bullet: { level: 0 },
          }));
        }
      }
    } catch { /* bỏ qua */ }
    
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BaoCao_${e.code}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Tải và hiển thị bằng chứng cho tất cả các bước. */
async function loadAllEvidence(body: HTMLElement, execId: string): Promise<void> {
  const sections = body.querySelectorAll<HTMLElement>("[data-evidence-for]");
  await Promise.all(
    Array.from(sections).map(async (sec) => {
      const sid = sec.dataset.evidenceFor!;
      try {
        const { items } = await api.listEvidence(execId, sid);
        renderEvidenceGrid(sec, execId, sid, items);
      } catch {
        // Không chặn hiển thị chính nếu tải bằng chứng lỗi.
      }
    })
  );
}

function renderEvidenceGrid(
  sec: HTMLElement,
  execId: string,
  sid: string,
  items: import("../api.js").Evidence[]
): void {
  const grid = sec.querySelector("[data-ev-grid]") as HTMLElement;
  const countEl = sec.querySelector("[data-ev-count]") as HTMLElement;
  countEl.textContent = items.length > 0 ? `(${items.length})` : "";
  const canDelete = !!sec.querySelector("[data-ev-input]");
  grid.innerHTML = items
    .map(
      (ev) => `
      <div class="evidence-item" data-evid="${esc(ev.id)}">
        <a href="${esc(api.evidenceDownloadUrl(ev.id))}" target="_blank" rel="noopener" title="${esc(ev.original_name)}">
          ${ev.kind === "PHOTO"
            ? `<img src="${esc(api.evidenceDownloadUrl(ev.id))}" alt="${esc(ev.original_name)}" loading="lazy" />`
            : `<div class="evidence-file">📄 ${esc(ev.original_name)}</div>`}
        </a>
        <div class="evidence-meta">${esc(formatBytes(ev.size_bytes))}</div>
        <div class="evidence-audit">👤 ${esc(ev.uploader_name ?? "—")}<br/>🕐 ${esc(formatDateTime(ev.created_at))}</div>
        ${canDelete ? `<button class="evidence-del" data-ev-del title="Xóa">✕</button>` : ""}
      </div>`
    )
    .join("");
  grid.querySelectorAll<HTMLButtonElement>("[data-ev-del]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const evid = btn.closest("[data-evid]")!.getAttribute("data-evid")!;
      if (!confirm("Xóa bằng chứng này?")) return;
      try {
        await api.deleteEvidence(evid);
        toast("Đã xóa bằng chứng.");
        const { items: fresh } = await api.listEvidence(execId, sid);
        renderEvidenceGrid(sec, execId, sid, fresh);
      } catch (e) {
        toast(`Lỗi: ${msg(e)}`);
      }
    });
  });
}

/** Nén (nếu là ảnh) và tải lên các tệp đã chọn. */
async function uploadEvidenceFiles(
  body: HTMLElement,
  execId: string,
  sid: string,
  files: File[]
): Promise<void> {
  const sec = body.querySelector<HTMLElement>(`[data-evidence-for="${sid}"]`);
  if (!sec) return;
  const { compressImage, formatBytes: fmt } = await import("../image.js");
  let done = 0;
  let failed = 0;
  for (const f of files) {
    try {
      const isImage = f.type.startsWith("image/");
      let toUpload = f;
      if (isImage) {
        toast(`Đang nén ${f.name}…`);
        const { file: compressed, originalBytes, compressedBytes, wasCompressed } = await compressImage(f);
        if (wasCompressed) {
          toast(`Đã nén ${fmt(originalBytes)} → ${fmt(compressedBytes)}. Đang tải lên…`);
        } else {
          toast(`Đang tải lên ${f.name}…`);
        }
        toUpload = compressed;
      } else {
        // Tệp tài liệu: kiểm tra dung lượng 10MB phía client.
        if (f.size > 10 * 1024 * 1024) {
          throw new Error("Tệp vượt quá 10MB.");
        }
        toast(`Đang tải lên ${f.name}…`);
      }
      await api.uploadEvidence(execId, sid, toUpload);
      done++;
    } catch (e) {
      failed++;
      toast(`Lỗi ${f.name}: ${msg(e)}`);
    }
  }
  if (done > 0) {
    toast(`Đã tải lên ${done} ảnh${failed > 0 ? `, ${failed} lỗi` : ""}.`);
    const { items } = await api.listEvidence(execId, sid);
    renderEvidenceGrid(sec, execId, sid, items);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/** Dialog xác nhận hoàn thành bước — cảnh báo không sửa được sau khi chốt. */
function openCompleteConfirm(
  dialogRoot: HTMLElement,
  step: import("../api.js").ExecutionStep | undefined,
  onConfirm: (note: string) => void
): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Xác nhận hoàn thành">
        <h3>Hoàn thành bước "${esc(step?.code ?? "")}"?</h3>
        <p>⚠️ Sau khi hoàn thành, <strong>bạn sẽ không thể sửa đổi</strong> bước này nữa
        (không thêm/xóa ảnh, không sửa trạng thái, <strong>không thay đổi người được người thực hiện</strong>).
        Người thực hiện sẽ được cố định. Hãy kiểm tra kỹ bằng chứng và thông tin trước khi xác nhận.</p>
        <label class="field">
          <span>📝 Ghi chú hoàn thành <span class="muted small">(tùy chọn)</span></span>
          <textarea id="cc-note" rows="3" placeholder="VD: Đã kiểm tra đủ số lượng, đóng gói cẩn thận…" style="width:100%;resize:vertical;">${esc(step?.note ?? "")}</textarea>
        </label>
        <div class="dialog-actions">
          <button type="button" class="btn" id="cc-cancel">Kiểm tra lại</button>
          <button type="button" class="btn primary" id="cc-ok">Xác nhận hoàn thành</button>
        </div>
      </div>
    </div>`;
  const close = () => {
    dialogRoot.innerHTML = "";
  };
  dialogRoot.querySelector("#cc-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector("#cc-ok")!.addEventListener("click", () => {
    const note = dialogRoot.querySelector<HTMLTextAreaElement>("#cc-note")!.value.trim();
    close();
    onConfirm(note);
  });
}

/** Dialog sửa lượt công việc ở trạng thái Mới tạo. */
function openEditExecutionDialog(
  dialogRoot: HTMLElement,
  e: import("../api.js").Execution,
  onDone: () => Promise<void>
): void {
  api.getExecution(e.id).then((detail) => {
    const d = detail as unknown as Record<string, unknown>;
    dialogRoot.innerHTML = `
      <div class="dialog-backdrop" data-close>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Sửa lượt công việc">
          <h3>✏️ Sửa lượt "${esc(e.code)}"</h3>
          <form id="edit-exec-form">
            <label>Tiêu đề
              <input class="input" name="title" maxlength="200" value="${esc((d.title as string) ?? "")}"
                placeholder="VD: Xuất hàng đợt sáng" /></label>
            <label>Thời gian bắt đầu (dự kiến) <span class="req">*</span>
              <input class="input" type="datetime-local" name="expected_start_at" required
                value="${esc(((d.expected_start_at as string) ?? "").slice(0, 16))}" /></label>
            <label>Thời gian hoàn thành (dự kiến)
              <input class="input" type="datetime-local" name="expected_end_at"
                value="${esc(((d.expected_end_at as string) ?? "").slice(0, 16))}" />
              <span class="hint">Ca làm việc sẽ tự cập nhật theo giờ bắt đầu.</span></label>
            <p class="muted small">Người thực hiện, giám sát, phê duyệt: sửa ở màn hình phân công sau khi tạo. Chỉ sửa được khi lượt còn ở trạng thái "Mới tạo".</p>
            <p class="form-error" id="edit-exec-error" role="alert" hidden></p>
            <div class="dialog-actions">
              <button type="button" class="btn" id="edit-exec-cancel">Huỷ</button>
              <button type="submit" class="btn primary">Lưu</button>
            </div>
          </form>
        </div>
      </div>`;
    const close = () => { dialogRoot.innerHTML = ""; };
    dialogRoot.querySelector("#edit-exec-cancel")!.addEventListener("click", close);
    dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
    });
    dialogRoot.querySelector<HTMLFormElement>("#edit-exec-form")!.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target as HTMLFormElement);
      const errEl = dialogRoot.querySelector<HTMLElement>("#edit-exec-error")!;
      try {
        await api.updateExecution(e.id, {
          title: String(fd.get("title") ?? "").trim() || null,
          expected_start_at: String(fd.get("expected_start_at") ?? ""),
          expected_end_at: String(fd.get("expected_end_at") ?? "") || null,
        });
        toast("Đã lưu thay đổi.");
        close();
        await onDone();
      } catch (err) {
        errEl.textContent = msg(err);
        errEl.hidden = false;
      }
    });
  }).catch((err) => {
    toast(`Lỗi: ${msg(err)}`);
  });
}

/** Dialog hủy lượt công việc — nhập lý do hủy. */
function openCancelDialog(
  dialogRoot: HTMLElement,
  e: import("../api.js").Execution,
  onDone: () => Promise<void>
): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Hủy lượt công việc">
        <h3>🗑️ Hủy lượt "${esc(e.code)}"?</h3>
        <p>⚠️ Lượt bị hủy sẽ <strong>không thể tiếp tục</strong>. Hãy nhập lý do hủy bên dưới.</p>
        <form id="cancel-form">
          <label style="color:#dc2626;font-weight:600;">Lý do hủy <span class="req">*</span>
            <textarea class="input" name="reason" maxlength="500" rows="3"
              placeholder="VD: Nhập sai quy trình, tạo lại lượt mới…"></textarea></label>
          <p class="form-error" id="cancel-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="cancel-no">Không hủy</button>
            <button type="submit" class="btn danger">Xác nhận hủy</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#cancel-no")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#cancel-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const reason = String(fd.get("reason") ?? "").trim();
    const errEl = dialogRoot.querySelector<HTMLElement>("#cancel-error")!;
    if (!reason) {
      errEl.textContent = "Vui lòng nhập lý do hủy.";
      errEl.hidden = false;
      return;
    }
    try {
      await api.cancelExecution(e.id, reason);
      toast("Đã hủy lượt.");
      close();
      await onDone();
    } catch (err) {
      errEl.textContent = msg(err);
      errEl.hidden = false;
    }
  });
}

/** Dialog từ chối xác nhận hoàn thành — 2 phương án: hủy lượt hoặc yêu cầu làm lại bước. */
function openRejectConfirmDialog(
  dialogRoot: HTMLElement,
  e: import("../api.js").Execution,
  onDone: () => Promise<void>
): void {
  // Lấy danh sách bước để chọn làm lại.
  api.getExecution(e.id).then((detail) => {
    const steps = (detail as unknown as { steps: { id: string; code: string; title: string }[] }).steps ?? [];
    dialogRoot.innerHTML = `
      <div class="dialog-backdrop" data-close>
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Từ chối xác nhận">
          <h3>❌ Từ chối xác nhận hoàn thành?</h3>
          <p class="muted">Chọn các bước cần làm lại bên dưới. Các bước được chọn sẽ quay về trạng thái "Chưa bắt đầu" để thực hiện lại.</p>
          <form id="rej-form">
            <div id="rej-steps" style="margin:10px 0;max-height:200px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;">
              ${steps.map((s) => `
                <label class="check"><input type="checkbox" name="step_ids" value="${esc(s.id)}" />
                  ${esc(s.code)} — ${esc(s.title)}</label>`).join("")}
            </div>
            <label>Lý do từ chối <span class="req">*</span>
              <textarea class="input" name="reason" maxlength="500" rows="3"
                placeholder="VD: Bước 3 ảnh chưa rõ, cần chụp lại…"></textarea></label>
            <p class="form-error" id="rej-error" role="alert" hidden></p>
            <div class="dialog-actions">
              <button type="button" class="btn" id="rej-cancel">Huỷ</button>
              <button type="submit" class="btn danger">Từ chối</button>
            </div>
          </form>
        </div>
      </div>`;
    const close = () => { dialogRoot.innerHTML = ""; };
    dialogRoot.querySelector("#rej-cancel")!.addEventListener("click", close);
    dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
    });
    dialogRoot.querySelector<HTMLFormElement>("#rej-form")!.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target as HTMLFormElement);
      const reason = String(fd.get("reason") ?? "").trim();
      const errEl = dialogRoot.querySelector<HTMLElement>("#rej-error")!;
      if (!reason) {
        errEl.textContent = "Vui lòng nhập lý do từ chối.";
        errEl.hidden = false;
        return;
      }
      const stepIds = fd.getAll("step_ids").map(String).filter(Boolean);
      if (stepIds.length === 0) {
        errEl.textContent = "Vui lòng chọn ít nhất 1 bước cần làm lại.";
        errEl.hidden = false;
        return;
      }
      try {
        await api.rejectConfirmation(e.id, { action: "redo", reason, step_ids: stepIds });
        toast(`Đã yêu cầu làm lại ${stepIds.length} bước.`);
        close();
        await onDone();
      } catch (err) {
        errEl.textContent = msg(err);
        errEl.hidden = false;
      }
    });
  }).catch((err) => {
    toast(`Lỗi: ${msg(err)}`);
  });
}

/** Tải và hiển thị danh sách ngoại lệ. */
async function loadExceptions(
  body: HTMLElement,
  dialogRoot: HTMLElement,
  execId: string,
  active: boolean,
  reload: () => void
): Promise<void> {
  const listEl = body.querySelector<HTMLElement>("#exc-list")!;
  const countEl = body.querySelector("[data-exc-count]") as HTMLElement;
  try {
    const { items } = await api.listExceptions(execId);
    countEl.textContent = items.length > 0 ? `(${items.length})` : "";
    if (items.length === 0) {
      listEl.innerHTML = `<p class="empty">Chưa có ngoại lệ nào.</p>`;
    } else {
      const SEV_LABEL: Record<string, string> = { LOW: "Thấp", MEDIUM: "Trung bình", HIGH: "Cao", CRITICAL: "Nghiêm trọng" };
      const ST_LABEL: Record<string, string> = { OPEN: "Mới", IN_PROGRESS: "Đang xử lý", RESOLVED: "Đã khắc phục", CLOSED: "Đã đóng" };
      const stPill: Record<string, string> = { OPEN: "orange", IN_PROGRESS: "blue", RESOLVED: "green", CLOSED: "gray" };
      listEl.innerHTML = items.map((ex) => `
        <div class="exception-item" data-exid="${esc(ex.id)}">
          <div class="exception-head">
            <strong>${esc(ex.title)}</strong>
            <span class="pill ${stPill[ex.status] ?? "gray"}">${esc(ST_LABEL[ex.status] ?? ex.status)}</span>
            <span class="pill gray">${esc(SEV_LABEL[ex.severity] ?? ex.severity)}</span>
          </div>
          <p class="exception-desc">${esc(ex.description)}</p>
          ${ex.step_code ? `<div class="muted small">Bước: ${esc(ex.step_code)}</div>` : ""}
          ${ex.resolution ? `<div class="muted small">Khắc phục: ${esc(ex.resolution)}</div>` : ""}
          <div class="muted small">Báo bởi ${esc(ex.creator_name ?? "—")} · ${esc(ex.created_at.slice(0, 16).replace("T", " "))}</div>
          <div class="exception-actions">
            ${ex.status === "OPEN" ? `<button class="btn sm" data-exc="start">Nhận xử lý</button>` : ""}
            ${["OPEN", "IN_PROGRESS"].includes(ex.status) ? `<button class="btn sm primary" data-exc="resolve">Ghi nhận khắc phục</button>` : ""}
            ${ex.status === "RESOLVED" ? `<button class="btn sm" data-exc="close">Đóng</button>` : ""}
          </div>
        </div>`).join("");
      listEl.querySelectorAll<HTMLButtonElement>("[data-exc]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const exid = btn.closest("[data-exid]")!.getAttribute("data-exid")!;
          const act = btn.dataset.exc!;
          if (act === "start") {
            try {
              await api.startException(exid);
              toast("Đã nhận xử lý ngoại lệ.");
              await loadExceptions(body, dialogRoot, execId, active, reload);
            } catch (e) { toast(`Lỗi: ${msg(e)}`); }
          } else if (act === "resolve") {
            openResolveDialog(dialogRoot, exid, async () => {
              await loadExceptions(body, dialogRoot, execId, active, reload);
            });
          } else if (act === "close") {
            const note = await openReasonDialog(dialogRoot, "Đóng ngoại lệ", "Ghi chú khi đóng (tùy chọn)");
            if (note === null) return;
            try {
              await api.closeException(exid, note || undefined);
              toast("Đã đóng ngoại lệ.");
              await loadExceptions(body, dialogRoot, execId, active, reload);
            } catch (e) { toast(`Lỗi: ${msg(e)}`); }
          }
        });
      });
    }
    // Nút báo ngoại lệ.
    body.querySelector("[data-exc-act='create']")?.addEventListener("click", () => {
      openCreateExceptionDialog(dialogRoot, execId, async () => {
        await loadExceptions(body, dialogRoot, execId, active, reload);
      });
    });
  } catch {
    listEl.innerHTML = `<p class="empty">Không tải được ngoại lệ.</p>`;
  }
}

/** Dialog tạo ngoại lệ mới. */
function openCreateExceptionDialog(dialogRoot: HTMLElement, execId: string, onDone: () => void): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Báo ngoại lệ">
        <h3>⚠️ Báo ngoại lệ</h3>
        <form id="exc-form">
          <label>Tiêu đề <span class="req">*</span>
            <input class="input" name="title" required maxlength="200" placeholder="VD: Hàng bị móp méo" /></label>
          <label>Mô tả sự cố <span class="req">*</span>
            <textarea class="input" name="description" rows="3" required placeholder="Mô tả chi tiết sự cố..."></textarea></label>
          <label>Mức độ
            <select class="input" name="severity">
              <option value="LOW">Thấp</option>
              <option value="MEDIUM" selected>Trung bình</option>
              <option value="HIGH">Cao</option>
              <option value="CRITICAL">Nghiêm trọng</option>
            </select></label>
          <p class="form-error" id="exc-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="exc-cancel">Huỷ</button>
            <button type="submit" class="btn primary">Báo ngoại lệ</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#exc-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#exc-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const errEl = dialogRoot.querySelector<HTMLElement>("#exc-error")!;
    try {
      await api.createException(execId, {
        title: String(fd.get("title") ?? "").trim(),
        description: String(fd.get("description") ?? "").trim(),
        severity: String(fd.get("severity") ?? "MEDIUM"),
      });
      toast("Đã báo ngoại lệ.");
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
    }
  });
}

/** Dialog ghi nhận cách khắc phục. */
function openResolveDialog(dialogRoot: HTMLElement, exceptionId: string, onDone: () => void): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Ghi nhận khắc phục">
        <h3>Ghi nhận khắc phục</h3>
        <form id="exc-resolve-form">
          <label>Cách khắc phục <span class="req">*</span>
            <textarea class="input" name="resolution" rows="4" required placeholder="Mô tả cách đã xử lý..."></textarea></label>
          <p class="form-error" id="exc-resolve-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="exc-resolve-cancel">Huỷ</button>
            <button type="submit" class="btn primary">Xác nhận đã khắc phục</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#exc-resolve-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#exc-resolve-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const errEl = dialogRoot.querySelector<HTMLElement>("#exc-resolve-error")!;
    try {
      await api.resolveException(exceptionId, String(fd.get("resolution") ?? "").trim());
      toast("Đã ghi nhận khắc phục.");
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
    }
  });
}

const SHIFT_LABEL: Record<string, string> = { MORNING: "sáng", NOON: "trưa", AFTERNOON: "chiều", NIGHT: "đêm" };

/** Dialog xem chi tiết các bước bị trả lại (tổng hợp cấp bước). */
async function openExecRedoDialog(
  dialogRoot: HTMLElement,
  execId: string,
  steps: import("../api.js").ExecutionStep[]
): Promise<void> {
  const redone = steps.filter((s) => ((s as unknown as Record<string, unknown>).redo_count as number ?? 0) > 0);
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Các bước bị làm lại">
        <h3>🔄 Các bước bị làm lại (${redone.length} bước)</h3>
        <div class="redo-hist-list"><span class="muted small">Đang tải…</span></div>
        <div class="dialog-actions">
          <button type="button" class="btn" id="exec-redo-close">Đóng</button>
        </div>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#exec-redo-close")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  // Tải lịch sử đầy đủ cho từng bước.
  const listEl = dialogRoot.querySelector<HTMLElement>(".redo-hist-list")!;
  try {
    const histories = await Promise.all(redone.map((s) => api.getStepHistory(execId, s.id)));
    listEl.innerHTML = redone.map((s, idx) => {
      const r = s as unknown as Record<string, unknown>;
      const items = histories[idx].items.filter((h) => h.action === "REJECTED");
      const total = items.length;
      return `
      <div class="hist-item" style="margin-bottom:12px;">
        <div><span class="hist-action">${esc(s.code)}</span> — ${esc(s.title)} <span class="pill amber">Làm lại ${r.redo_count} lần</span></div>
        ${items.map((h, i) => `
          <div style="margin-top:6px;padding-left:12px;border-left:2px solid #f59e0b;">
            <div><strong>Lần ${total - i}</strong> <span class="muted small">👤 ${esc(h.actor_name ?? "—")} · 🕐 ${esc(formatDateTime(h.created_at))}</span></div>
            <div class="hist-reason">Lý do: ${esc(h.reason ?? "—")}</div>
          </div>`).join("")}
      </div>`;
    }).join("");
  } catch {
    listEl.innerHTML = `<span class="muted small">Không tải được chi tiết.</span>`;
  }
}

/** Dialog xem lịch sử duyệt bước. */
function openApproveHistoryDialog(
  dialogRoot: HTMLElement,
  stepCode: string,
  items: { action: string; reason: string | null; created_at: string; actor_name: string | null }[]
): void {
  const approved = items.filter((h) => h.action === "APPROVED");
  const total = approved.length;
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Lịch sử duyệt">
        <h3>✅ Lịch sử duyệt — bước "${esc(stepCode)}" (${total} lần)</h3>
        <div class="redo-hist-list">
        ${approved.length === 0 ? `<p class="muted">Chưa có lần duyệt nào.</p>` : approved.map((h, i) => `
          <div class="hist-item">
            <div><span class="hist-action">Lần ${total - i}</span> <span class="muted small">👤 ${esc(h.actor_name ?? "—")} · 🕐 ${esc(formatDateTime(h.created_at))}</span></div>
          </div>`).join("")}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn" id="approve-hist-close">Đóng</button>
        </div>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#approve-hist-close")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
}

/** Dialog xem chi tiết các lần làm lại. */
function openRedoHistoryDialog(
  dialogRoot: HTMLElement,
  stepCode: string,
  items: { action: string; reason: string | null; created_at: string; actor_name: string | null }[]
): void {
  const rejected = items.filter((h) => h.action === "REJECTED");
  const total = rejected.length;
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Lịch sử làm lại">
        <h3>🔄 Lịch sử làm lại — bước "${esc(stepCode)}"</h3>
        <div class="redo-hist-list">
        ${rejected.length === 0 ? `<p class="muted">Chưa có lần làm lại nào.</p>` : rejected.map((h, i) => `
          <div class="hist-item">
            <div><span class="hist-action">Lần ${total - i}</span> <span class="muted small">👤 ${esc(h.actor_name ?? "—")} · 🕐 ${esc(formatDateTime(h.created_at))}</span></div>
            ${h.reason ? `<div class="hist-reason">Lý do: ${esc(h.reason)}</div>` : ""}
          </div>`).join("")}
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn" id="redo-hist-close">Đóng</button>
        </div>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#redo-hist-close")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
}

/** Tải lịch sử thao tác khi mở. */
function bindStepHistory(body: HTMLElement, execId: string): void {
  const ACTION_LABEL: Record<string, string> = {
    STARTED: "▶️ Bắt đầu",
    REPORTED: "📤 Báo hoàn thành",
    APPROVED: "✅ Duyệt đạt",
    REJECTED: "🔄 Yêu cầu làm lại",
    ASSIGNED: "👥 Phân công",
    NOTE_UPDATED: "📝 Cập nhật ghi chú",
    SKIPPED: "⏭️ Bỏ qua",
    SKIP_REQUESTED: "🙏 Xin bỏ qua",
    SKIP_APPROVED: "✅ Duyệt bỏ qua",
    SKIP_REJECTED: "❌ Từ chối bỏ qua",
  };
  body.querySelectorAll<HTMLDetailsElement>("details.step-history").forEach((det) => {
    det.addEventListener("toggle", async () => {
      if (!det.open) return;
      const sid = det.dataset.historyFor!;
      const bodyEl = det.querySelector<HTMLElement>(".step-history-body")!;
      if (bodyEl.dataset.loaded) return;
      try {
        const { items } = await api.getStepHistory(execId, sid);
        if (items.length === 0) {
          bodyEl.innerHTML = `<span class="muted small">Chưa có thao tác nào.</span>`;
        } else {
          // Đánh số lần làm lại theo thứ tự thời gian (cũ nhất = lần 1).
          const rejectedTotal = items.filter((h) => h.action === "REJECTED").length;
          let rejectSeen = 0;
          bodyEl.innerHTML = items.map((h) => {
            let label = ACTION_LABEL[h.action] ?? h.action;
            if (h.action === "REJECTED") {
              rejectSeen++;
              label = `🔄 Yêu cầu làm lại lần ${rejectedTotal - rejectSeen + 1}`;
            }
            return `<div class="hist-item"><span class="hist-action">${esc(label)}</span> ` +
            `<span class="muted small">👤 ${esc(h.actor_name ?? "—")} · 🕐 ${esc(formatDateTime(h.created_at))}</span>` +
            (h.reason ? `<div class="hist-reason">${esc(h.reason)}</div>` : "") +
            `</div>`;
          }).join("");
        }
        bodyEl.dataset.loaded = "1";
      } catch {
        bodyEl.innerHTML = `<span class="muted small">Không tải được lịch sử.</span>`;
      }
    });
  });
}

/** Hiển thị phân công từ dữ liệu đã có (không gọi API riêng). */
function renderAllAssignees(body: HTMLElement, steps: import("../api.js").ExecutionStep[]): void {
  const els = Array.from(body.querySelectorAll<HTMLElement>("[data-assignees-for]"));
  const stepById = new Map(steps.map((s) => [s.id, s]));
  for (const el of els) {
    const sid = el.dataset.assigneesFor!;
    const st = stepById.get(sid) as unknown as Record<string, unknown> | undefined;
    const items = (st?.assignees as { display_name: string }[] ?? []);
    const supItems = (st?.supervisor_assignees as { display_name: string }[] ?? []);
    let html = "";
    if (items.length === 0) {
      html += `<div class="small" style="color:#2563eb;">Thực hiện: chưa phân công</div>`;
    } else {
      html += `<div class="small" style="color:#2563eb;">Thực hiện: ` + items.map((u) => esc(u.display_name)).join(", ") + `</div>`;
    }
    if (supItems.length > 0) {
      html += `<div class="small" style="color:#7c3aed;">Giám sát: ` + supItems.map((u) => esc(u.display_name)).join(", ") + `</div>`;
    }
    el.innerHTML = html;
  }
}

/** Dialog nhập ghi chú bước. */
function openNoteDialog(
  dialogRoot: HTMLElement,
  stepCode: string,
  currentNote: string,
  onSave: (note: string) => Promise<void>
): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Ghi chú bước">
        <h3>📝 Ghi chú bước "${esc(stepCode)}"</h3>
        <form id="note-form">
          <label class="field">
            <span>Ghi chú</span>
            <textarea id="note-text" rows="4" placeholder="VD: Cần kiểm tra lại số lượng trước khi đóng gói…" style="width:100%;resize:vertical;">${esc(currentNote)}</textarea>
          </label>
          <p class="form-error" id="note-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="note-cancel">Huỷ</button>
            <button type="submit" class="btn primary" id="note-save">Lưu ghi chú</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#note-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#note-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ta = dialogRoot.querySelector<HTMLTextAreaElement>("#note-text")!;
    const saveBtn = dialogRoot.querySelector<HTMLButtonElement>("#note-save")!;
    const errEl = dialogRoot.querySelector<HTMLElement>("#note-error")!;
    const origLabel = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner"></span> Đang lưu…`;
    try {
      await onSave(ta.value.trim());
      toast("Đã lưu ghi chú.");
      close();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.innerHTML = origLabel;
    }
  });
}

/** Dialog xác nhận (thay cho confirm trình duyệt). */
function openConfirmDialog(dialogRoot: HTMLElement, title: string, message: string, okLabel = "Xác nhận"): Promise<boolean> {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="dialog-backdrop">
        <div class="dialog" role="dialog" aria-modal="true">
          <h3>${esc(title)}</h3>
          <p>${esc(message)}</p>
          <div class="dialog-actions">
            <button class="btn" id="cf-cancel">Hủy</button>
            <button class="btn primary" id="cf-ok">${esc(okLabel)}</button>
          </div>
        </div>
      </div>`;
    const close = (v: boolean) => { dialogRoot.innerHTML = ""; resolve(v); };
    dialogRoot.querySelector("#cf-cancel")!.addEventListener("click", () => close(false));
    dialogRoot.querySelector(".dialog-backdrop")!.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).classList.contains("dialog-backdrop")) close(false);
    });
    dialogRoot.querySelector("#cf-ok")!.addEventListener("click", () => close(true));
  });
}

/** Dialog nhập lý do (thay cho prompt trình duyệt). Trả về lý do đã trim, hoặc null nếu hủy. */
function openReasonDialog(dialogRoot: HTMLElement, title: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="dialog-backdrop">
        <div class="dialog" role="dialog" aria-modal="true">
          <h3>${esc(title)}</h3>
          <label class="field">
            <span>Lý do <span class="req">*</span></span>
            <textarea id="reason-text" rows="3" placeholder="${esc(placeholder)}" style="width:100%;resize:vertical;"></textarea>
          </label>
          <p class="err" id="reason-err" hidden>Vui lòng nhập lý do.</p>
          <div class="dialog-actions">
            <button class="btn" id="reason-cancel">Hủy</button>
            <button class="btn primary" id="reason-ok">Xác nhận</button>
          </div>
        </div>
      </div>`;
    const close = (v: string | null) => { dialogRoot.innerHTML = ""; resolve(v); };
    const ta = dialogRoot.querySelector<HTMLTextAreaElement>("#reason-text")!;
    const err = dialogRoot.querySelector<HTMLElement>("#reason-err")!;
    dialogRoot.querySelector("#reason-cancel")!.addEventListener("click", () => close(null));
    dialogRoot.querySelector(".dialog-backdrop")!.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).classList.contains("dialog-backdrop")) close(null);
    });
    dialogRoot.querySelector("#reason-ok")!.addEventListener("click", () => {
      const v = ta.value.trim();
      if (!v) { err.hidden = false; ta.focus(); return; }
      close(v);
    });
    setTimeout(() => ta.focus(), 50);
  });
}

/** Dialog phân công nhiều người cho bước. */
async function openAssignDialog(
  dialogRoot: HTMLElement,
  execId: string,
  stepId: string,
  stepCode: string,
  stepPositions: { id: string; name: string }[],
  onDone: () => void
): Promise<void> {
  const [{ items: current }, { items: currentSup }, { items: users }] = await Promise.all([
    api.listStepAssignees(execId, stepId),
    api.listStepSupervisors(execId, stepId),
    api.listActiveUsers(),
  ]);
  const currentIds = new Set(current.map((u) => u.id));
  const currentSupIds = new Set(currentSup.map((u) => u.id));
  const active = users ?? [];
  const stepPosIds = new Set(stepPositions.map((p) => p.id));
  // Ưu tiên người có chức vụ phù hợp với bước lên đầu.
  const sorted = [...active].sort((a, b) => {
    const aMatch = a.position_id && stepPosIds.has(a.position_id) ? 0 : 1;
    const bMatch = b.position_id && stepPosIds.has(b.position_id) ? 0 : 1;
    return aMatch - bMatch;
  });
  const posNames = stepPositions.map((p) => p.name).join(", ");
  const PAGE_SIZE = 50;
  // State cho từng block (thực hiện / giám sát).
  const blockState: Record<string, { q: string; page: number }> = {
    exec: { q: "", page: 0 },
    sup: { q: "", page: 0 },
  };
  const filterUsers = (q: string) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((u) =>
      u.display_name.toLowerCase().includes(needle) ||
      (u.username ?? "").toLowerCase().includes(needle) ||
      (u.position_name ?? "").toLowerCase().includes(needle)
    );
  };
  const renderBlock = (key: "exec" | "sup", name: string, checkedIds: Set<string>) => {
    const st = blockState[key];
    const filtered = filterUsers(st.q);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (st.page >= totalPages) st.page = totalPages - 1;
    const pageItems = filtered.slice(st.page * PAGE_SIZE, st.page * PAGE_SIZE + PAGE_SIZE);
    return `
      <input type="search" class="input" data-search="${key}" placeholder="🔍 Tìm tên, tài khoản, chức vụ…" value="${esc(st.q)}" style="margin-bottom:8px;" />
      <div class="assign-list" data-list="${key}">
        ${pageItems.length === 0 ? `<p class="muted small" style="padding:12px;">Không tìm thấy.</p>` : pageItems.map((u) => {
          const isMatch = u.position_id && stepPosIds.has(u.position_id);
          return `
          <label class="assign-item ${isMatch ? "assign-match" : ""}">
            <input type="checkbox" name="${name}" value="${esc(u.id)}" ${checkedIds.has(u.id) ? "checked" : ""} />
            <span>${esc(u.display_name)}${u.position_name ? ` <span class="muted small">— ${esc(u.position_name)}</span>` : ""}${isMatch ? ` <span class="pill green">Phù hợp</span>` : ""}</span>
          </label>`;
        }).join("")}
      </div>
      <div class="pager" data-pager="${key}" style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <button type="button" class="btn sm" data-prev="${key}" ${st.page === 0 ? "disabled" : ""}>‹ Trước</button>
        <span class="muted small">Trang ${st.page + 1}/${totalPages} · ${filtered.length} người</span>
        <button type="button" class="btn sm" data-next="${key}" ${st.page >= totalPages - 1 ? "disabled" : ""}>Sau ›</button>
      </div>`;
  };
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Phân công bước">
        <h3>👥 Phân công bước "${esc(stepCode)}"</h3>
        ${posNames ? `<p class="muted small">Vai trò người thực hiện: <strong>${esc(posNames)}</strong> — người phù hợp được hiện đầu danh sách.</p>` : ""}
        <form id="assign-form">
          <h4 style="margin:12px 0 8px;">👤 Người thực hiện</h4>
          <div data-block="exec">${renderBlock("exec", "user_ids", currentIds)}</div>
          <h4 style="margin:16px 0 8px;">👁️ Người giám sát / duyệt <span class="muted small">(không bắt buộc)</span></h4>
          <p class="muted small">Yêu cầu xin bỏ qua sẽ gửi cho người này trước.</p>
          <div data-block="sup">${renderBlock("sup", "supervisor_ids", currentSupIds)}</div>
          <p class="form-error" id="assign-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="assign-cancel">Huỷ</button>
            <button type="submit" class="btn primary">Lưu phân công</button>
          </div>
        </form>
      </div>
    </div>`;
  // Lưu checkbox đã chọn khi chuyển trang/tìm kiếm (vì re-render).
  // Chỉ cập nhật những ô đang hiển thị; ô bị ẩn bởi tìm kiếm/phân trang giữ nguyên.
  const preserveChecked = () => {
    dialogRoot.querySelectorAll<HTMLInputElement>('input[name="user_ids"]').forEach((c) => {
      if (c.checked) currentIds.add(c.value); else currentIds.delete(c.value);
    });
    dialogRoot.querySelectorAll<HTMLInputElement>('input[name="supervisor_ids"]').forEach((c) => {
      if (c.checked) currentSupIds.add(c.value); else currentSupIds.delete(c.value);
    });
  };
  const rerenderBlock = (key: "exec" | "sup") => {
    preserveChecked();
    const name = key === "exec" ? "user_ids" : "supervisor_ids";
    const checked = key === "exec" ? currentIds : currentSupIds;
    dialogRoot.querySelector(`[data-block="${key}"]`)!.innerHTML = renderBlock(key, name, checked);
    bindBlock(key);
  };
  const bindBlock = (key: "exec" | "sup") => {
    const block = dialogRoot.querySelector(`[data-block="${key}"]`)!;
    const search = block.querySelector<HTMLInputElement>(`[data-search="${key}"]`)!;
    search.addEventListener("input", () => {
      blockState[key].q = search.value;
      blockState[key].page = 0;
      rerenderBlock(key);
      // Giữ focus ô tìm kiếm sau re-render.
      const s2 = dialogRoot.querySelector<HTMLInputElement>(`[data-block="${key}"] [data-search="${key}"]`)!;
      s2.focus();
      s2.setSelectionRange(s2.value.length, s2.value.length);
    });
    block.querySelector(`[data-prev="${key}"]`)?.addEventListener("click", () => {
      if (blockState[key].page > 0) { blockState[key].page--; rerenderBlock(key); }
    });
    block.querySelector(`[data-next="${key}"]`)?.addEventListener("click", () => {
      blockState[key].page++; rerenderBlock(key);
    });
  };
  bindBlock("exec");
  bindBlock("sup");
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#assign-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#assign-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const cancelBtn = dialogRoot.querySelector<HTMLButtonElement>("#assign-cancel")!;
    const fd = new FormData(form);
    // Gộp cả 2 danh sách đã chọn (kể cả ở trang khác/tìm kiếm).
    preserveChecked();
    const userIds = [...currentIds];
    const supervisorIds = [...currentSupIds];
    const errEl = dialogRoot.querySelector<HTMLElement>("#assign-error")!;
    // Hiện spinner, khóa nút.
    const origLabel = submitBtn.innerHTML;
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Đang lưu…`;
    try {
      // Chạy song song 2 API.
      await Promise.all([
        api.setStepAssignees(execId, stepId, userIds),
        api.setStepSupervisors(execId, stepId, supervisorIds),
      ]);
      toast(`Đã phân công ${userIds.length} người thực hiện, ${supervisorIds.length} giám sát.`);
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      submitBtn.innerHTML = origLabel;
    }
  });
}

function detailHtml(e: ExecutionDetail, pendingSkipStepIds: Set<string> = new Set()): string {
  const p = e.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const active = e.status === "IN_PROGRESS";
  const fmtDt = fmtVn;
  return `
    <section class="card">
      <h3>Thông tin lượt công việc</h3>
      <dl class="info-list">
        <div class="info-row"><dt>Trạng thái</dt><dd>${execPill(e.status)}${(e.redo_steps ?? 0) > 0 ? ` <span class="pill amber exec-redo-pill" style="cursor:pointer;" title="Bấm để xem chi tiết">🔄 Số bước bị làm lại: ${e.redo_steps} bước</span>` : ""}</dd></div>
        <div class="info-row"><dt style="color:#c2410c;">Quy trình</dt><dd style="color:#2563eb;">${esc(e.process_name ?? "—")} (${esc(e.process_code ?? "")})${(e as unknown as Record<string, unknown>).version_number ? ` · Phiên bản v${(e as unknown as Record<string, unknown>).version_number}` : ""}</dd></div>
        ${(e as unknown as Record<string, unknown>).expected_start_at ? `<div class="info-row"><dt>Thời gian bắt đầu (dự kiến)</dt><dd>${fmtDt((e as unknown as Record<string, unknown>).expected_start_at as string)}${e.shift ? ` · Ca ${esc(SHIFT_LABEL[e.shift] ?? e.shift)}` : ""}</dd></div>` : ""}
        ${(e as unknown as Record<string, unknown>).expected_end_at ? `<div class="info-row"><dt>Thời gian hoàn thành (dự kiến)</dt><dd>${fmtDt((e as unknown as Record<string, unknown>).expected_end_at as string)}</dd></div>` : ""}
        ${e.started_at ? `<div class="info-row"><dt>Thời gian bắt đầu (thực tế)</dt><dd>${fmtDt(e.started_at)}</dd></div>` : ""}
        ${e.completed_at ? `<div class="info-row"><dt>Thời gian hoàn thành (thực tế)</dt><dd>${fmtDt(e.completed_at)}</dd></div>` : ""}
        <div class="info-row"><dt>Người tạo</dt><dd>${esc(e.creator_name ?? "—")}${(e as unknown as Record<string, unknown>).creator_position_name ? ` <span class="muted small">— ${esc((e as unknown as Record<string, unknown>).creator_position_name as string)}</span>` : ""}</dd></div>
        <div class="info-row"><dt>Người thực hiện chính</dt><dd>${esc(e.assignee_name ?? "—")}</dd></div>
        ${((e as unknown as Record<string, unknown>).supervisor_names as string[] ?? []).length > 0 ? `<div class="info-row"><dt>Người giám sát</dt><dd>${((e as unknown as Record<string, unknown>).supervisor_names as string[]).map(esc).join(", ")}</dd></div>` : e.supervisor_name ? `<div class="info-row"><dt>Người giám sát</dt><dd>${esc(e.supervisor_name)}</dd></div>` : ""}
        ${((e as unknown as Record<string, unknown>).approver_names as string[] ?? []).length > 0 ? `<div class="info-row"><dt>Người phê duyệt</dt><dd>${((e as unknown as Record<string, unknown>).approver_names as string[]).map(esc).join(", ")}</dd></div>` : (e as unknown as Record<string, unknown>).approver_name ? `<div class="info-row"><dt>Người phê duyệt</dt><dd>${esc((e as unknown as Record<string, unknown>).approver_name as string)}</dd></div>` : ""}
        ${(e as unknown as Record<string, unknown>).approved_by_name ? `<div class="info-row"><dt>Đã phê duyệt bởi</dt><dd>${esc((e as unknown as Record<string, unknown>).approved_by_name as string)}${(e as unknown as Record<string, unknown>).approved_at ? ` · ${esc(String((e as unknown as Record<string, unknown>).approved_at).slice(0, 16).replace("T", " "))}` : ""}</dd></div>` : ""}
        <div class="info-row"><dt>Tiến độ</dt><dd>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          ${p?.done ?? 0}/${p?.total ?? 0} bước (${pct}%)</dd></div>
        ${e.cancel_reason ? `<div class="info-row"><dt style="color:#dc2626;">Lý do hủy</dt><dd>${esc(e.cancel_reason)}</dd></div>` : ""}
      </dl>
    </section>
    ${((e as unknown as { reject_history?: Array<{ by_name: string | null; at: string; reason: string | null; action: string; step_count: number }> }).reject_history ?? []).length > 0 ? `
    <section class="card">
      <h3>Lịch sử lượt bị từ chối (${(e as unknown as { reject_history: Array<unknown> }).reject_history.length} lần)</h3>
      <div class="exec-reject-history">
        ${(e as unknown as { reject_history: Array<{ by_name: string | null; at: string; reason: string | null; action: string; step_count: number; step_names: string[] }> }).reject_history.map((h, i) => `
          <div class="hist-item">
            <div><span class="hist-action">Lần ${(e as unknown as { reject_history: Array<unknown> }).reject_history.length - i}</span>${h.action === "redo" ? ` · 🔄 Yêu cầu làm lại ${h.step_count} bước` : " · 🗑️ Hủy lượt"}</div>
            ${h.action === "redo" && h.step_names.length > 0 ? `<div class="muted small" style="margin-top:4px;">📋 Các bước: ${h.step_names.map(esc).join("; ")}</div>` : ""}
            <div class="muted small">👤 ${esc(h.by_name ?? "—")} · 🕐 ${esc(formatDateTime(h.at))}</div>
            <div class="hist-reason">Lý do: ${esc(h.reason ?? "—")}</div>
          </div>`).join("")}
      </div>
    </section>` : ""}
    <section class="card">
      <div class="steps-toolbar">
        <h3>Các bước (${e.steps.length})</h3>
        <div class="view-toggle" role="tablist" aria-label="Chế độ xem">
          <button class="toggle-btn active" data-eview="list">Danh sách</button>
          <button class="toggle-btn" data-eview="diagram">Sơ đồ</button>
        </div>
      </div>
      <div data-exec-list>
      <ol class="step-list">
        ${e.steps.map((st, idx) => {
          const pendingSkip = pendingSkipStepIds.has(st.id);
          const canStart = active && st.status === "NOT_STARTED" && !pendingSkip;
          const canFinish = active && st.status === "IN_PROGRESS" && !pendingSkip;
          const skipAllowed = ((st as unknown as Record<string, unknown>).skip_policy as { allowed?: boolean } | null)?.allowed === true;
          const canSkip = active && (st.status === "NOT_STARTED" || st.status === "IN_PROGRESS") && skipAllowed && !pendingSkip;
          const canAssign = active && !["PASSED", "SKIPPED", "CANCELLED"].includes(st.status) && !pendingSkip;
          const canUpload = active && (st.status === "NOT_STARTED" || st.status === "IN_PROGRESS");
          // Yêu cầu ảnh từ completion_req (EXE-007).
          let minPhotos = 0;
          try {
            const cr = st.completion_req ? JSON.parse(st.completion_req) : null;
            minPhotos = cr?.min_photos ?? (cr?.require_photo ? 1 : 0);
          } catch { /* bỏ qua */ }
          return `<li data-sid="${esc(st.id)}" class="exec-step-item">
            <div class="step-head">
              <span class="step-num">${idx + 1}</span>
              <div class="step-title">
                <strong>${esc(st.code)}</strong> — ${esc(st.title)}
                ${st.is_required ? "" : ' <span class="pill gray">Tùy chọn</span>'}
                ${skipAllowed ? ' <span class="pill blue">⏭️ Được bỏ qua</span>' : ""}
                ${pendingSkip ? ' <span class="pill amber">🙏 Chờ duyệt bỏ qua</span>' : ""}
                <span class="pill ${st.status === "PASSED" ? "green" : st.status === "SKIPPED" ? "gray" : st.status === "IN_PROGRESS" ? "blue" : st.status === "PENDING_REVIEW" ? "amber" : "gray"}">${esc(STEP_STATUS_LABELS[st.status] ?? st.status)}</span>
                ${minPhotos > 0 ? ` <span class="pill orange" title="Yêu cầu ít nhất ${minPhotos} ảnh">📷 ${minPhotos} ảnh</span>` : ""}
                ${((st as unknown as Record<string, unknown>).redo_count as number ?? 0) > 0 ? ` <span class="pill amber redo-pill" data-redo-for="${esc(st.id)}" style="cursor:pointer;" title="Bấm để xem chi tiết các lần làm lại">🔄 Làm lại ${esc(String((st as unknown as Record<string, unknown>).redo_count))} lần</span>` : ""}
                ${((st as unknown as Record<string, unknown>).positions as { name: string }[] ?? []).length > 0 ? `<div class="muted small">👤 Thực hiện: ${((st as unknown as Record<string, unknown>).positions as { name: string }[]).map((p) => esc(p.name)).join(", ")}</div>` : ""}
                ${((st as unknown as Record<string, unknown>).supervisors as { name: string }[] ?? []).length > 0 ? `<div class="muted small">👁️ Giám sát: ${((st as unknown as Record<string, unknown>).supervisors as { name: string }[]).map((p) => esc(p.name)).join(", ")}</div>` : ""}
                ${st.skip_reason ? `<div class="muted small">Lý do bỏ qua: ${esc(st.skip_reason)}</div>` : ""}
                ${st.note ? `<div class="muted small">📝 Ghi chú:</div><div class="step-head-note">${esc(st.note)}</div>` : ""}
                ${((st as unknown as Record<string, unknown>).redo_count as number ?? 0) > 0 && st.status !== "PASSED" ? `<div class="muted small" style="color:#b45309;">🔄 Yêu cầu làm lại: ${esc(((st as unknown as Record<string, unknown>).redo_reason as string) ?? "")} (${esc(((st as unknown as Record<string, unknown>).redo_at as string) ?? "")})${(st as unknown as Record<string, unknown>).redo_by_name ? ` — bởi ${esc((st as unknown as Record<string, unknown>).redo_by_name as string)}` : ""}</div>` : ""}
                ${(st as unknown as Record<string, unknown>).approved_by_name ? `<div class="muted small" style="margin-top:8px;"><span class="pill green approve-pill" data-approve-for="${esc(st.id)}" style="cursor:pointer;font-weight:400;border-radius:6px;" title="Bấm để xem lịch sử duyệt">✅ Duyệt bởi: ${esc((st as unknown as Record<string, unknown>).approved_by_name as string)}${(st as unknown as Record<string, unknown>).approved_at ? ` (${esc(formatDateTime((st as unknown as Record<string, unknown>).approved_at as string))})` : ""}</span></div>` : ""}
              </div>
              ${(() => {
                const canReview = active && st.status === "PENDING_REVIEW";
                const btns = [
                  canStart ? `<button class="btn sm primary" data-step="start">Bắt đầu</button>` : "",
                  canFinish ? `<button class="btn sm primary" data-step="complete">Báo hoàn thành</button>` : "",
                  canReview ? `<button class="btn sm primary" data-step="approve">✅ Duyệt đạt</button>` : "",
                  canReview ? `<button class="btn sm" data-step="reject">🔄 Yêu cầu làm lại</button>` : "",
                  canSkip ? `<button class="btn sm" data-step="skip">⏭️ Bỏ qua</button>` : "",
                  canSkip ? `<button class="btn sm secondary" data-step="request-skip">🙏 Xin bỏ qua</button>` : "",
                  active && !["PASSED", "SKIPPED", "CANCELLED", "PENDING_REVIEW"].includes(st.status) && !pendingSkip ? `<button class="btn sm" data-step="assign">👥 Phân công</button>` : "",
                  active && !["PENDING_REVIEW", "PASSED", "SKIPPED", "CANCELLED"].includes(st.status) ? `<button class="btn sm" data-step="note">📝 Ghi chú</button>` : "",
                ].filter(Boolean);
                return btns.length > 0 ? `<div class="step-actions">${btns.join("")}</div>` : "";
              })()}
              <div class="step-assignees" data-assignees-for="${esc(st.id)}"><span class="muted small">Đang tải…</span></div>
            </div>
            ${(st as unknown as Record<string, unknown>).prerequisite || (st as unknown as Record<string, unknown>).input_desc || st.instruction || (st as unknown as Record<string, unknown>).expected_result || (st as unknown as Record<string, unknown>).output_desc || (st as unknown as Record<string, unknown>).warning || (st as unknown as Record<string, unknown>).target_duration_min || ((st as unknown as Record<string, unknown>).positions as unknown[] ?? []).length > 0 || (st as unknown as Record<string, unknown>).skip_policy || (st as unknown as Record<string, unknown>).failure_policy || st.note ? `
            <details class="step-details">
              <summary>📋 Chi tiết bước</summary>
              <div class="step-details-body">
                ${((st as unknown as Record<string, unknown>).positions as { name: string }[] ?? []).length > 0 ? `<div class="step-detail-row"><span class="step-dlabel">👤 Vai trò thực hiện:</span> ${((st as unknown as Record<string, unknown>).positions as { name: string }[]).map((p) => esc(p.name)).join(", ")}</div>` : ""}
                ${((st as unknown as Record<string, unknown>).supervisors as { name: string }[] ?? []).length > 0 ? `<div class="step-detail-row"><span class="step-dlabel">👁️ Vai trò giám sát:</span> ${((st as unknown as Record<string, unknown>).supervisors as { name: string }[]).map((p) => esc(p.name)).join(", ")}</div>` : ""}
                ${(st as unknown as Record<string, unknown>).prerequisite ? `<div class="step-detail-row"><span class="step-dlabel">Điều kiện tiên quyết:</span> ${esc((st as unknown as Record<string, unknown>).prerequisite as string)}</div>` : ""}
                ${(st as unknown as Record<string, unknown>).expected_result ? `<div class="step-detail-row"><span class="step-dlabel">Kết quả mong đợi:</span> ${esc((st as unknown as Record<string, unknown>).expected_result as string)}</div>` : ""}
                ${(st as unknown as Record<string, unknown>).input_desc ? `<div class="step-detail-row"><span class="step-dlabel">Đầu vào:</span> ${esc((st as unknown as Record<string, unknown>).input_desc as string)}</div>` : ""}
                ${(st as unknown as Record<string, unknown>).output_desc ? `<div class="step-detail-row"><span class="step-dlabel">Đầu ra / Bàn giao:</span> ${esc((st as unknown as Record<string, unknown>).output_desc as string)}</div>` : ""}
                ${(st as unknown as Record<string, unknown>).target_duration_min ? `<div class="step-detail-row"><span class="step-dlabel">Thời gian mục tiêu:</span> ${esc(String((st as unknown as Record<string, unknown>).target_duration_min))} phút</div>` : ""}
                ${st.is_required ? "" : `<div class="step-detail-row"><span class="step-dlabel">Bắt buộc:</span> Không (bước tùy chọn, được phép bỏ qua)</div>`}
                ${((st as unknown as Record<string, unknown>).skip_policy as { allowed?: boolean } | null)?.allowed ? `<div class="step-detail-row"><span class="step-dlabel">⏭️ Bỏ qua:</span> ✅ Cho phép bỏ qua bước này (người giám sát duyệt)</div>` : ""}
                ${(st as unknown as Record<string, unknown>).failure_policy ? `<div class="step-detail-row"><span class="step-dlabel">Xử lý khi lỗi:</span> ${esc(typeof (st as unknown as Record<string, unknown>).failure_policy === "string" ? (st as unknown as Record<string, unknown>).failure_policy as string : JSON.stringify((st as unknown as Record<string, unknown>).failure_policy))}</div>` : ""}
                ${(st as unknown as Record<string, unknown>).warning ? `<div class="step-detail-row"><span class="step-dlabel">⚠️ Cảnh báo:</span> ${esc((st as unknown as Record<string, unknown>).warning as string)}</div>` : ""}
                ${st.instruction ? `<div class="step-guide"><div class="step-guide-title">📖 Hướng dẫn thực hiện</div><div class="step-guide-body">${esc(st.instruction)}</div></div>` : ""}
              </div>
            </details>` : ""}
            <div class="evidence-section" data-evidence-for="${esc(st.id)}">
              <div class="evidence-head">
                <span class="evidence-title">📷 Bằng chứng <span class="evidence-count" data-ev-count></span></span>
                ${canUpload ? `<span class="evidence-upload-group">
                  <label class="btn sm evidence-upload-btn camera-btn">
                    📸 Chụp
                    <input type="file" accept="image/*" capture="environment" hidden data-ev-input data-ev-kind="photo" />
                  </label>
                  <label class="btn sm evidence-upload-btn">
                    + Ảnh
                    <input type="file" accept="image/*" multiple hidden data-ev-input data-ev-kind="photo" />
                  </label>
                  <label class="btn sm evidence-upload-btn">
                    + Tệp
                    <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" multiple hidden data-ev-input data-ev-kind="file" />
                  </label>
                </span>` : ""}
              </div>
              <div class="evidence-grid" data-ev-grid></div>
              <p class="evidence-hint muted small">Ảnh được nén trước khi tải lên (tối đa 10 ảnh/bước). Tệp: PDF, Word, Excel, tối đa 10MB.</p>
            </div>
            <details class="step-history" data-history-for="${esc(st.id)}">
              <summary>🕐 Lịch sử thao tác</summary>
              <div class="step-history-body"><span class="muted small">Đang tải…</span></div>
            </details>
          </li>`;
        }).join("")}
      </ol>
      </div>
      <div data-exec-diagram hidden>
        ${renderExecDiagram(e.steps, pendingSkipStepIds)}
      </div>
    </section>
    <section class="card">
      <div class="steps-toolbar">
        <h3>⚠️ Ngoại lệ <span class="muted small" data-exc-count></span></h3>
        ${active ? `<button class="btn sm" data-exc-act="create">+ Báo ngoại lệ</button>` : ""}
      </div>
      <div id="exc-list"><p class="empty">Đang tải…</p></div>
    </section>`;
}

/** Sơ đồ tuyến tính cho lượt thực hiện — màu theo trạng thái bước. */
function renderExecDiagram(steps: import("../api.js").ExecutionStep[], pendingSkipStepIds: Set<string> = new Set()): string {
  const cls: Record<string, string> = {
    NOT_STARTED: "",
    IN_PROGRESS: "doing",
    PASSED: "done",
    FAILED: "failed",
    SKIPPED: "skipped",
  };
  const label: Record<string, string> = {
    NOT_STARTED: "Chưa bắt đầu",
    IN_PROGRESS: "Đang làm",
    PENDING_REVIEW: "Chờ duyệt",
    PASSED: "Đạt",
    FAILED: "Không đạt",
    SKIPPED: "Bỏ qua",
    CANCELLED: "Đã hủy",
  };
  return `
    <div class="flow-diagram" role="img" aria-label="Sơ đồ lượt thực hiện ${steps.length} bước">
      ${steps.map((st, idx) => {
        const sx = st as unknown as Record<string, unknown>;
        const positions = (sx.positions as { name: string }[] ?? []);
        const supervisors = (sx.supervisors as { name: string }[] ?? []);
        const assignees = (sx.assignees as { display_name: string }[] ?? []);
        const evCount = (sx.evidence_count as number) ?? 0;
        const skipAllowed = (sx.skip_policy as { allowed?: boolean } | null)?.allowed === true;
        const pendingSkip = pendingSkipStepIds.has(st.id);
        return `
        ${idx > 0 ? `<div class="flow-arrow" aria-hidden="true">↓</div>` : ""}
        <div class="flow-node exec ${cls[st.status] ?? ""}" data-goto-step="${esc(st.id)}" title="Bấm để xem chi tiết bước">
          <div class="flow-node-head">
            <span class="flow-num">${idx + 1}</span>
            <strong>${esc(st.code)}</strong>
            ${skipAllowed ? ' <span class="pill blue">⏭️ Được bỏ qua</span>' : ""}
            ${pendingSkip ? ' <span class="pill amber">🙏 Chờ duyệt</span>' : ""}
            <span class="pill ${st.status === "PASSED" ? "green" : st.status === "IN_PROGRESS" ? "blue" : "gray"}">${esc(label[st.status] ?? st.status)}</span>
          </div>
          <div class="flow-title">${esc(st.title)}</div>
          ${positions.length > 0 ? `<div class="flow-meta">👤 Thực hiện: ${positions.map((p) => esc(p.name)).join(", ")}</div>` : ""}
          ${supervisors.length > 0 ? `<div class="flow-meta">👁️ Giám sát: ${supervisors.map((p) => esc(p.name)).join(", ")}</div>` : ""}
          ${assignees.length > 0 ? `<div class="flow-meta" style="color:#2563eb;">Thực hiện: ${assignees.map((a) => esc(a.display_name)).join(", ")}</div>` : `<div class="flow-meta" style="color:#2563eb;">Thực hiện: chưa phân công</div>`}
          ${((st as unknown as Record<string, unknown>).supervisor_assignees as { display_name: string }[] ?? []).length > 0 ? `<div class="flow-meta" style="color:#7c3aed;">Giám sát: ${((st as unknown as Record<string, unknown>).supervisor_assignees as { display_name: string }[]).map((a) => esc(a.display_name)).join(", ")}</div>` : ""}
          ${evCount > 0 ? `<div class="flow-meta">📷 ${evCount} bằng chứng</div>` : ""}
          ${st.completed_at ? `<div class="flow-meta muted small">Xong: ${esc(st.completed_at.slice(0, 16).replace("T", " "))}</div>` : ""}
        </div>`;
      }).join("")}
    </div>`;
}

export { EXEC_STATUS_LABELS };
