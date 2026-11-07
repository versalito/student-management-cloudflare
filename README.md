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
- **Khoá API**: từ 2026-11-07 project chỉ dùng khoá kiểu mới — server giữ `sb_secret_*` (secret của Worker), client-side nhận `sb_publishable_*` (công khai, vẫn bị RLS chặn). Legacy JWT `anon`/`service_role` **đã tắt**, nên mọi JWT từng lộ đều vô hiệu.
  - Kiểm tra trạng thái: `node scripts/retire-legacy-keys.mjs --dry-run`
  - Khẩn cấp (app chưa kịp đổi khoá): `--re-enable`
- **Cache-Control**: HTML và API `private, no-store`; `/_next/static/*` immutable 1 năm (xem `public/_headers`).

## Trạng thái production (kiểm tra 2026-11-07)

| Hạng mục | Kết quả |
|---|---|
| Cookie phiên | `smc_session` HttpOnly/Secure/SameSite=Lax, TTL 8 h ✅ |
| Chặn trang theo role | `/admin`, `/teacher`, `/student` → 307 về `/login?next=…` ✅ |
| API thiếu phiên | 10/10 endpoint nóng trả 401 ✅ |
| RBAC | phiên học sinh gọi `GET/POST /api/users`, `PUT /api/teachers`, `POST /api/admin/reconcile` → 403 ✅ |
| Đọc chéo hồ sơ | học sinh đọc hồ sơ mình 200, hồ sơ khác 403 ✅ |
| Đổi mật khẩu người khác | chỉ tự đổi được của mình; nhắm `ADMIN001` hay học viên khác → 403 ✅ |
| Lộ SĐT/lương giáo viên | phiên học sinh nhận `{id,name,specialty,bio}`, không có `phone`/`hourlyRate`/`ratePerSession` ✅ |
| Lịch/ca của người khác | `?studentId=<khác>`, `?all=true` → 403 ✅ |
| Rate limit login | sai mật khẩu lần 5 trở đi → 429 ✅. Đo lại 2026-11-07: 4 lần sai → 401, lần 5/6/7 → **429**, và đăng nhập **đúng** trong cửa sổ khoá cũng bị 429 (đúng thiết kế, khoá 5 phút theo cặp IP+username). Bộ đếm nằm trong KV `RATE_LIMIT_KV` nên dùng chung giữa các isolate, không phải Map trong bộ nhớ. |
| Lọc PostgREST qua `?id=` | `GET /api/users?id=` với `nope,role.eq.ADMIN`, `%`, `a)b`, `nope" %` đều trả **200 `{"user":null}`**; tra cứu thật (`ADMIN001`, `26007`, `gv_nguyen-thi-huong`) vẫn đúng. Trước bản vá 2026-11-07 hai chuỗi đầu trả **500** vì `maybeSingle()` ném lỗi khi `or(ilike)` khớp nhiều dòng, và input được ghép thẳng vào cú pháp `or(...)` ✅ |
| Thu hồi phiên khi khoá tài khoản | khoá `26008` rồi dùng lại cookie cũ → `/api/students`, `/api/schedule` đều **401** (trước bản vá 2026-11-07 vẫn 200 trong suốt 8 h còn hạn của token) ✅ |
| Cache asset | `/_next/static/*` → `public, max-age=31536000, immutable` ✅ |
| Cache HTML | `private, no-store` ✅ |
| RLS | `anon` key đọc `users/students/tuition_invoices/audit_logs` → 401 `permission denied` ✅ |
| Mật khẩu tài khoản | Đã crack và **đăng nhập thật thành công** trên production: ADMIN `nguyễn văn tài` = `password123`, TEACHER `gv_nguyen-thi-huong` + STUDENT `26007` = `123456` (còn `đàm mỹ thuyết` = `password123`, học viên `26008` = `123456`). Cơ chế `AuthService.needsRehash` đã nâng hash các tài khoản này sang PBKDF2 ở lần login kế tiếp, nhưng **mật khẩu vẫn yếu** — đăng nhập `nguyễn văn tài`/`password123` vẫn trả 200 với quyền ADMIN ❌ |
| Khoá `service_role` | **ĐÃ XỬ LÝ 2026-11-07.** Khoá cũ lộ trong git history (`bd065ac` xoá khỏi `wrangler.toml` nhưng blob còn) và trong `.env.local` của repo công khai `versalito/student-management`. Đã chuyển Worker sang khoá mới `sb_secret_*` (`wrangler secret put`), deploy lại, verify 6 endpoint + 3 vai trò đều 200, rồi **tắt legacy keys** (`PUT /v1/projects/{ref}/api-keys/legacy?enabled=false`). Khoá cũ giờ trả **401 "Legacy API keys are disabled"** trên REST ghi, Auth và Realtime. `.env.local` đã bị xoá khỏi HEAD của repo thứ hai. |

