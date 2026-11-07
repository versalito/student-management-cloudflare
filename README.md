# Student Management (Cloudflare + Supabase)

Hệ thống quản lý trung tâm dạy học: điểm danh, lớp học, lịch học, học sinh, giáo viên và học phí. Chạy trên Cloudflare Workers (Next.js qua OpenNext), dữ liệu trên Supabase Postgres.

- Production: https://student-management-cloudflare.design-toilaning.workers.dev
- Repo: https://github.com/versalito/student-management-cloudflare

## Có gì trong này

Ba cổng giao diện riêng, mỗi cổng chặn bằng middleware theo role trong cookie phiên:

- **Admin** (`/admin`): toàn trường — tài khoản, học sinh, giáo viên, lớp, lịch, điểm danh, yêu cầu, học phí, chấm công, audit.
- **Giáo viên** (`/teacher`): lớp đang dạy, điểm danh lớp mình, chấm công theo ca, lịch dạy.
- **Học sinh** (`/student`): điểm danh nhanh, lịch học, lớp, đặt buổi lẻ, học phí, yêu cầu.

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

Hai secret cuối không đặt trong `wrangler.toml`; production nạp bằng `wrangler secret put <TÊN>`, local bằng `.dev.vars`.

## Bảo mật

- **Phiên**: cookie `smc_session` = `payload.base64url.sig`, ký HMAC-SHA-256 bằng WebCrypto trên `SESSION_SECRET`; `HttpOnly`, `SameSite=Lax`, `Secure` khi production, TTL 8 giờ.
- **Phân quyền**: mỗi API route gọi `authenticate(request, roles)`; `src/middleware.ts` chặn `/admin`, `/teacher`, `/student` trước khi render.
- **Rate limit login**: đếm theo username+IP trong KV `RATE_LIMIT_KV` (fallback bộ nhớ isolate nếu thiếu binding).
- **Thu học phí**: không có webhook tự động và không có nút báo chuyển khoản. Học sinh chỉ xem mã VietQR + nội dung chuyển khoản, tự huỷ được hoá đơn chưa thanh toán của mình (`DELETE /api/finance?invoiceId=`). Quản trị đối soát sao kê rồi xác nhận qua `UPDATE_STATUS` (cho phép thu một phần bằng `paidAmount`). Chỉ ADMIN được ghi sổ.
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
| Cache asset | `/_next/static/*` → `public, max-age=31536000, immutable` ✅ |
| Cache HTML | `private, no-store` ✅ |
| RLS | `anon` key đọc `users/students/tuition_invoices/audit_logs` → 401 `permission denied` ✅ |
| Mật khẩu tài khoản | **13/17 user còn hash SHA-256 cũ (không salt)**; 12 tài khoản dùng mật khẩu đoán được, gồm 1 ADMIN `password123` ❌ |

Mục ❌ cần xử lý phía vận hành: đổi mật khẩu các tài khoản còn dùng `123456` / `password123`. Hash cũ chỉ được nâng cấp tự động sang PBKDF2 ở lần đăng nhập kế tiếp (`AuthService.needsRehash`), nhưng mật khẩu yếu thì phải đổi bằng tay.

## Cơ sở dữ liệu

- `supabase/setup.sql` — dựng database từ đầu (bảng, ràng buộc, index, trigger đồng bộ users/teachers/students, RLS, dữ liệu nền).
- `supabase/rls_lockdown.sql` — khoá quyền `anon`/`authenticated` trên toàn bộ bảng.
- `supabase/migration_*.sql`, `supabase/update_*.sql` — bản vá tăng dần, chạy một lần trong SQL Editor.

Thứ tự bắt buộc cho một database mới: `setup.sql` → `rls_lockdown.sql` → các `migration_*.sql` / `update_*.sql` theo ngày.

Tất cả script đều idempotent: chạy lại không mất dữ liệu.

### Lệch giữa `setup.sql` và database production (kiểm tra 2026-11-07)

`setup.sql` **không** phải bản mô tả đầy đủ của DB đang chạy: nó chỉ dựng các bảng đầu tiên, còn 4 bảng và nhiều cột do các script `update_*.sql` thêm sau đó không được gộp ngược vào. Đối chiếu `information_schema` thật với `setup.sql`:

| Thiếu trong `setup.sql` | Nguồn thật |
|---|---|
| Bảng `class_sections`, `class_section_students`, `app_settings` | `update_2026-10-07.sql` |
| Bảng `student_slot_swaps` | `update_2026-10-09-student-schedule-days.sql` |
| Cột `schedule_slots.section_id`, `tuition_invoices.package_name/package_price/override_*`, `classes.code` (đã bị bỏ) | `update_2026-10-07.sql` |
| Cột `attendance_records.checkin_time/is_makeup/created_at`, `notifications.updated_at`, `teacher_payroll_periods.total_salary/deductions`, `teachers.rate_per_session` | các `update_*.sql` khác |

Hệ quả: dựng DB mới bằng `setup.sql` rồi deploy code hiện tại sẽ lỗi ngay ở `/api/classes`, `/api/schedule`, `/api/finance`, `/api/student/*`. Phải chạy **đủ** các `update_*.sql` theo ngày.

### Production còn thiếu (cần chạy trong SQL Editor)

- **Bảng `student_session_bookings`** — migration đã có sẵn: `supabase/update_2026-11-06-student-session-bookings.sql`. Thiếu nó thì `/api/schedule?studentId=…`, `/api/attendance`, `/api/attendance/current-session` trả 500 (`Could not find the table`).
- **Hàm `max_schedule_slot_number()`** — code **đã bỏ phụ thuộc** (dùng truy vấn REST, xem `getMaxScheduleSlotNumber`), nên không còn là điều kiện deploy. Hàm vẫn giữ trong `setup.sql` cho DB mới.
- Cột `classes.code` đã bị xoá khỏi DB từ `update_2026-10-07.sql`; code **không** còn đọc/ghi cột này.

## Kiểm tra

```bash
npm test          # node:test trên LocalRepository → 175 test
npx tsc --noEmit  # typecheck
npm run lint      # eslint, --max-warnings=347 (nợ hiện tại, không tăng)
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
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Cấu hình Worker ở `wrangler.toml`: `[observability] enabled = true` để log hiện trong Dashboard, `[placement] mode = "smart"` để Worker đặt gần Supabase.

## Cấu trúc thư mục

```
src/app/            route theo cổng (admin / teacher / student / api)
src/components/     UI dùng chung và theo domain
src/lib/            auth (session), cache (referenceCache), supabase
src/middleware.ts   chặn route theo role
src/services/       logic nghiệp vụ
src/repositories/   truy cập dữ liệu (local / supabase)
src/types/          kiểu dữ liệu
supabase/           schema, migrations
scripts/            perf-probe, verify-rls, reconcile-profiles, audit-slot-weekdays
tests/              test (node:test)
```

Đặc tả kiến trúc chi tiết: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).
