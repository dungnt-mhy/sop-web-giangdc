# HANDOFF.md — Thư bàn giao mới nhất

> Cập nhật cuối mỗi phiên làm việc. Bản cũ lưu tại `docs/handoffs/HANDOFF-YYYY-MM-DD.md`.

## Ngày: 2026-10-17 — Task 01 HOÀN TẤT (1.1 verified)

### Đã làm xong
- Đẩy toàn bộ 25 file khung code lên repo **dungnt-mhy/sop-web-giangdc** (public).
  Lưu ý kỹ thuật: GitHub App "Meta Muse AI" bị lỗi 403 khi ghi (cả 2 tài khoản GitHub đã thử) —
  riêng API contents từng file thì OK, riêng `push_files` (git trees) và `.github/workflows/*`
  (thiếu quyền Workflows) thì 403. Đã dùng `gh` CLI với token của chủ dự án để đẩy
  (token GitHub classic scope repo, lưu trên máy đến khi xong dự án mới thu hồi).
- **CI xanh** (26s) trên GitHub Actions.
- Tạo D1 `sop_demo_db` (id `72dce788-…`), apply migration, tạo R2 bucket `sop-demo-files`,
  cập nhật `database_id` thật vào `wrangler.toml` (đã push lên repo).
- Deploy Worker `sop-api` → https://sop-api.dungnt-storage.workers.dev
  (`/health` → 200, `bindings: {d1: true, r2: true}`).
- Deploy frontend → **https://sop-web-giangdc.pages.dev** (trang "đang xây dựng", 200).
- Đã cấu hình secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` và vars
  `PAGES_PROJECT_NAME`/`WORKER_URL` trên repo cho workflow `deploy-demo.yml`
  (chạy khi push nhánh `demo` hoặc dispatch thủ công).

### Chưa làm (việc tiếp theo)
- **Task 1.2**: xác thực + quản lý người dùng, phân quyền (AC-11, AC-12).
- Quyết định còn mở: xem `docs/DECISIONS.md` và 14 quyết định mở trong `docs/SPEC.md`.
- Token Cloudflare + GitHub đang lưu tạm trên máy Muse — **thu hồi khi xong dự án**.

### Lưu ý cho phiên tiếp theo
- Đọc `AGENTS.md` trước khi nhận việc.
- Mọi quyết định mới phải ghi vào `docs/DECISIONS.md`; không tự sửa `docs/SPEC.md`.
- Cuối phiên: cập nhật `docs/PROGRESS.md` + viết lại file này.
- Deploy demo sau này: push nhánh `demo` (hoặc Actions → Deploy demo → Run workflow).

## Ngày: 2026-10-16 — Khởi tạo dự án

### Đã làm xong
- Hoàn thành toàn bộ giai đoạn đặc tả: SOW (Word), phân tích nghiệp vụ (web), đặc tả kỹ thuật v1.4 (`docs/SPEC.md`), cẩm nang làm việc với AI agent (web).
- Dựng khung dự án tại `workspace/sop/` với đầy đủ bộ file bàn giao (AGENTS.md, PROGRESS.md, DECISIONS.md, FIRST_TASK.md).
- Chốt 8 quyết định kiến trúc (xem `docs/DECISIONS.md`).

### Chưa làm (việc tiếp theo)
- **Task 01 (tiếp)**: khung code scaffold đã xong tại `workspace/sop/repo/` (2026-10-16 ~22:30) —
  frontend tĩnh + Worker `/health` + CI + wrangler.toml/D1/R2, đã kiểm chứng local.
  Còn lại các bước thủ công của chủ dự án (xem README trong repo, 9 bước):
  tạo repo GitHub, tạo D1 `sop_demo_db`, tạo R2 bucket `sop-demo-files`,
  thêm secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, điền `database_id` thật,
  push nhánh `demo` → deploy demo + smoke test `/health` → khi đó 1.1 mới `verified`.
- Cần chủ dự án chuẩn bị: ~~tài khoản Cloudflare, tài khoản GitHub, repo mới~~
  (đã có tài khoản; còn chốt **tên repo**).

### Lưu ý cho phiên tiếp theo
- Đọc `AGENTS.md` trước khi nhận việc.
- Mọi quyết định mới phải ghi vào `docs/DECISIONS.md`; không tự sửa `docs/SPEC.md`.
- Cuối phiên: cập nhật `docs/PROGRESS.md` + viết lại file này.

### Quyết định cần chủ dự án chốt dần
Xem mục "Quyết định còn mở" trong `docs/DECISIONS.md` và 14 quyết định mở trong `docs/SPEC.md`.
