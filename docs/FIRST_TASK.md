# FIRST_TASK.md — Gói giao việc đầu tiên (đề xuất)

> Agent nhận việc này sau khi đã đọc `AGENTS.md`, `docs/SPEC.md`, `docs/HANDOFF.md`, `docs/PROGRESS.md`.
> Đây là việc NHỎ NHẤT có thể kiểm chứng được — làm xong việc này mới nhận việc tiếp theo.

## Task 01 — Khởi tạo nền móng dự án

### Mục tiêu
Dựng khung dự án chạy được, có CI và deploy demo lên Cloudflare free, để các task sau chỉ việc
xây tính năng lên trên.

### Phạm vi
1. Khởi tạo repository (monorepo): `frontend/` (PWA mobile-first), `backend/` (API), `docs/`, `scripts/`.
2. Copy `docs/SPEC.md`, `AGENTS.md` hiện tại vào repo làm tài liệu gốc.
3. Thiết lập CI cơ bản (lint + build) bằng GitHub Actions.
4. Cấu hình deploy demo: frontend → Cloudflare Pages; backend → Workers + D1 + R2 (file `wrangler.toml`, migration D1 ban đầu).
5. Trang "đang xây dựng" đơn giản deploy thành công lên URL demo Cloudflare.

### Ngoài phạm vi (không làm trong task này)
- Chưa làm đăng nhập, chưa làm tính năng nghiệp vụ nào.
- Chưa đụng đến VPS production.

### Tiêu chí nghiệm thu
- [ ] Mở URL demo Cloudflare thấy trang "đang xây dựng".
- [ ] Push code lên GitHub tự động deploy lại (Actions xanh).
- [ ] API backend trả về `GET /health` = 200.
- [ ] Cập nhật `docs/PROGRESS.md` (task 1.1 → verified) và `docs/HANDOFF.md`.

### Cần chủ dự án chuẩn bị trước
- Tài khoản Cloudflare (free) + API token cho GitHub Actions.
- Tài khoản GitHub + repository mới.
- Quyết định tên repo.

### Bằng chứng bàn giao
Link demo Cloudflare + ảnh chụp Actions chạy xanh + `curl` kết quả `/health`.
