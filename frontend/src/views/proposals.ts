/**
 * Trang Đề xuất lượt công việc (#/proposals).
 * Nhân viên tạo đề xuất → người phê duyệt duyệt/từ chối.
 */
import { api, Proposal, ProcessStep } from "../api.js";
import { esc, toast } from "../ui.js";

function openConfirmDialog(dialogRoot: HTMLElement, title: string, message: string, okLabel = "Xác nhận"): Promise<boolean> {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="dialog-scrim"></div>
      <div class="dialog" style="max-width:400px;">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn" id="cd-cancel">Hủy</button>
          <button class="btn primary" id="cd-ok">${esc(okLabel)}</button>
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
      <div class="dialog-scrim"></div>
      <div class="dialog" style="max-width:400px;">
        <h3>${esc(title)}</h3>
        <textarea id="rd-reason" class="input" rows="3" placeholder="${esc(placeholder)}"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn" id="rd-cancel">Hủy</button>
          <button class="btn primary" id="rd-ok">Xác nhận</button>
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
  const canResubmit = !isReceived && p.status === "REJECTED";
  return `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div>
          <div style="font-weight:600;">${esc(p.process_name ?? "—")}${p.title ? ` — ${esc(p.title)}` : ""}</div>
          <div class="muted small">Người đề xuất: ${esc(p.proposer_name ?? "—")} · ${esc(p.created_at?.slice(0, 16).replace("T", " ") ?? "")}</div>
          ${p.expected_start_at ? `<div class="muted small">Bắt đầu dự kiến: ${esc(p.expected_start_at.slice(0, 16).replace("T", " "))}</div>` : ""}
          ${(p.approver_names ?? []).filter(Boolean).length ? `<div class="muted small">Người duyệt: ${esc((p.approver_names ?? []).filter(Boolean).join(", "))}</div>` : ""}
          ${(p.supervisor_names ?? []).filter(Boolean).length ? `<div class="muted small">Giám sát lượt: ${esc((p.supervisor_names ?? []).filter(Boolean).join(", "))}</div>` : ""}
          ${(p.steps ?? []).length ? `<div class="muted small">Đã phân công ${(p.steps ?? []).length} bước</div>` : ""}
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
      ${p.status === "APPROVED" && p.execution_id ? `
        <div style="margin-top:12px;">
          <a class="btn sm" href="#/executions/${esc(p.execution_id)}">📄 Xem lượt đã tạo →</a>
        </div>` : ""}
      ${canResubmit ? `
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn primary sm" data-proposal="edit" data-id="${esc(p.id)}">✏️ Sửa & gửi lại</button>
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

  const itemsById = new Map<string, Proposal>();

  async function loadList(): Promise<void> {
    try {
      const { items } = await api.listProposals(tab);
      itemsById.clear();
      for (const p of items) itemsById.set(p.id, p);
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
  function switchTab(newTab: "received" | "sent"): void {
    tab = newTab;
    root.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === newTab);
    });
    window.location.hash = `#/proposals?tab=${newTab}`;
    void loadList();
  }
  root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab as "received" | "sent");
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
        "Duyệt đề xuất này? Lượt công việc sẽ được tạo ngay với đúng phân công đã ghi trong đề xuất.",
        "✅ Duyệt & tạo lượt",
      );
      if (!confirmed) return;
      try {
        const result = await api.approveProposal(id);
        toast(`Đã duyệt — đã tạo lượt ${result.execution_code ?? ""}.`, "ok");
        if (result.execution_id) {
          window.location.hash = `#/executions/${result.execution_id}`;
        } else {
          loadList();
        }
      } catch (e) {
        toast(`Lỗi: ${(e as Error).message}`, "err");
      }
    } else if (action === "edit") {
      const p = itemsById.get(id);
      if (!p) return;
      openProposalDialog(dialogRoot, loadList, p);
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

  // Nút đề xuất mới. Sau khi gửi xong tự chuyển sang tab "Tôi đã đề xuất"
  // để nhân viên thấy ngay đề xuất vừa gửi (không bị tưởng là chưa lưu).
  root.querySelector("#btn-new-proposal")?.addEventListener("click", () => {
    openProposalDialog(dialogRoot, () => switchTab("sent"));
  });

  await loadList();
}

