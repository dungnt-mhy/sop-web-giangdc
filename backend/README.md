# sop-api — Backend demo (Cloudflare Workers + D1)

API cho dự án SOP. Task 1.2: xác thực nội bộ + quản lý người dùng + phân quyền.

## Endpoint

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/health` | công khai | Kiểm tra sức khoẻ |
| POST | `/api/v1/auth/login` | công khai | `{username, password}` → set cookie phiên |
| POST | `/api/v1/auth/logout` | đã đăng nhập | Thu hồi phiên hiện tại |
| POST | `/api/v1/auth/logout-all` | đã đăng nhập | Thu hồi mọi phiên của user |
| GET | `/api/v1/auth/session` | đã đăng nhập | user + roles + permissions |
| POST | `/api/v1/auth/change-password` | đã đăng nhập | `{current_password, new_password}` |
| GET | `/api/v1/users` | `users.manage` | cursor pagination |
| POST | `/api/v1/users` | `users.manage` | tạo tài khoản, mật khẩu tạm |
| GET | `/api/v1/users/{id}` | `users.manage` | chi tiết |
| PATCH | `/api/v1/users/{id}` | `users.manage` | sửa tên/email/trạng thái/vai trò |
| POST | `/api/v1/users/{id}:lock` | `users.manage` | khoá + thu hồi mọi phiên |
| POST | `/api/v1/users/{id}:unlock` | `users.manage` | mở khoá |
| POST | `/api/v1/users/{id}:force-password-change` | `users.manage` | bắt đổi MK + thu hồi mọi phiên |

Quên/khôi phục mật khẩu **tắt** theo SPEC (chỉ bật khi `OPEN-AUTH-POLICY-01` chốt kênh giao token).

## Bảo mật (tham số hiện tại — DEFAULT, chờ chốt ở UAT)

- **Băm mật khẩu:** PBKDF2-HMAC-SHA256, salt 16 byte ngẫu nhiên riêng mỗi user,
  **100.000 vòng**, derived key 32 byte (xem `src/auth.ts`). Mỗi lần đổi mật khẩu
  sinh salt mới. `hash_params` lưu số vòng → có thể tăng dần về sau.
- **Khoá tạm:** sai 5 lần liên tiếp → khoá 15 phút. Lỗi đăng nhập luôn chung chung
  ("Tên đăng nhập hoặc mật khẩu không đúng."), không tiết lộ tài khoản có tồn tại.
- **Phiên:** token 32 byte ngẫu nhiên; server chỉ lưu SHA-256 của token.
  Cookie `sop_session`: `HttpOnly`, `Path=/`, `Secure` + `SameSite=None` khi HTTPS,
  `SameSite=Lax` khi HTTP (dev local). Hạn trượt **12 giờ**, tối đa tuyệt đối **7 ngày**.
- **CSRF:** mutation dùng cookie yêu cầu header `Origin` thuộc `ALLOWED_ORIGINS`.
- **Rate limit đăng nhập:** 20 lượt / 10 phút / IP (best-effort, bộ nhớ isolate)
  + khoá tài khoản theo chính sách trên.
- Đổi mật khẩu thu hồi mọi phiên khác; khoá tài khoản thu hồi mọi phiên.

## Tài khoản seed (demo/dev)

Migration `0003_seed_admin.sql` tạo sẵn:

- Tên đăng nhập: `admin` — Mật khẩu: `Admin@123`
- Lần đăng nhập đầu **bắt buộc đổi mật khẩu** mới dùng tiếp.
- ⚠️ Chỉ dùng cho demo/dev. Production tạo tài khoản qua API sau khi đổi mật khẩu seed.

## Biến môi trường

| Biến | Ví dụ | Ghi chú |
|---|---|---|
| `ENV_NAME` | `demo` | Tên môi trường (không bí mật) |
| `ALLOWED_ORIGINS` | `https://sop-web-giangdc.pages.dev` | Origin frontend, cách nhau dấu phẩy |

Copy `backend/.dev.vars.example` thành `.dev.vars` khi chạy local (file này đã gitignore).

## Phát triển local

```bash
cd backend
npm ci
npx tsc --noEmit                                   # kiểm tra kiểu
npx wrangler d1 migrations apply sop_demo_db --local   # tạo DB local + seed admin
npx wrangler dev --local                           # API ở http://localhost:8787
```

Hash cho seed mới: `node scripts/gen-seed-hash.mjs [mật-khẩu]`.