Mục ❌ cần xử lý phía vận hành:

1. ~~Rotate `SUPABASE_SERVICE_ROLE_KEY`~~ — **đã làm 2026-11-07**, xem dòng "Khoá service_role" ở bảng trên. Legacy keys đã tắt nên mọi JWT cũ (kể cả anon key từng công bố trong `wrangler.toml`) đều vô hiệu.
2. Đổi mật khẩu các tài khoản có mật khẩu đoán được — **hash đã tự nâng cấp PBKDF2 nhưng mật khẩu không đổi**, nên phải đổi bằng tay: ADMIN `nguyễn văn tài` (`password123`), TEACHER `đàm mỹ thuyết` (`password123`), `gv_nguyen-thi-huong` (`123456`), STUDENT `26007`, `26008` (`123456`). Ưu tiên tài khoản ADMIN vì mật khẩu của nó đã bị crack từ hash công khai.
3. Xoá tài khoản test còn sót trên production: `st_pwd_01` / `ST_PWD_TEST_01` (đăng nhập được bằng `matkhau_cu`), `USR_DROPOUT_TEST`.

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

### Trạng thái schema production (kiểm tra 2026-11-07)

- **Bảng `student_session_bookings`** — **đã chạy trên production 2026-11-07** qua Management API (`POST /v1/projects/{ref}/database/query`). Schema đã đối chiếu: 6 cột, RLS bật + force, 5 index. Nguồn: `supabase/update_2026-11-06-student-session-bookings.sql` (= `setup.sql`). Kiểm chứng end-to-end: đăng nhập `26007` → `POST /api/student/bookings` trả **201**, `DELETE` trả **200** với status `Đã hủy`, `node scripts/verify-rls.mjs` → **19 bảng, 0 rò rỉ, 0 lỗi**. Nếu bảng thiếu trên môi trường khác, chỉ tính năng buổi lẻ tắt: `getSessionBookings` coi `PGRST205` là "chưa có booking nào" nên `/api/schedule?studentId=…`, `/api/attendance`, `/api/student/slots`, `/api/student/bookings` vẫn 200; đặt/huỷ buổi trả lỗi có chỉ dẫn chạy migration.
- **Hàm `max_schedule_slot_number()`** — code **đã bỏ phụ thuộc** (dùng truy vấn REST, xem `getMaxScheduleSlotNumber`), nên không còn là điều kiện deploy. Hàm vẫn giữ trong `setup.sql` cho DB mới.
- Cột `classes.code` đã bị xoá khỏi DB từ `update_2026-10-07.sql`; code **không** còn đọc/ghi cột này.

## Kiểm tra

```bash
npm test          # node:test trên LocalRepository → 209 test
npx tsc --noEmit  # typecheck
npm run lint      # eslint, --max-warnings=347 (nợ hiện tại, không tăng)
npm run build     # build Next.js
```

Đo hồi quy hiệu năng (bắt buộc server đang chạy và có tài khoản admin):

```bash
./scripts/perf-probe.sh http://127.0.0.1:3000 20 800
```

Script đăng nhập lấy cookie, warm-up rồi đo p50/p95 từng endpoint, exit 1 nếu p95 vượt ngưỡng ms truyền vào.

Đo trên worker production 2026-11-07 sau bản vá đọc lại `isActive` (p50 / p95, giây): students 0.37/1.26, teachers 0.23/0.26, classes 0.23/0.26, schedule 0.34/0.58, bootstrap 0.35/0.59, audit 0.31/0.38. Chi phí biên của truy vấn `users` bổ sung ≈ **+9 ms** (xen kẽ 30 vòng: `/api/auth/me` không query DB p50 134 ms vs `/api/shifts` 2 query p50 143 ms).

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
