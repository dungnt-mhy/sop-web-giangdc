# Dự án SOP — Hệ thống quản lý trình tự công việc

Nền tảng số hoá quy trình công việc (SOP): khai báo nhiều quy trình, mỗi quy trình gồm
các bước có thứ tự; chọn quy trình để thực hiện theo checklist và ghi nhận bằng chứng
(hình ảnh) từng bước.

> Trạng thái: **Task 01 — khung nền móng** (trang "đang xây dựng" + API `/health` + CI).
> Đặc tả đầy đủ xem `docs/SPEC.md` (v1.4). Nội quy làm việc xem `AGENTS.md` (file này là
> bản copy trong repo; bản gốc quản lý ở thư mục dự án `workspace/sop/`).

## Quyết định kiến trúc đã chốt (tóm tắt)

- Website **PWA mobile-first**, giao diện desktop đầy đủ từ 1024px.
- Đăng nhập nội bộ (không SSO/MFA ở MVP).
- Demo: **Cloudflare Pages** (frontend) + **Workers** (API) + **D1** (database) + **R2** (file).
  Production (sau này): VPS + Docker Compose + PostgreSQL + kho file S3-compatible.
- Frontend ở Task 01 là **HTML/CSS/JS tĩnh** (giữ đơn giản để dựng pipeline nhanh).
  **Quyết định framework frontend** (React/Vue/Svelte hay giữ tĩnh) dành cho task sau,
  trước khi làm màn hình đăng nhập — ghi chú tại đây để không quên.

Chi tiết xem `docs/DECISIONS.md`.

## Cấu trúc thư mục

```
repo/
├── frontend/               # Trang web tĩnh (PWA): index.html, styles.css, app.js,
│   ├── icons/              #   manifest.webmanifest, sw.js (service worker)
│   └── ...
├── backend/                # API Cloudflare Worker (TypeScript)
│   ├── src/index.ts        #   Entry point — hiện chỉ có GET /health
│   ├── src/types.ts        #   Kiểu Env (binding D1/R2)
│   ├── wrangler.toml       #   Cấu hình deploy (không chứa secret/ID tài nguyên)
│   └── migrations/         #   Migration D1, forward-only (0001_init.sql)
├── docs/                   # Tài liệu gốc: SPEC.md, AGENTS.md, DECISIONS.md,
│                           #   PROGRESS.md, HANDOFF.md, FIRST_TASK.md
├── scripts/                # Script vận hành (sẽ thêm dần)
└── .github/workflows/
    ├── ci.yml              # CI: typecheck + kiểm tra frontend + build worker (dry-run)
    └── deploy-demo.yml     # Deploy demo khi push nhánh `demo` (cần secrets)
```

## Chạy local

**Frontend** (mở trang "đang xây dựng"):

```bash
cd frontend
python3 -m http.server 8080
# mở http://localhost:8080
```

**Backend** (Worker, cần Node 20+):

```bash
cd backend
npm install
npx wrangler dev
# mở http://localhost:8787/health  →  {"status":"ok", ...}
```

**Kiểm tra nhanh** (những gì CI chạy):

```bash
cd backend && npm install && npx tsc --noEmit   # typecheck
cd frontend && node --check app.js && node --check sw.js
```

## Các bước thủ công chủ dự án cần làm (sau khi nhận khung code này)

> ⚠️ Không commit secret/token vào repo — tất cả secret chỉ nhập ở GitHub Settings.

1. **Tạo repository trên GitHub** (tên repo do chủ dự án chốt, ví dụ `sop-web`),
   push toàn bộ thư mục này lên nhánh `main`.
2. **Tạo nhánh `demo`** trên GitHub (deploy demo chỉ chạy khi push vào nhánh này):
   `git checkout -b demo && git push -u origin demo`.
3. **Cloudflare — tạo D1 database**: Dashboard → Workers & Pages → D1 →
   Create database, tên `sop_demo_db`. Copy **Database ID** rồi điền vào
   `backend/wrangler.toml` (dòng `database_id`, bỏ dấu `#`).
4. **Cloudflare — tạo R2 bucket**: Dashboard → R2 → Create bucket, tên `sop-demo-files`
   (giữ chế độ riêng tư/private — không bật public access).
5. **Cloudflare — tạo API token**: Dashboard → My Profile → API Tokens →
   Create Token → mẫu **"Edit Cloudflare Workers"**. Copy token.
6. **GitHub — thêm secrets** (repo → Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` = token ở bước 5
   - `CLOUDFLARE_ACCOUNT_ID` = Account ID (Dashboard → Workers & Pages, cột phải)
7. **GitHub — thêm variables** (cùng mục Actions → Variables):
   - `PAGES_PROJECT_NAME` = tên project Pages (tạo lần đầu bằng
     `npx wrangler pages deploy frontend` hoặc trên Dashboard)
   - `WORKER_URL` = URL worker sau deploy lần đầu, ví dụ
     `https://sop-api.<subdomain>.workers.dev`
8. **Push code lên nhánh `demo`** → workflow "Deploy demo" tự chạy:
   áp dụng migration D1 → deploy Worker → deploy Pages → smoke test `/health`.
9. **Kiểm chứng**: mở URL Pages thấy trang "đang xây dựng";
   `curl <WORKER_URL>/health` trả `{"status":"ok",...}` với HTTP 200.

Xong 9 bước trên, Task 01 mới được coi là **verified** (theo `docs/PROGRESS.md`).

## Lưu ý bảo mật

- `wrangler.toml` chỉ chứa tên binding và cấu hình không bí mật.
- `database_id`, API token, Account ID **không** nằm trong code — cấp qua
  Cloudflare/GitHub environment theo các bước trên.
- `.dev.vars`, `.env`, `.wrangler/` đã có trong `.gitignore`.
