# HANDOFF.md — Thư bàn giao mới nhất

> Cập nhật cuối mỗi phiên làm việc. Bản cũ lưu tại `docs/handoffs/HANDOFF-YYYY-MM-DD.md`.

## Ngày: 2026-10-17 — Task 1.2 (+1.3) HOÀN TẤT (done, chờ verified)

### Đã làm xong
- **Backend** (`backend/src/`, migration `0002_auth.sql` + `0003_seed_admin.sql`):
  `POST /auth/login|logout|logout-all`, `GET /auth/session`, `POST /auth/change-password`,
  `GET/POST /users`, `GET/PATCH /users/{id}`, `POST /users/{id}:lock|unlock|force-password-change`.
  PBKDF2-SHA256 100k vòng (WebCrypto), session cookie HttpOnly, RBAC theo ma trận §5
  (middleware `requirePermission`, admin có `*`), khoá 15' sau 5 lần sai, lỗi login chung chung,
  CSRF check Origin cho cookie, CORS allowlist, audit sự kiện xác thực/quản trị.
- **Seed admin demo/dev**: `admin` / `Admin@123` (bắt buộc đổi ở lần đăng nhập đầu).
  ⚠️ Chỉ dùng cho demo/dev.
- **Frontend** (`frontend/src/*.ts` → `dist/`): trang giới thiệu công khai (2 cột desktop/1 cột
  mobile, SVG tự vẽ, card đăng nhập nổi bật), trang chủ theo vai trò (empty state, không số liệu giả),
  trang quản trị người dùng (admin), layout desktop ≥1024px (sidebar thu gọn được), route guard,
  đăng xuất huỷ phiên server. Tiếng Việt, không SSO, không quên mật khẩu (tắt theo SPEC).
- **CI/deploy**: `ci.yml` thêm typecheck+build frontend; `deploy-demo.yml` build frontend,
  sinh `config.js` từ `vars.WORKER_URL`, smoke test thêm `/api/v1/auth/session` (401).
- **Kiểm chứng local** (không chạm Cloudflare demo): `tsc --noEmit` backend+frontend pass,
  `wrangler deploy --dry-run` pass, `wrangler dev --local` + 35/35 smoke test curl đạt
  (login đúng/sai, session, đổi MK bắt buộc, RBAC 403, khoá/mở/force-change, brute-force lockout,
  logout, CORS, CSRF).

### Chưa làm / cần lưu ý
- Chưa kiểm chứng bằng trình duyệt thật: hiển thị 6 viewport (360/768/1024/1280/1440/1920),
  luồng click đăng nhập→trang chủ→quản trị user, không cuộn ngang — cần người kiểm tra visual.
- `POST /auth/forgot-password` và `/auth/reset-password` chưa làm (tắt theo SPEC).
- Quyết định kỹ thuật mới: D-10..D-13 trong `docs/DECISIONS.md`.
- Việc tiếp theo: **Task 1.4** — quản lý danh mục quy trình (CRUD + phiên bản + phê duyệt).

## Ngày: 2026-10-16 — Khởi tạo dự án

### Đã làm xong
- Hoàn thành toàn bộ giai đoạn đặc tả: SOW (Word), phân tích nghiệp vụ (web), đặc tả kỹ thuật v1.4 (`docs/SPEC.md`), cẩm nang làm việc với AI agent (web).
- Dựng khung dự án tại `workspace/sop/` với đầy đủ bộ file bàn giao (AGENTS.md, PROGRESS.md, DECISIONS.md, FIRST_TASK.md).
- Chốt 8 quyết định kiến trúc (xem `docs/DECISIONS.md`).

### Chưa làm (việc tiếp theo)
- **Task 01** theo `FIRST_TASK.md`: khởi tạo repository, kiến trúc, CI và deploy demo lên Cloudflare.
- Cần chủ dự án chuẩn bị: tài khoản Cloudflare, tài khoản GitHub, repo mới (public/private tùy ý).

### Lưu ý cho phiên tiếp theo
- Đọc `AGENTS.md` trước khi nhận việc.
- Mọi quyết định mới phải ghi vào `docs/DECISIONS.md`; không tự sửa `docs/SPEC.md`.
- Cuối phiên: cập nhật `docs/PROGRESS.md` + viết lại file này.

### Quyết định cần chủ dự án chốt dần
Xem mục "Quyết định còn mở" trong `docs/DECISIONS.md` và 14 quyết định mở trong `docs/SPEC.md`.