/** Dialog tạo đề xuất mới — hoặc sửa & gửi lại đề xuất bị từ chối (khi truyền existing).
 * Form gồm: quy trình (trong phạm vi), người duyệt (≤2), giám sát lượt (≤2),
 * và phân công theo từng bước: người làm (≥1) + giám sát/duyệt bước (1–2). */
async function openProposalDialog(dialogRoot: HTMLElement, onDone: () => void, existing?: Proposal): Promise<void> {
  const isEdit = !!existing;
  const [processesRes, sessionRes, usersRes, orgRes] = await Promise.allSettled([
    api.listProcesses({ status: "ACTIVE" }),
    api.session(),
    api.listActiveUsers(),
    api.listOrgUnits(),
  ]);
  const processes = processesRes.status === "fulfilled" ? (processesRes.value.items ?? []) : [];
  const myUnitId = sessionRes.status === "fulfilled" ? (sessionRes.value.user.org_unit_id ?? null) : null;
  const allUsers = usersRes.status === "fulfilled" ? (usersRes.value.items ?? []) : [];

  // Nhánh đơn vị của mình: đơn vị mình + tổ tiên + cấp dưới (để lọc người được chọn cho bước).
  let branchUnits: Set<string> | null = null;
  if (myUnitId && orgRes.status === "fulfilled") {
    const units = orgRes.value.items ?? [];
    const byId = new Map(units.map((u) => [u.id, u]));
    branchUnits = new Set<string>([myUnitId]);
    let cur = byId.get(myUnitId);
    while (cur?.parent_id) { branchUnits.add(cur.parent_id); cur = byId.get(cur.parent_id); }
    const childrenOf = new Map<string, string[]>();
    for (const u of units) {
      if (u.parent_id) {
        const arr = childrenOf.get(u.parent_id) ?? [];
        arr.push(u.id);
        childrenOf.set(u.parent_id, arr);
      }
    }
    const queue = [myUnitId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const ch of childrenOf.get(id) ?? []) {
        if (!branchUnits.has(ch)) { branchUnits.add(ch); queue.push(ch); }
      }
    }
  }
  const inBranch = (u: { org_unit_id?: string | null }): boolean =>
    branchUnits === null || (!!u.org_unit_id && branchUnits.has(u.org_unit_id));

  // Pool người quản lý (người duyệt + giám sát) theo phạm vi đơn vị.
  let managerUsers: { id: string; display_name: string; username: string; org_unit_name?: string | null }[] = [];
  try {
    const { items } = await api.listApprovers();
    managerUsers = (items ?? []).slice(0, 20);
  } catch { /* bỏ qua */ }

  type ActiveU = { id: string; username: string; display_name: string; position_id: string | null; position_name: string | null; org_unit_id?: string | null };

  const approverSel = new Set<string>(existing?.approver_ids ?? (existing ? [existing.approver_id] : []));
  const supervisorSel = new Set<string>(existing?.supervisor_ids ?? []);

  interface StepState { step: ProcessStep; assignees: Set<string>; supervisors: Set<string> }
  let stepStates: StepState[] = [];

  const eligibleFor = (step: ProcessStep, kind: "asg" | "sup"): ActiveU[] => {
    const req = (kind === "asg" ? step.positions : step.supervisors) ?? [];
    const reqIds = new Set(req.map((p) => p.id));
    return allUsers.filter((u) => {
      const a = u as ActiveU;
      if (!inBranch(a)) return false;
      if (reqIds.size > 0 && (!a.position_id || !reqIds.has(a.position_id))) return false;
      return true;
    }) as ActiveU[];
  };

  dialogRoot.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="dialog" style="max-width:640px;max-height:90vh;overflow-y:auto;">
      <h3>${isEdit ? "✏️ Sửa & gửi lại đề xuất" : "💡 Đề xuất lượt công việc mới"}</h3>
      ${isEdit && existing?.reject_reason ? `<div style="padding:8px;background:#fef2f2;border-radius:6px;margin-bottom:12px;"><div class="small" style="font-weight:600;color:#991b1b;">Lý do bị từ chối:</div><div class="small">${esc(existing.reject_reason)}</div></div>` : ""}
      <div class="form-group">
        <label>Quy trình *</label>
        <select id="pp-process" class="input">
          <option value="">— Chọn quy trình —</option>
          ${processes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
        </select>
        <div class="hint">Chỉ hiện quy trình áp dụng cho đơn vị của bạn hoặc toàn công ty.</div>
      </div>
      <div class="form-group">
        <label>Tiêu đề (tùy chọn)</label>
        <input id="pp-title" class="input" placeholder="VD: Xuất hàng đợt sáng" value="${esc(existing?.title ?? "")}" />
      </div>
      <div class="form-group">
        <label>Người phê duyệt * <span class="muted small">(tối đa 2 người)</span></label>
        <div class="check-list" id="pp-approvers" style="max-height:110px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;"></div>
        <div class="hint">1 trong 2 người duyệt là đủ để tạo lượt.</div>
      </div>
      <div class="form-group">
        <label>Người giám sát lượt * <span class="muted small">(tối đa 2 người)</span></label>
        <div class="check-list" id="pp-supervisors" style="max-height:110px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;"></div>
      </div>
      <div class="form-group">
        <label>Lý do đề xuất *</label>
        <textarea id="pp-reason" class="input" rows="3" placeholder="Giải thích tại sao cần thực hiện lượt này…">${esc(existing?.reason ?? "")}</textarea>
      </div>
      <div class="form-group">
        <label>Bắt đầu dự kiến</label>
        <input id="pp-start" type="datetime-local" class="input" value="${esc(existing?.expected_start_at?.slice(0, 16) ?? "")}" />
      </div>
      <div class="form-group">
        <label>📋 Phân công theo bước *</label>
        <div class="hint" style="margin-bottom:6px;">Mỗi bước phải chọn người làm và người giám sát/duyệt bước. Danh sách chỉ gồm người đúng chức vụ yêu cầu và trong phạm vi đơn vị của bạn.</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <select id="pp-quick-asg" class="input" style="flex:1;min-width:150px;"><option value="">👤 Người làm mặc định…</option></select>
          <select id="pp-quick-sup" class="input" style="flex:1;min-width:150px;"><option value="">👁️ Giám sát mặc định…</option></select>
          <button type="button" class="btn sm" id="pp-quick-apply">Áp dụng cho mọi bước</button>
        </div>
        <div id="pp-steps"><div class="muted small">Chọn quy trình để xem các bước.</div></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn" id="pp-cancel">Hủy</button>
        <button class="btn primary" id="pp-submit">${isEdit ? "Gửi lại" : "Gửi đề xuất"}</button>
      </div>
    </div>`;

  const close = () => { dialogRoot.innerHTML = ""; };
  dialogRoot.querySelector("#pp-cancel")?.addEventListener("click", close);
  dialogRoot.querySelector(".dialog-scrim")?.addEventListener("click", close);

  const renderManagerList = (el: HTMLElement, sel: Set<string>) => {
    el.innerHTML = managerUsers.map((u) =>
      `<label class="check"><input type="checkbox" value="${esc(u.id)}" ${sel.has(u.id) ? "checked" : ""} /> ${esc(u.display_name)} <span class="muted">@${esc(u.username)}</span>${u.org_unit_name ? ` <span class="muted">— ${esc(u.org_unit_name)}</span>` : ""}</label>`
    ).join("") || `<p class="empty">Không có người phù hợp.</p>`;
  };
  const bindManagerList = (elId: string, sel: Set<string>, label: string) => {
    const el = dialogRoot.querySelector<HTMLElement>(elId)!;
    renderManagerList(el, sel);
    el.addEventListener("change", (ev) => {
      const input = ev.target as HTMLInputElement;
      if (input.type !== "checkbox") return;
      if (input.checked) {
        if (sel.size >= 2) {
          input.checked = false;
          toast(`Chỉ được chọn tối đa 2 ${label}.`, "err");
          return;
        }
        sel.add(input.value);
      } else {
        sel.delete(input.value);
      }
    });
  };
  bindManagerList("#pp-approvers", approverSel, "người phê duyệt");
  bindManagerList("#pp-supervisors", supervisorSel, "người giám sát");

  // Ô chọn nhanh: người làm mặc định từ toàn bộ nhân viên trong nhánh, giám sát mặc định từ pool quản lý.
  const quickAsg = dialogRoot.querySelector<HTMLSelectElement>("#pp-quick-asg")!;
  quickAsg.innerHTML = `<option value="">👤 Người làm mặc định…</option>` + allUsers
    .filter((u) => inBranch(u as ActiveU))
    .map((u) => `<option value="${esc(u.id)}">${esc(u.display_name)}</option>`).join("");
  const quickSup = dialogRoot.querySelector<HTMLSelectElement>("#pp-quick-sup")!;
  quickSup.innerHTML = `<option value="">👁️ Giám sát mặc định…</option>` + managerUsers
    .map((u) => `<option value="${esc(u.id)}">${esc(u.display_name)}</option>`).join("");
  dialogRoot.querySelector("#pp-quick-apply")?.addEventListener("click", () => {
    const a = quickAsg.value;
    const s = quickSup.value;
    if (!a && !s) { toast("Chọn người mặc định trước khi áp dụng.", "err"); return; }
    for (const st of stepStates) {
      if (a && eligibleFor(st.step, "asg").some((u) => u.id === a)) st.assignees.add(a);
      if (s && st.supervisors.size < 2 && eligibleFor(st.step, "sup").some((u) => u.id === s)) {
        st.supervisors.add(s);
      }
    }
    renderSteps();
  });

  const stepsEl = dialogRoot.querySelector<HTMLElement>("#pp-steps")!;
  const renderSteps = () => {
    if (stepStates.length === 0) {
      stepsEl.innerHTML = `<div class="muted small">Chọn quy trình để xem các bước.</div>`;
      return;
    }
    stepsEl.innerHTML = stepStates.map((st, i) => {
      const asgList = eligibleFor(st.step, "asg");
      const supList = eligibleFor(st.step, "sup");
      const posHint = (st.step.positions ?? []).length ? `Người làm yêu cầu: ${(st.step.positions ?? []).map((p) => esc(p.name)).join(", ")}` : "Người làm: không yêu cầu chức vụ cụ thể";
      const supHint = (st.step.supervisors ?? []).length ? `Giám sát yêu cầu: ${(st.step.supervisors ?? []).map((p) => esc(p.name)).join(", ")}` : "Giám sát: không yêu cầu chức vụ cụ thể";
      const checkRow = (u: ActiveU, checked: boolean) =>
        `<label class="check"><input type="checkbox" value="${esc(u.id)}" ${checked ? "checked" : ""} /> ${esc(u.display_name)}${u.position_name ? ` <span class="muted">— ${esc(u.position_name)}</span>` : ""}</label>`;
      return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-weight:600;">${esc(st.step.code)} — ${esc(st.step.title)}</div>
        <div class="muted small">${posHint} · ${supHint}</div>
        <div class="small" style="margin-top:8px;font-weight:600;">👤 Người làm *</div>
        <div class="check-list" data-step-idx="${i}" data-kind="asg" style="max-height:110px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:6px;">
          ${asgList.length ? asgList.map((u) => checkRow(u, st.assignees.has(u.id))).join("") : `<p class="empty small">Không có người phù hợp trong phạm vi.</p>`}
        </div>
        <div class="small" style="margin-top:8px;font-weight:600;">👁️ Người giám sát/duyệt bước * <span class="muted">(tối đa 2)</span></div>
        <div class="check-list" data-step-idx="${i}" data-kind="sup" style="max-height:110px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:6px;">
          ${supList.length ? supList.map((u) => checkRow(u, st.supervisors.has(u.id))).join("") : `<p class="empty small">Không có người phù hợp trong phạm vi.</p>`}
        </div>
      </div>`;
    }).join("");
  };
  stepsEl.addEventListener("change", (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.type !== "checkbox") return;
    const box = input.closest<HTMLElement>("[data-step-idx]");
    if (!box) return;
    const st = stepStates[Number(box.dataset.stepIdx)];
    const set = box.dataset.kind === "asg" ? st.assignees : st.supervisors;
    if (input.checked) {
      if (box.dataset.kind === "sup" && set.size >= 2) {
        input.checked = false;
        toast(`Bước ${st.step.code}: chỉ được chọn tối đa 2 người giám sát.`, "err");
        return;
      }
      set.add(input.value);
    } else {
      set.delete(input.value);
    }
  });

  const loadStepsFor = async (processId: string) => {
    stepStates = [];
    renderSteps();
    if (!processId) return;
    try {
      const detail = await api.getProcess(processId);
      const versionId = detail.active_version?.id;
      if (!versionId) { stepsEl.innerHTML = `<div class="muted small">Quy trình chưa có phiên bản đang hiệu lực.</div>`; return; }
      const { items } = await api.listSteps(versionId);
      stepStates = (items ?? []).map((step) => {
        const pre = existing && existing.process_id === processId
          ? (existing.steps ?? []).find((s) => s.process_step_id === step.id)
          : undefined;
        const asgEligible = new Set(eligibleFor(step, "asg").map((u) => u.id));
        const supEligible = new Set(eligibleFor(step, "sup").map((u) => u.id));
        return {
          step,
          assignees: new Set((pre?.assignee_ids ?? []).filter((id) => asgEligible.has(id))),
          supervisors: new Set((pre?.supervisor_ids ?? []).filter((id) => supEligible.has(id))),
        };
      });
      renderSteps();
    } catch {
      stepsEl.innerHTML = `<div class="muted small">Không tải được các bước của quy trình.</div>`;
    }
  };

  const procSel = dialogRoot.querySelector<HTMLSelectElement>("#pp-process")!;
  procSel.addEventListener("change", () => { void loadStepsFor(procSel.value); });
  if (existing) {
    procSel.value = existing.process_id;
    void loadStepsFor(existing.process_id);
  }

  dialogRoot.querySelector("#pp-submit")?.addEventListener("click", async () => {
    const processId = procSel.value;
    const title = dialogRoot.querySelector<HTMLInputElement>("#pp-title")!.value.trim();
    const reason = dialogRoot.querySelector<HTMLTextAreaElement>("#pp-reason")!.value.trim();
    const startAt = dialogRoot.querySelector<HTMLInputElement>("#pp-start")!.value;

    if (!processId) { toast("Vui lòng chọn quy trình.", "err"); return; }
    if (approverSel.size === 0) { toast("Vui lòng chọn ít nhất 1 người phê duyệt.", "err"); return; }
    if (supervisorSel.size === 0) { toast("Vui lòng chọn ít nhất 1 người giám sát lượt.", "err"); return; }
    if (!reason) { toast("Vui lòng nhập lý do đề xuất.", "err"); return; }
    if (stepStates.length === 0) { toast("Quy trình chưa có bước để phân công.", "err"); return; }
    for (const st of stepStates) {
      if (st.assignees.size === 0) { toast(`Bước ${st.step.code} chưa chọn người làm.`, "err"); return; }
      if (st.supervisors.size === 0) { toast(`Bước ${st.step.code} chưa chọn người giám sát/duyệt.`, "err"); return; }
    }
    const payload = {
      process_id: processId,
      title: title || undefined,
      reason,
      approver_ids: [...approverSel],
      supervisor_ids: [...supervisorSel],
      step_assignments: stepStates.map((st) => ({
        process_step_id: st.step.id,
        assignee_ids: [...st.assignees],
        supervisor_ids: [...st.supervisors],
      })),
      expected_start_at: startAt || undefined,
    };
    try {
      if (isEdit && existing) {
        await api.resubmitProposal(existing.id, payload);
        toast("Đã sửa và gửi lại đề xuất.", "ok");
      } else {
        await api.createProposal(payload);
        toast("Đã gửi đề xuất.", "ok");
      }
      close();
      onDone();
    } catch (e) {
      toast(`Lỗi: ${(e as Error).message}`, "err");
    }
  });
}
