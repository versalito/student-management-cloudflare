# Student Management (Cloudflare + Supabase)

Hệ thống quản lý trung tâm dạy học: điểm danh, lớp học, lịch học, học sinh, giáo viên và học phí. Chạy trên Cloudflare Workers (Next.js qua OpenNext), dữ liệu trên Supabase Postgres.

- Production: https://student-management-cloudflare.design-toilaning.workers.dev
- Repo: https://github.com/versalito/student-management-cloudflare

## Có gì trong này

Ba cổng giao diện riêng, mỗi cổng chặn bằng middleware theo role trong cookie phiên:

- **Admin** (`/admin`): toàn trường — tài khoản, học sinh, giáo viên, lớp, lịch, điểm danh, yêu cầu, học phí, chấm công, audit.
- **Giáo viên** (`/teacher`): lớp đang dạy, điểm danh lớp mình, chấm công theo ca, lịch dạy.
- **Học sinh** (`/student`): điểm danh nhanh, lịch học, lớp, học phí, yêu cầu.

## Chạy tại máy

```bash
npm install
cp .env.example .env.local   # điền SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY nếu dùng Supabase
npm run dev                  # http://localhost:3000
```

Mặc định `DATA_SOURCE` là `local` (dữ liệu in-memory) nên chạy được ngay khi chưa cấu hình Supabase.

Biến môi trường chính:

| Biến | Ý nghĩa |
|------|---------|
| `DATA_SOURCE` | `local` (in-memory) hoặc `supabase` (production) |
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Khóa server-side, chỉ dùng ở phía server (bỏ trống thì đọc/ghi Supabase lỗi) |
| `SESSION_SECRET` | Ký cookie phiên, **≥ 32 ký tự**. Thiếu ở production → login trả 500 |
| `BANK_WEBHOOK_SECRET` | Secret chia sẻ với cổng thanh toán, **≥ 32 ký tự**. Trống → webhook từ chối toàn bộ |

Ba secret cuối không đặt trong `wrangler.toml`; production nạp bằng `wrangler secret put <TÊN>`, local bằng `.dev.vars`.

## Bảo mật

- **Phiên**: cookie `smc_session` = `payload.base64url.sig`, ký HMAC-SHA-256 bằng WebCrypto trên `SESSION_SECRET`; `HttpOnly`, `SameSite=Lax`, `Secure` khi production, TTL 8 giờ.
- **Phân quyền**: mỗi API route gọi `authenticate(request, roles)`; `src/middleware.ts` chặn `/admin`, `/teacher`, `/student` trước khi render.
- **Rate limit login**: đếm theo username+IP trong KV `RATE_LIMIT_KV` (fallback bộ nhớ isolate nếu thiếu binding).
- **Webhook ngân hàng**: bắt buộc `x-webhook-secret` / `Authorization: Bearer` / `secure-token` khớp `BANK_WEBHOOK_SECRET`; mỗi `referenceCode` ghi một lần vào `bank_transactions` nên retry của cổng thanh toán không cộng tiền lần hai.
- **RLS**: `supabase/rls_lockdown.sql` chặn `anon`/`authenticated` trên mọi bảng, backend dùng `service_role`. Kiểm chứng: `node scripts/verify-rls.mjs`.
- **Cache-Control**: HTML và API `private, no-store`; `/_next/static/*` immutable 1 năm (xem `public/_headers`).

## Trạng thái production (kiểm tra 2026-11-06)

