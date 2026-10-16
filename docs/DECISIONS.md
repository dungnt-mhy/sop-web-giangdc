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

## Quyết định còn mở (xem chi tiết trong SPEC.md)

Chính sách mật khẩu, thời hạn phiên đăng nhập, kênh khôi phục mật khẩu, tên sản phẩm/logo/màu thương hiệu,
mức offline sâu, thời hạn lưu trữ dữ liệu, kênh thông báo, chữ ký (cơ bản/vẽ tay/chữ ký số), SLA...
