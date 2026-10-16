// config.example.js — cấu hình địa chỉ API cho frontend.
// Copy thành `config.js` (đã gitignore) và sửa apiBase cho môi trường của bạn:
//   - Dev local:  "http://localhost:8787" (wrangler dev)
//   - Demo:       "https://sop-api.dungnt-storage.workers.dev"
// Khi deploy demo, GitHub Actions tự sinh config.js từ vars.WORKER_URL.
// Để trống ("") nghĩa là API cùng origin với frontend.
window.SOP_CONFIG = { apiBase: "http://localhost:8787" };
