// views/executions.ts — lượt thực hiện quy trình (Task 1.6).
// Khớp SRS v1.6: EXE-001–009, EXE-011–013; §7.2; AC-04.

import { api, type Execution, type ExecutionDetail } from "../api.js";
import { esc, setLoading, toast } from "../ui.js";

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
      <button class="btn" id="btn-filter">Lọc</button>
    </div>
    <div class="table-wrap"><table class="tbl clickable-rows" id="exec-table">
      <thead><tr>
        <th>Mã lượt</th><th>Quy trình</th><th>Thời gian tạo</th><th>Thời gian bắt đầu (thực tế)</th><th>Thời gian hoàn thành (thực tế)</th><th>Tiến độ</th><th>Trạng thái</th>
      </tr></thead>
      <tbody><tr><td colspan="7" class="empty">Đang tải…</td></tr></tbody>
    </table></div>
    <div id="exec-dialog-root"></div>`;

  const tbody = root.querySelector<HTMLTableSectionElement>("#exec-table tbody")!;
  const dialogRoot = root.querySelector<HTMLElement>("#exec-dialog-root")!;
  const selStatus = root.querySelector<HTMLSelectElement>("#flt-status")!;

  async function reload(): Promise<void> {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Đang tải…</td></tr>`;
    try {
      const { items } = await api.listExecutions({ mine: true, status: selStatus.value || undefined });
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">Chưa có lượt nào được giao cho bạn.</td></tr>`;
        return;
      }
      tbody.innerHTML = items.map((e) => {
        const p = e.progress;
        const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        const fmtDt = (s: string | null | undefined) => s ? s.slice(0, 16).replace("T", " ").split(" ").map((x, i) => i === 0 ? x.split("-").reverse().join("/") : x).join(" ") : "—";
        // Thời gian tạo: kèm giờ.
        const createdAt = fmtDt(e.created_at);
        // Thời gian bắt đầu (thực tế): thời gian nhấn Bắt đầu; chưa bắt đầu thì hiện dự kiến.
        const ex = e as unknown as Record<string, unknown>;
        const startedAt = e.started_at ? fmtDt(e.started_at)
          : (ex.expected_start_at ? fmtDt(ex.expected_start_at as string) + ' <span class="muted small">(dự kiến)</span>' : "—");
        // Thời gian hoàn thành (thực tế).
        const completedAt = fmtDt(e.completed_at);
        return `<tr data-id="${esc(e.id)}">
          <td><strong>${esc(e.code)}</strong>${e.title ? `<div class="muted small">${esc(e.title)}</div>` : ""}</td>
          <td>${esc(e.process_name ?? "—")}</td>
          <td class="muted small">${createdAt}</td>
          <td>${startedAt}</td>
          <td class="muted small">${completedAt}</td>
          <td><div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
            <span class="muted small">${p?.done ?? 0}/${p?.total ?? 0}</span></td>
          <td>${execPill(e.status)}${(e.redo_steps ?? 0) > 0 ? ` <span class="pill amber" title="Bị từ chối: ${esc(e.last_redo_reason ?? "")}&#10;Người từ chối: ${esc(e.last_redo_by_name ?? "")}&#10;Lúc: ${esc(e.last_redo_at ?? "")}&#10;Số bước làm lại: ${e.redo_steps}">🔄 Trả lại (${e.redo_steps})</span>` : ""}</td>
        </tr>`;
      }).join("");
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Không tải được: ${esc(msg(e))}</td></tr>`;
    }
  }

  tbody.addEventListener("click", (ev) => {
    const tr = (ev.target as HTMLElement).closest("tr");
    if (!tr?.dataset.id) return;
    const id = tr.dataset.id;
    // Nhấn vào dòng (không phải nút) → mở xem luôn.
    location.hash = "#/executions/" + id;
  });

  root.querySelector("#btn-filter")!.addEventListener("click", reload);
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
  // Mặc định thời gian bắt đầu là hiện tại.
  const startInput = dialogRoot.querySelector<HTMLInputElement>("#exec-start")!;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  startInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
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
      // Tải phân công cho từng bước.
      await loadAllAssignees(body, e.id);
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
        openCompleteConfirm(dialogRoot, step, async () => {
          const rb = setLoading(btn, true, "…");
          try {
            await api.completeStep(execId, sid);
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
          await loadAllAssignees(body, execId);
        });
        return;
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
      }
      await reload();
    } catch (err) {
      toast(`Lỗi: ${msg(err)}`);
      restore();
    }
  };
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
  onConfirm: () => void
): void {
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Xác nhận hoàn thành">
        <h3>Hoàn thành bước "${esc(step?.code ?? "")}"?</h3>
        <p>⚠️ Sau khi hoàn thành, <strong>bạn sẽ không thể sửa đổi</strong> bước này nữa
        (không thêm/xóa ảnh, không sửa trạng thái, <strong>không thay đổi người được người thực hiện</strong>).
        Người thực hiện sẽ được cố định. Hãy kiểm tra kỹ bằng chứng và thông tin trước khi xác nhận.</p>
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
    close();
    onConfirm();
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
            const note = prompt("Ghi chú khi đóng (tùy chọn):") ?? "";
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

/** Tải phân công cho tất cả các bước. */
async function loadAllAssignees(body: HTMLElement, execId: string): Promise<void> {
  const els = body.querySelectorAll<HTMLElement>("[data-assignees-for]");
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const sid = el.dataset.assigneesFor!;
    try {
      const [{ items }, { items: supItems }] = await Promise.all([
        api.listStepAssignees(execId, sid),
        api.listStepSupervisors(execId, sid),
      ]);
      let html = "";
      if (items.length === 0) {
        html += `<div class="small" style="color:#2563eb;">Người thực hiện: chưa phân công</div>`;
      } else {
        html += `<div class="small" style="color:#2563eb;">Người thực hiện: ` + items.map((u) =>
          esc(u.display_name) + (u.position ? ` (${esc(u.position)})` : "")
        ).join(", ") + `</div>`;
      }
      if (supItems.length > 0) {
        html += `<div class="small" style="color:#7c3aed;">👁️ Giám sát: ` + supItems.map((u) =>
          esc(u.display_name) + (u.position ? ` (${esc(u.position)})` : "")
        ).join(", ") + `</div>`;
      }
      el.innerHTML = html;
    } catch {
      el.innerHTML = ``;
    }
  }
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
  const renderUserList = (name: string, checkedIds: Set<string>) => `
    <div class="assign-list">
      ${sorted.map((u) => {
        const isMatch = u.position_id && stepPosIds.has(u.position_id);
        return `
        <label class="assign-item ${isMatch ? "assign-match" : ""}">
          <input type="checkbox" name="${name}" value="${esc(u.id)}" ${checkedIds.has(u.id) ? "checked" : ""} />
          <span>${esc(u.display_name)}${u.position_name ? ` <span class="muted small">— ${esc(u.position_name)}</span>` : ""}${isMatch ? ` <span class="pill green">Phù hợp</span>` : ""}</span>
        </label>`;
      }).join("")}
    </div>`;
  dialogRoot.innerHTML = `
    <div class="dialog-backdrop" data-close>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Phân công bước">
        <h3>👥 Phân công bước "${esc(stepCode)}"</h3>
        ${posNames ? `<p class="muted small">Vai trò người thực hiện: <strong>${esc(posNames)}</strong> — người phù hợp được hiện đầu danh sách.</p>` : ""}
        <form id="assign-form">
          <h4 style="margin:12px 0 8px;">👤 Người thực hiện</h4>
          ${renderUserList("user_ids", currentIds)}
          <h4 style="margin:16px 0 8px;">👁️ Người giám sát / duyệt <span class="muted small">(không bắt buộc)</span></h4>
          <p class="muted small">Yêu cầu xin bỏ qua sẽ gửi cho người này trước.</p>
          ${renderUserList("supervisor_ids", currentSupIds)}
          <p class="form-error" id="assign-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button type="button" class="btn" id="assign-cancel">Huỷ</button>
            <button type="submit" class="btn primary">Lưu phân công</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#assign-cancel")!.addEventListener("click", close);
  dialogRoot.querySelector("[data-close]")!.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).hasAttribute("data-close")) close();
  });
  dialogRoot.querySelector<HTMLFormElement>("#assign-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const userIds = fd.getAll("user_ids").map(String);
    const supervisorIds = fd.getAll("supervisor_ids").map(String);
    const errEl = dialogRoot.querySelector<HTMLElement>("#assign-error")!;
    try {
      await api.setStepAssignees(execId, stepId, userIds);
      await api.setStepSupervisors(execId, stepId, supervisorIds);
      toast(`Đã phân công ${userIds.length} người thực hiện, ${supervisorIds.length} giám sát.`);
      close();
      onDone();
    } catch (e) {
      errEl.textContent = msg(e);
      errEl.hidden = false;
    }
  });
}

