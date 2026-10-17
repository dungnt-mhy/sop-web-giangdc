// views/executions.ts — lượt thực hiện quy trình (Task 1.6).
// Khớp SRS v1.6: EXE-001–009, EXE-011–013; §7.2; AC-04.

import { api, type Execution, type ExecutionDetail } from "../api.js";
import { esc, setLoading, toast } from "../ui.js";

const EXEC_STATUS_LABELS: Record<string, string> = {
  CREATED: "Mới tạo",
  IN_PROGRESS: "Đang thực hiện",
  PAUSED: "Tạm dừng",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const EXEC_STATUS_PILL: Record<string, string> = {
  CREATED: "gray",
  IN_PROGRESS: "blue",
  PAUSED: "amber",
  COMPLETED: "green",
  CANCELLED: "red",
};

const STEP_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Chưa bắt đầu",
  IN_PROGRESS: "Đang làm",
  PASSED: "Đạt",
  FAILED: "Không đạt",
  SKIPPED: "Bỏ qua",
};

function execPill(status: string): string {
  return `<span class="pill ${EXEC_STATUS_PILL[status] ?? "gray"}">${esc(EXEC_STATUS_LABELS[status] ?? status)}</span>`;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "lỗi không xác định";
}

/** Trang "Việc của tôi" (#/my-work) — danh sách lượt được giao (EXE-011). */
export async function renderMyWork(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>Việc của tôi</h2>
      <p class="page-sub">Các lượt thực hiện được giao cho bạn.</p></div>
      <button class="btn primary" id="btn-create-exec">+ Tạo lượt mới</button>
    </div>
    <div class="filter-bar">
      <select id="flt-status" class="input" aria-label="Trạng thái">
        <option value="">Tất cả trạng thái</option>
        <option value="CREATED">Mới tạo</option>
        <option value="IN_PROGRESS">Đang thực hiện</option>
        <option value="PAUSED">Tạm dừng</option>
        <option value="COMPLETED">Hoàn thành</option>
        <option value="CANCELLED">Đã hủy</option>
      </select>
      <button class="btn" id="btn-filter">Lọc</button>
    </div>
    <div class="table-wrap"><table class="tbl" id="exec-table">
      <thead><tr>
        <th>Mã lượt</th><th>Quy trình</th><th>Tiến độ</th><th>Trạng thái</th><th>Thao tác</th>
      </tr></thead>
      <tbody><tr><td colspan="5" class="empty">Đang tải…</td></tr></tbody>
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
        tbody.innerHTML = `<tr><td colspan="5" class="empty">Chưa có lượt nào được giao cho bạn.</td></tr>`;
        return;
      }
      tbody.innerHTML = items.map((e) => {
        const p = e.progress;
        const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        return `<tr data-id="${esc(e.id)}">
          <td><strong>${esc(e.code)}</strong>${e.title ? `<div class="muted small">${esc(e.title)}</div>` : ""}</td>
          <td>${esc(e.process_name ?? "—")}</td>
          <td><div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
            <span class="muted small">${p?.done ?? 0}/${p?.total ?? 0}</span></td>
          <td>${execPill(e.status)}</td>
          <td class="actions"><button class="link" data-act="view"><span>Mở</span></button></td>
        </tr>`;
      }).join("");
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Không tải được: ${esc(msg(e))}</td></tr>`;
    }
  }

  tbody.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
    if (!btn) return;
    const id = btn.closest("tr")!.dataset.id!;
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
      <h3>Tạo lượt thực hiện mới</h3>
      <form id="exec-form" novalidate>
        <label>Quy trình <span class="req">*</span>
          <select class="input" name="process_id" id="exec-process" required>
            <option value="">Đang tải…</option>
          </select>
          <span class="hint">Chỉ hiện quy trình có phiên bản đang hiệu lực.</span></label>
        <label>Tiêu đề lượt <input class="input" name="title" maxlength="200"
          placeholder="VD: Xuất hàng đợt sáng 17/10" /></label>
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
  api.listProcesses().then(({ items }) => {
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
    setLoading(submitBtn, true, "Đang tạo…");
    try {
      const created = await api.createExecution(input as { process_id: string; title?: string });
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
      <div><a href="#/my-work" class="link back">← Việc của tôi</a>
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
        `${e.process_name ?? ""}${e.title ? " — " + e.title : ""}`;
      renderActions(actionsEl, dialogRoot, e, reload);
      body.innerHTML = detailHtml(e);
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
        await api.completeStep(execId, sid);
        toast("Đã hoàn thành bước.");
      } else if (act === "skip") {
        const reason = prompt(`Lý do bỏ qua bước "${step?.code}":`);
        if (!reason?.trim()) {
          restore();
          return;
        }
        await api.skipStep(execId, sid, reason.trim());
        toast("Đã bỏ qua bước.");
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
  }
  if (e.status === "IN_PROGRESS") {
    btns.push(`<button class="btn" data-ea="pause">Tạm dừng</button>`);
    btns.push(`<button class="btn primary" data-ea="complete">Hoàn thành lượt</button>`);
    btns.push(`<button class="btn danger" data-ea="cancel">Hủy lượt</button>`);
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
      } else if (act === "pause") {
        await api.pauseExecution(e.id);
        toast("Đã tạm dừng.");
      } else if (act === "resume") {
        await api.resumeExecution(e.id);
        toast("Đã tiếp tục.");
      } else if (act === "complete") {
        await api.completeExecution(e.id);
        toast("Đã hoàn thành lượt.");
      } else if (act === "cancel") {
        const reason = prompt("Lý do hủy lượt (bắt buộc):");
        if (!reason?.trim()) {
          restore();
          return;
        }
        await api.cancelExecution(e.id, reason.trim());
        toast("Đã hủy lượt.");
      }
      await reload();
    } catch (err) {
      toast(`Lỗi: ${msg(err)}`);
      restore();
    }
  };
}

function detailHtml(e: ExecutionDetail): string {
  const p = e.progress;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  const active = e.status === "IN_PROGRESS";
  return `
    <section class="card">
      <h3>Thông tin lượt</h3>
      <dl class="info-list">
        <div class="info-row"><dt>Trạng thái</dt><dd>${execPill(e.status)}</dd></div>
        <div class="info-row"><dt>Quy trình</dt><dd>${esc(e.process_name ?? "—")} (${esc(e.process_code ?? "")})</dd></div>
        <div class="info-row"><dt>Tiến độ</dt><dd>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          ${p?.done ?? 0}/${p?.total ?? 0} bước (${pct}%)</dd></div>
        ${e.cancel_reason ? `<div class="info-row"><dt>Lý do hủy</dt><dd>${esc(e.cancel_reason)}</dd></div>` : ""}
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
          const canStart = active && st.status === "NOT_STARTED";
          const canFinish = active && st.status === "IN_PROGRESS";
          const canSkip = active && (st.status === "NOT_STARTED" || st.status === "IN_PROGRESS") && !st.is_required;
          return `<li data-sid="${esc(st.id)}">
            <div class="step-head">
              <span class="step-num">${idx + 1}</span>
              <div class="step-title">
                <strong>${esc(st.code)}</strong> — ${esc(st.title)}
                ${st.is_required ? "" : ' <span class="pill gray">Tùy chọn</span>'}
                <span class="pill ${st.status === "PASSED" ? "green" : st.status === "SKIPPED" ? "gray" : st.status === "IN_PROGRESS" ? "blue" : "gray"}">${esc(STEP_STATUS_LABELS[st.status] ?? st.status)}</span>
                ${st.role ? `<div class="muted small">Vai trò: ${esc(st.role)}</div>` : ""}
                ${st.skip_reason ? `<div class="muted small">Lý do bỏ qua: ${esc(st.skip_reason)}</div>` : ""}
                ${st.note ? `<div class="muted small">Ghi chú: ${esc(st.note)}</div>` : ""}
              </div>
              <div class="step-actions">
                ${canStart ? `<button class="btn sm primary" data-step="start">Bắt đầu</button>` : ""}
                ${canFinish ? `<button class="btn sm primary" data-step="complete">Hoàn thành</button>` : ""}
                ${canSkip ? `<button class="btn sm" data-step="skip">Bỏ qua</button>` : ""}
              </div>
            </div>
            ${st.instruction ? `<p class="step-instr">${esc(st.instruction)}</p>` : ""}
          </li>`;
        }).join("")}
      </ol>
      </div>
      <div data-exec-diagram hidden>
        ${renderExecDiagram(e.steps)}
      </div>
    </section>`;
}

/** Sơ đồ tuyến tính cho lượt thực hiện — màu theo trạng thái bước. */
function renderExecDiagram(steps: import("../api.js").ExecutionStep[]): string {
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
  };
  return `
    <div class="flow-diagram" role="img" aria-label="Sơ đồ lượt thực hiện ${steps.length} bước">
      ${steps.map((st, idx) => `
        ${idx > 0 ? `<div class="flow-arrow" aria-hidden="true">↓</div>` : ""}
        <div class="flow-node exec ${cls[st.status] ?? ""}">
          <div class="flow-node-head">
            <span class="flow-num">${idx + 1}</span>
            <strong>${esc(st.code)}</strong>
            <span class="pill ${st.status === "PASSED" ? "green" : st.status === "IN_PROGRESS" ? "blue" : "gray"}">${esc(label[st.status] ?? st.status)}</span>
          </div>
          <div class="flow-title">${esc(st.title)}</div>
        </div>`).join("")}
    </div>`;
}

export { EXEC_STATUS_LABELS };
