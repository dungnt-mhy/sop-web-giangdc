-- 0003_seed_admin.sql — Tài khoản quản trị bootstrap cho môi trường demo/dev (Task 1.2).
--
--   Tên đăng nhập: admin
--   Mật khẩu:      Admin@123  (xem README.md — CHỈ dùng cho demo/dev)
--
-- CẢNH BÁO BẢO MẬT:
-- - `must_change_password = 1` nên lần đăng nhập đầu tiên BẮT BUỘC đổi mật khẩu mới dùng tiếp.
-- - Production: tạo tài khoản bằng quy trình riêng (API POST /users sau khi đăng nhập admin
--   lần đầu và đổi mật khẩu), KHÔNG dùng tài khoản seed này cho dữ liệu thật.
-- - Hash dưới đây được sinh bằng scripts/gen-seed-hash.mjs (PBKDF2-SHA256, 100.000 vòng).
-- - Dùng INSERT OR IGNORE nên migration an toàn khi chạy lại.

INSERT OR IGNORE INTO users
  (id, username, display_name, email, status, password_changed_at,
   failed_login_count, locked_until, created_at, created_by, updated_at, updated_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin', 'Quản trị viên', NULL, 'active', NULL,
   0, NULL, '2026-10-17T00:00:00.000Z', 'seed', NULL, NULL);

INSERT OR IGNORE INTO local_credentials
  (id, user_id, password_hash, password_salt, hash_algorithm, hash_params,
   must_change_password, rotated_at, created_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
   '63UFENs45fRCwyTgJTM+/dnGacjlTMrxUiWtjVaRTsE=',
   'hfzOvHY8GFufOgEqGRzc1w==',
   'PBKDF2-SHA256',
   '{"iterations":100000,"salt_len":16,"key_len":32}',
   1, NULL, '2026-10-17T00:00:00.000Z', 'seed');

INSERT OR IGNORE INTO user_roles (user_id, role, created_at, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin', '2026-10-17T00:00:00.000Z', 'seed');
