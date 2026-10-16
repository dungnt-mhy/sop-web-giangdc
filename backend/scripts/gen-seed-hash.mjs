// gen-seed-hash.mjs — tạo salt ngẫu nhiên + băm PBKDF2-SHA256 cho mật khẩu seed.
// Dùng để sinh giá trị dán vào migration 0003_seed_admin.sql (hoặc xoay mật khẩu seed).
//
//   node scripts/gen-seed-hash.mjs [mat-khau]
//
// Tham số băm PHẢI khớp với backend/src/auth.ts (PBKDF2_ITERATIONS...).
// node:crypto và WebCrypto (Worker) implement cùng chuẩn PBKDF2 nên kết quả tương thích.
import { randomBytes, pbkdf2Sync } from "node:crypto";

const password = process.argv[2] ?? "Admin@123";
const iterations = 100000;
const saltLen = 16;
const keyLen = 32;

const salt = randomBytes(saltLen);
const hash = pbkdf2Sync(password, salt, iterations, keyLen, "sha256");

console.log("-- Dán các giá trị dưới đây vào migration 0003_seed_admin.sql");
console.log(`-- Mật khẩu seed: ${password}`);
console.log(`password_salt = '${salt.toString("base64")}'`);
console.log(`password_hash = '${hash.toString("base64")}'`);
console.log(`hash_params   = '{"iterations":${iterations},"salt_len":${saltLen},"key_len":${keyLen}}'`);