function detailHtml(e: ExecutionDetail, pendingSkipStepIds: Set<string> = new Set()): string {
  const p = e.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const active = e.status === "IN_PROGRESS";
  const fmtDt = (s: string | null | undefined) => s ? s.slice(0, 16).replace("T", " ").split(" ").map((x, i) => i === 0 ? x.split("-").reverse().join("/") : x).join(" ") : "—";
  return `
    <section class="card">
      <h3>Thông tin lượt công việc</h3>
      <dl class="info-list">
        <div class="info-row"><dt>Trạng thái</dt><dd>${execPill(e.status)}${(e.redo_steps ?? 0) > 0 ? ` <span class="pill amber">🔄 Bị trả lại làm lại ${e.redo_steps} bước</span>` : ""}</dd></div>
        ${((e as unknown as { reject_history?: Array<{ by_name: string | null; at: string; reason: string | null; action: string; step_count: number }> }).reject_history ?? []).length > 0 ? `
        <div class="info-row"><dt>Lịch sử từ chối (${(e as unknown as { reject_history: Array<unknown> }).reject_history.length} lần)</dt><dd>
          <div style="max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;">
            ${(e as unknown as { reject_history: Array<{ by_name: string | null; at: string; reason: string | null; action: string; step_count: number }> }).reject_history.map((h, i) => `
              <div style="margin-bottom:8px;padding-bottom:8px;${i < (e as unknown as { reject_history: Array<unknown> }).reject_history.length - 1 ? "border-bottom:1px solid var(--line);" : ""}">
                <strong>Lần ${ (e as unknown as { reject_history: Array<unknown> }).reject_history.length - i}</strong>
                ${h.action === "redo" ? ` · 🔄 Yêu cầu làm lại ${h.step_count} bước` : " · 🗑️ Hủy lượt"}<br/>
                <span class="muted small">👤 ${esc(h.by_name ?? "—")} · 🕐 ${esc(h.at)}</span><br/>
                <span>Lý do: ${esc(h.reason ?? "—")}</span>
              </div>`).join("")}
          </div>
        </dd></div>` : ""}
        <div class="info-row"><dt style="color:#c2410c;">Quy trình</dt><dd style="color:#2563eb;">${esc(e.process_name ?? "—")} (${esc(e.process_code ?? "")})${(e as unknown as Record<string, unknown>).version_number ? ` · Phiên bản v${(e as unknown as Record<string, unknown>).version_number}` : ""}</dd></div>
        ${(e as unknown as Record<string, unknown>).expected_start_at ? `<div class="info-row"><dt>Thời gian bắt đầu (dự kiến)</dt><dd>${fmtDt((e as unknown as Record<string, unknown>).expected_start_at as string)}${e.shift ? ` · Ca ${esc(SHIFT_LABEL[e.shift] ?? e.shift)}` : ""}</dd></div>` : ""}
        ${(e as unknown as Record<string, unknown>).expected_end_at ? `<div class="info-row"><dt>Thời gian hoàn thành (dự kiến)</dt><dd>${fmtDt((e as unknown as Record<string, unknown>).expected_end_at as string)}</dd></div>` : ""}
        ${e.started_at ? `<div class="info-row"><dt>Thời gian bắt đầu (thực tế)</dt><dd>${fmtDt(e.started_at)}</dd></div>` : ""}
        ${e.completed_at ? `<div class="info-row"><dt>Thời gian hoàn thành (thực tế)</dt><dd>${fmtDt(e.completed_at)}</dd></div>` : ""}
        <div class="info-row"><dt>Người tạo</dt><dd>${esc(e.creator_name ?? "—")}${(e as unknown as Record<string, unknown>).creator_position_name ? ` <span class="muted small">— ${esc((e as unknown as Record<string, unknown>).creator_position_name as string)}</span>` : ""}</dd></div>
        <div class="info-row"><dt>Người thực hiện chính</dt><dd>${esc(e.assignee_name ?? "—")}</dd></div>
        ${e.supervisor_name ? `<div class="info-row"><dt>Người giám sát</dt><dd>${esc(e.supervisor_name)}</dd></div>` : ""}
        ${(e as unknown as Record<string, unknown>).approver_name ? `<div class="info-row"><dt>Người phê duyệt</dt><dd>${esc((e as unknown as Record<string, unknown>).approver_name as string)}</dd></div>` : ""}
        ${(e as unknown as Record<string, unknown>).approved_by_name ? `<div class="info-row"><dt>Đã phê duyệt bởi</dt><dd>${esc((e as unknown as Record<string, unknown>).approved_by_name as string)}${(e as unknown as Record<string, unknown>).approved_at ? ` · ${esc(String((e as unknown as Record<string, unknown>).approved_at).slice(0, 16).replace("T", " "))}` : ""}</dd></div>` : ""}
        <div class="info-row"><dt>Tiến độ</dt><dd>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          ${p?.done ?? 0}/${p?.total ?? 0} bước (${pct}%)</dd></div>
        ${e.cancel_reason ? `<div class="info-row"><dt style="color:#dc2626;">Lý do hủy</dt><dd>${esc(e.cancel_reason)}</dd></div>` : ""}
      </dl>
    </section>
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
          return `<li data-sid="${esc(st.id)}">
            <div class="step-head">
              <span class="step-num">${idx + 1}</span>
              <div class="step-title">
                <strong>${esc(st.code)}</strong> — ${esc(st.title)}
                ${st.is_required ? "" : ' <span class="pill gray">Tùy chọn</span>'}
                ${skipAllowed ? ' <span class="pill blue">⏭️ Được bỏ qua</span>' : ""}
                ${pendingSkip ? ' <span class="pill amber">🙏 Chờ duyệt bỏ qua</span>' : ""}
                <span class="pill ${st.status === "PASSED" ? "green" : st.status === "SKIPPED" ? "gray" : st.status === "IN_PROGRESS" ? "blue" : "gray"}">${esc(STEP_STATUS_LABELS[st.status] ?? st.status)}</span>
                ${minPhotos > 0 ? ` <span class="pill orange" title="Yêu cầu ít nhất ${minPhotos} ảnh">📷 ${minPhotos} ảnh</span>` : ""}
                ${((st as unknown as Record<string, unknown>).redo_count as number ?? 0) > 0 ? ` <span class="pill amber" title="Lý do: ${esc(((st as unknown as Record<string, unknown>).redo_reason as string) ?? "")}&#10;Lúc: ${esc(((st as unknown as Record<string, unknown>).redo_at as string) ?? "")}">🔄 Làm lại ${esc(String((st as unknown as Record<string, unknown>).redo_count))} lần</span>` : ""}
                ${((st as unknown as Record<string, unknown>).positions as { name: string }[] ?? []).length > 0 ? `<div class="muted small">👤 Thực hiện: ${((st as unknown as Record<string, unknown>).positions as { name: string }[]).map((p) => esc(p.name)).join(", ")}</div>` : ""}
                ${((st as unknown as Record<string, unknown>).supervisors as { name: string }[] ?? []).length > 0 ? `<div class="muted small">👁️ Giám sát: ${((st as unknown as Record<string, unknown>).supervisors as { name: string }[]).map((p) => esc(p.name)).join(", ")}</div>` : ""}
                ${st.skip_reason ? `<div class="muted small">Lý do bỏ qua: ${esc(st.skip_reason)}</div>` : ""}
                ${st.note ? `<div class="muted small">Ghi chú: ${esc(st.note)}</div>` : ""}
                ${((st as unknown as Record<string, unknown>).redo_count as number ?? 0) > 0 ? `<div class="muted small" style="color:#b45309;">🔄 Yêu cầu làm lại: ${esc(((st as unknown as Record<string, unknown>).redo_reason as string) ?? "")} (${esc(((st as unknown as Record<string, unknown>).redo_at as string) ?? "")})</div>` : ""}
              </div>
              <div class="step-actions">
                ${canStart ? `<button class="btn sm primary" data-step="start">Bắt đầu</button>` : ""}
                ${canFinish ? `<button class="btn sm primary" data-step="complete">Hoàn thành</button>` : ""}
                ${canSkip ? `<button class="btn sm" data-step="skip">⏭️ Bỏ qua</button>` : ""}
                ${canSkip ? `<button class="btn sm secondary" data-step="request-skip">🙏 Xin bỏ qua</button>` : ""}
                ${active && !["PASSED", "SKIPPED", "CANCELLED"].includes(st.status) && !pendingSkip ? `<button class="btn sm" data-step="assign">👥 Phân công</button>` : ""}
              </div>
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
                ${st.note ? `<div class="step-detail-row"><span class="step-dlabel">Ghi chú:</span> ${esc(st.note)}</div>` : ""}
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
          ${assignees.length > 0 ? `<div class="flow-meta" style="color:#2563eb;">Người thực hiện: ${assignees.map((a) => esc(a.display_name)).join(", ")}</div>` : `<div class="flow-meta" style="color:#2563eb;">Người thực hiện: chưa phân công</div>`}
          ${((st as unknown as Record<string, unknown>).supervisor_assignees as { display_name: string }[] ?? []).length > 0 ? `<div class="flow-meta" style="color:#7c3aed;">👁️ Duyệt: ${((st as unknown as Record<string, unknown>).supervisor_assignees as { display_name: string }[]).map((a) => esc(a.display_name)).join(", ")}</div>` : ""}
          ${evCount > 0 ? `<div class="flow-meta">📷 ${evCount} bằng chứng</div>` : ""}
          ${st.completed_at ? `<div class="flow-meta muted small">Xong: ${esc(st.completed_at.slice(0, 16).replace("T", " "))}</div>` : ""}
        </div>`;
      }).join("")}
    </div>`;
}

export { EXEC_STATUS_LABELS };