| Hạng mục | Kết quả |
|---|---|
| Cookie phiên | `smc_session` HttpOnly/Secure/SameSite=Lax, TTL 8 h ✅ |
| Chặn trang theo role | `/admin`, `/teacher`, `/student` → 307 về `/login?next=…` ✅ |
| API thiếu phiên | 10/10 endpoint nóng trả 401 ✅ |
| RBAC | phiên học sinh gọi `GET/POST /api/users`, `PUT /api/teachers`, `POST /api/admin/reconcile` → 403 ✅ |
| Đọc chéo hồ sơ | học sinh đọc hồ sơ mình 200, hồ sơ khác 403 ✅ |
| Rate limit login | sai mật khẩu lần 5 trở đi → 429 ✅ |
| Webhook sai secret | 401 ✅ |
| Cache asset | `/_next/static/*` → `public, max-age=31536000, immutable` ✅ |
| Cache HTML | `private, no-store` ✅ |
| RLS | `anon` key đọc `users/students/tuition_invoices/audit_logs` → 401 `permission denied` ✅ |
| Bảng `bank_transactions` | **thiếu** → webhook hợp lệ 500 `BANK_LEDGER_NOT_READY` ❌ |
| Mật khẩu tài khoản | **13/17 user còn hash SHA-256 cũ (không salt)**; 12 tài khoản dùng mật khẩu đoán được, gồm 1 ADMIN `password123` ❌ |

Hai mục ❌ cần xử lý phía vận hành: chạy migration `bank_transactions`, và đổi mật khẩu các tài khoản còn dùng `123456` / `password123`. Hash cũ chỉ được nâng cấp tự động sang PBKDF2 ở lần đăng nhập kế tiếp (`AuthService.needsRehash`), nhưng mật khẩu yếu thì phải đổi bằng tay.

## Cơ sở dữ liệu

- `supabase/setup.sql` — dựng database từ đầu (bảng, ràng buộc, index, trigger đồng bộ users/teachers/students, RLS, dữ liệu nền).
- `supabase/rls_lockdown.sql` — khoá quyền `anon`/`authenticated` trên toàn bộ bảng.
- `supabase/migration_*.sql`, `supabase/update_*.sql` — bản vá tăng dần, chạy một lần trong SQL Editor.

Thứ tự bắt buộc cho một database mới: `setup.sql` → `rls_lockdown.sql` → các `migration_*.sql` / `update_*.sql` theo ngày.

**Còn thiếu trên production hiện tại:** `bank_transactions` chưa được tạo, nên webhook hợp lệ trả 500 kèm `code: BANK_LEDGER_NOT_READY`. Chạy:

```bash
# Supabase Dashboard → SQL Editor → dán nội dung file này
supabase/migration_20261106_bank_transactions.sql
```

Tất cả script đều idempotent: chạy lại không mất dữ liệu.

## Kiểm tra

```bash
npm test          # node:test trên LocalRepository → 147 test
npx tsc --noEmit  # typecheck
npm run lint      # eslint, --max-warnings=367 (nợ hiện tại, không tăng)
npm run build     # build Next.js
```

Đo hồi quy hiệu năng (bắt buộc server đang chạy và có tài khoản admin):

```bash
./scripts/perf-probe.sh http://127.0.0.1:3000 20 800
```

Script đăng nhập lấy cookie, warm-up rồi đo p50/p95 từng endpoint, exit 1 nếu p95 vượt ngưỡng ms truyền vào.

CI (`.github/workflows/ci.yml`) chạy 2 job: `verify` (tsc → test → lint → build) và `perf` (build → start → perf-probe với ngưỡng 800 ms).

## Deploy

```bash
npm run deploy    # opennextjs-cloudflare build + wrangler deploy
```

Lần đầu trên một tài khoản Cloudflare mới:

```bash
wrangler kv namespace create RATE_LIMIT_KV   # rồi dán id vào wrangler.toml
wrangler secret put SESSION_SECRET
wrangler secret put BANK_WEBHOOK_SECRET
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Cấu hình Worker ở `wrangler.toml`: `[observability] enabled = true` để log hiện trong Dashboard, `[placement] mode = "smart"` để Worker đặt gần Supabase.

## Cấu trúc thư mục

```
src/app/            route theo cổng (admin / teacher / student / api)
src/components/     UI dùng chung và theo domain
src/lib/            auth (session), cache (referenceCache), bank (webhookAuth), supabase
src/middleware.ts   chặn route theo role
src/services/       logic nghiệp vụ
src/repositories/   truy cập dữ liệu (local / supabase)
src/types/          kiểu dữ liệu
supabase/           schema, migrations
scripts/            perf-probe, verify-rls, reconcile-profiles, audit-slot-weekdays
tests/              test (node:test)
```

Đặc tả kiến trúc chi tiết: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).
