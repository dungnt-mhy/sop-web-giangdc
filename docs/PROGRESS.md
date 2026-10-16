# PROGRESS.md — Bảng tiến độ dự án SOP

> Cập nhật sau mỗi việc. Chỉ dùng `verified` khi có bằng chứng kiểm chứng (test xanh, ảnh màn hình, link demo).

## Phase 0 — Đặc tả (HOÀN THÀNH)

| # | Việc | Trạng thái | Ngày | Ghi chú |
|---|------|------------|------|---------|
| 0.1 | Tài liệu SOW (Word) | verified | 2026-10-16 | `workspace/your_files/sow-he-thong-quan-ly-trinh-tu-cong-viec/` |
| 0.2 | Phân tích nghiệp vụ (web) | verified | 2026-10-16 | Artifact "Phân tích nghiệp vụ – Số hoá quy trình SOP" |
| 0.3 | Đặc tả kỹ thuật cho AI agent | verified | 2026-10-16 | `docs/SPEC.md` — v1.4 |
| 0.4 | Cẩm nang làm việc với AI agent (web) | verified | 2026-10-16 | Artifact "Hướng dẫn làm việc với AI Agent" |
| 0.5 | Khung dự án + bộ file bàn giao | verified | 2026-10-16 | Thư mục `workspace/sop/` |

## Phase 1 — Xây dựng MVP (CHƯA BẮT ĐẦU)

| # | Module | Trạng thái | Ghi chú |
|---|--------|------------|---------|
| 1.1 | Khởi tạo repo, kiến trúc, CI, deploy demo Cloudflare | in_progress | Scaffold local xong `workspace/sop/repo/` 2026-10-16 ~22:30 (đã kiểm chứng local, xem nhật ký); còn: tạo repo GitHub + D1/R2 + secrets + push nhánh `demo` để deploy thật |
| 1.2 | Xác thực + quản lý người dùng, phân quyền | done | 2026-10-17 — backend: PBKDF2-SHA256, session cookie HttpOnly, RBAC theo §5, API /auth/* + /users/*, seed admin; kiểm chứng local: tsc + dry-run + 35/35 smoke test curl đạt |
| 1.3 | Trang giới thiệu + đăng nhập + trang chủ theo vai trò | done | 2026-10-17 — cùng task 1.2: landing 2 cột/1 cột, card đăng nhập, trang chủ theo quyền, layout desktop ≥1024px (sidebar thu gọn được), route guard, đăng xuất; kiểm chứng: tsc, node --check, curl 200 |
| 1.4 | Quản lý danh mục quy trình (CRUD + phiên bản + phê duyệt) | pending | — |
| 1.5 | Soạn bước công việc (form + sắp xếp + xem trước sơ đồ) | pending | Không làm designer kéo-thả |
| 1.6 | Thực hiện theo checklist + bằng chứng ảnh + ngoại lệ | pending | — |
| 1.7 | Giấy tờ/biểu mẫu | pending | — |
| 1.8 | Lịch sử, dashboard, báo cáo, xuất dữ liệu | pending | Dashboard ở mức SHOULD |
| 1.9 | Triển khai production VPS (Docker Compose) | pending | Sau khi demo ổn định |

## Nhật ký

- 2026-10-16: Khởi tạo bảng tiến độ. Đặc tả v1.4 đã chốt, sẵn sàng giao việc code.
- 2026-10-16 (~22:30): Task 01 scaffold local hoàn tất tại `workspace/sop/repo/` (frontend tĩnh + Worker `/health` + CI + wrangler.toml/D1/R2 + README hướng dẫn 9 bước thủ công). Đã kiểm chứng: `tsc --noEmit` OK, `wrangler deploy --dry-run` OK, `/health` local trả 200, frontend phục vụ HTTP 200, YAML/SQL hợp lệ, không secret hardcode. Còn lại: tạo repo GitHub, tạo D1/R2, thêm secrets, điền `database_id` thật, push nhánh `demo` để deploy thật → khi đó mới chuyển 1.1 sang `verified`.
