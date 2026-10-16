# DECISIONS.md — Sổ quyết định dự án SOP

> Mọi quyết định đã chốt ghi ở đây kèm ngày và lý do. Agent không được tự ý đảo ngược.

| Mã | Ngày | Quyết định | Lý do |
|----|------|------------|-------|
| D-01 | 2026-10-16 | Làm **website PWA mobile-first** ở giai đoạn 1; chưa làm app native, chưa làm Zalo Mini App | Checklist + chụp ảnh trình duyệt làm tốt; native đắt gấp nhiều lần mà chưa cần |
| D-02 | 2026-10-16 | **Đăng nhập nội bộ** (tài khoản do admin cấp); không dùng SSO, không dùng xác thực 2 lớp ở MVP | Đơn giản, đủ dùng cho giai đoạn đầu; SSO/MFA tính sau khi lớn lên |
| D-03 | 2026-10-16 | Soạn quy trình bằng **form + sắp xếp thứ tự + xem trước sơ đồ (read-only)**; **không** làm designer kéo-thả BPMN ở MVP | Quy trình thực tế là checklist tuyến tính; designer kéo-thả đội scope 2–3 lần |
| D-04 | 2026-10-16 | Hỗ trợ **nhiều quy trình**; mỗi quy trình có **phiên bản** riêng; bản đã phát hành là bất biến; lượt đang chạy giữ nguyên bản cũ | Quy trình hay thay đổi, cần kiểm soát thay đổi và truy vết |
| D-05 | 2026-10-16 | **Giao diện desktop đầy đủ** cho mọi màn hình cốt lõi (từ 1024px), không chỉ kéo giãn bản mobile | Người quản lý làm việc trên máy tính |
| D-06 | 2026-10-16 | **Nén ảnh phía client** trước khi tải lên; giới hạn dung lượng/số lượng file (ngưỡng mặc định trong SPEC, điều chỉnh được trước UAT) | Tiết kiệm băng thông, bằng chứng vẫn đủ chất lượng kiểm tra |
| D-07 | 2026-10-16 | Triển khai 3 chặng: **demo Cloudflare free** (Pages + Workers + D1 + R2) → **GitHub + Actions** tự động deploy → **VPS production** (Docker Compose + PostgreSQL + kho file S3-compatible) | Tận dụng free tier để demo nhanh; code một lần, đổi adapter theo môi trường |
| D-08 | 2026-10-16 | Stack mặc định prototype: **TypeScript**; demo dùng D1/R2, production dùng PostgreSQL/S3-compatible | D1 thay PostgreSQL ở demo, R2 tương thích S3 nên ít phải sửa code |
| D-09 | 2026-10-16 | Tên repo GitHub: **sop-web-giangdc** (**public** theo đề xuất của chủ dự án để tiện theo dõi qua GitHub Pages) | Chủ dự án đặt |
| D-10 | 2026-10-17 | **Băm mật khẩu PBKDF2-HMAC-SHA256** (WebCrypto, không thư viện ngoài): salt 16 byte riêng mỗi user, **100.000 vòng**, key 32 byte. 100k (thay vì 600k của OWASP cho server vật lý) là cân bằng có chủ ý cho Workers free; `hash_params` lưu số vòng để tăng dần về sau | Vừa an toàn ở MVP (salt riêng + khoá sau 5 lần sai), vừa không vượt giới hạn CPU của Workers free |
| D-11 | 2026-10-17 | **Chính sách xác thực mặc định** (chờ OPEN-AUTH-POLICY-01 chốt ở UAT): khoá 15 phút sau 5 lần sai liên tiếp; phiên trượt 12 giờ, tối đa tuyệt đối 7 ngày; cookie `HttpOnly` + `Secure`/`SameSite=None` khi HTTPS, `SameSite=Lax` khi HTTP local; mật khẩu tối thiểu 8 ký tự; quên mật khẩu TẮT | Có giá trị dùng được ngay cho demo, vẫn cho phép chốt lại trước UAT |
| D-12 | 2026-10-17 | **Schema thêm 2 bảng ngoài §11**: `user_roles` (vai trò hệ thống theo ma trận §5, tách khỏi vai trò nghiệp vụ) và `audit_events` tối thiểu (ghi sự kiện xác thực/quản trị user, theo ADM-002). `local_credentials` tách cột `password_salt` riêng | §11 là hợp đồng logic — 2 bảng này là hiện thực hoá yêu cầu §5 và ADM-002, không mâu thuẫn SPEC |
| D-13 | 2026-10-17 | **Frontend vanilla TypeScript** (không framework): `frontend/src/*.ts` → `tsc` → `frontend/dist/` (gitignore); CI build trước khi deploy Pages; `config.js` (gitignore, CI sinh từ `vars.WORKER_URL`) chỉ định địa chỉ API; CORS allowlist qua `ALLOWED_ORIGINS` vì Pages và Workers khác origin | Giữ đúng quyết định "không framework" ở giai đoạn này, vẫn deploy được demo cross-origin |

## Quyết định còn mở (xem chi tiết trong SPEC.md)

Chính sách mật khẩu, thời hạn phiên đăng nhập, kênh khôi phục mật khẩu, tên sản phẩm/logo/màu thương hiệu,
mức offline sâu, thời hạn lưu trữ dữ liệu, kênh thông báo, chữ ký (cơ bản/vẽ tay/chữ ký số), SLA...
