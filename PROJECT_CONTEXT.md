# PROJECT_CONTEXT.md — Student Management (Cloudflare)

> Bản đồ dự án. **Đọc file này TRƯỚC khi sửa bất cứ thứ gì.**
> Nguyên tắc làm việc: chỉ load đúng file liên quan tới thay đổi, KHÔNG quét toàn bộ repo.

---

## 1. Định danh dự án

| Mục | Giá trị |
|---|---|
| **Đường dẫn (máy dev)** | `/Users/toilaning/projects/student-management-cloudflare` |
| **Tên package** | `student-management-local` |
| **Loại** | Next.js 15.5 (App Router) + React 19 + TypeScript + TailwindCSS |
| **Deploy** | Cloudflare Workers via OpenNext (`@opennextjs/cloudflare` 1.20) |
| **DB** | Supabase Cloud PostgreSQL (project `mvcwdqzmvgjdwqnnxaxb`) |
| **Repo** | https://github.com/versalito/student-management-cloudflare |
| **Production** | https://student-management-cloudflare.design-toilaning.workers.dev |
| **Số file src** | 136 file `.ts`/`.tsx` |

### Dự án KHÁC (KHÔNG nhầm lẫn)
- `/Users/toilaning/projects/student-management` — bản **cũ (local-only, trước migrate)**. Không dùng.
- `/Users/toilaning/student-management` — bản **scaffold sơ khai**. Không dùng.
- **Chỉ làm việc trên `student-management-cloudflare`.**

---

## 2. Stack & Scripts

```
next 15.5.29 · react 19 · supabase-js ^2.116 · tailwind 3.4 · lucide-react
devDeps: @opennextjs/cloudflare ^1.20.16 · wrangler ^4.148 · tsx · typescript 5.6 · eslint 9
```

| Script | Lệnh |
|---|---|
| Dev | `npm run dev` |
| Build | `npm run build` |
| Build worker | `npm run build:cf` (OpenNext) |
| Test | `npm test` (`DATA_SOURCE=local node --import tsx --test tests/**/*.test.ts`) |
| Lint | `npm run lint` (`eslint . --max-warnings=347`) |
| Deploy CF | `npm run deploy` (build opennext + wrangler deploy) |
| Preview CF | `npm run preview` (workerd thật, có `caches.default` + KV) |
| Đo hiệu năng | `./scripts/perf-probe.sh <base_url> [rounds] [p95_budget_ms]` |
| Kiểm RLS | `node scripts/verify-rls.mjs` |
| Đối soát hồ sơ | `npm run db:reconcile` |
| Audit thứ trong tuần của slot | `npm run db:audit-slots` |

---

## 3. Kiến trúc thư mục (chỉ mục, KHÔNG cần đọc hết)

```
src/
├── app/                    # Next.js App Router
│   ├── admin/              # 13 trang: dashboard, students, teachers, classes,
│   │                       #   attendance(+analytics), calendar, tuition, finance,
│   │                       #   requests, accounts, audit, guides
│   ├── teacher/            # 6 trang: dashboard, classes, schedule, attendance, requests, settings
│   ├── student/            # 7 trang: dashboard, classes, schedule, attendance,
│   │                       #   tuition, requests, settings
│   ├── login/              # đăng nhập
│   └── api/                # 35 route (xem mục 5)
├── components/             # UI theo domain: admin, teacher, student, attendance,
│   │                       #   tuition, common
├── context/AppContext.tsx  # state toàn cục
├── lib/
│   ├── auth/session.ts     # ký/đọc cookie phiên HMAC (WebCrypto), authenticate()
│   ├── cache/referenceCache.ts # cache tham chiếu ở edge + version key qua KV
│   └── supabase.ts         # Supabase client (service_role)
├── middleware.ts           # chặn /admin, /teacher, /student theo role trong cookie
├── repositories/           # Data-access layer
│   ├── IRepository.ts          # interface chuẩn (hợp đồng dữ liệu)
│   ├── SupabaseRepository.ts   # impl production (Supabase)
│   ├── LocalRepository.ts      # impl in-memory (test offline)
│   └── index.ts                # chọn impl theo DATA_SOURCE
├── services/               # Business logic
│   ├── AuthService · StudentService · ConflictEngine · BulkScheduleService
│   ├── ShiftService · TuitionPayrollService · LedgerService
│   ├── MonthlyPackageService · AuditService · ScheduleViewService · ProfileReconcileService
│   ├── SlotTimeService      # giờ thật của buổi học: ca học → slot → lớp (một nguồn duy nhất)
│   └── StudentSessionService # cửa sổ điểm danh + ca hiện tại/kế tiếp (server-side)
├── types/                  # type domain: student, teacher, classroom, schedule,
│                           #   attendance, finance, package, ledger, bank, auth,
│                           #   notification, audit, monthlyPackage, session
├── hooks/
│   └── useStudentCheckin.ts    # điểm danh HS dùng chung: TKB + dashboard
└── utils/
    └── rosterDiff.ts           # ghi danh lớp: chỉ áp phần chênh lệch

tests/                      # 31 test files (node:test) + e2e-db-audit.ts
supabase/setup.sql          # script dựng database từ đầu (idempotent)
supabase/rls_lockdown.sql   # khoá anon/authenticated trên toàn bộ bảng
supabase/migration_*.sql    # bản vá tăng dần (perf index)
supabase/update_*.sql       # bản vá theo ngày
scripts/                    # perf-probe.sh, verify-rls.mjs, reconcile-profiles.ts, audit-slot-weekdays.ts
.github/workflows/ci.yml    # 2 job: verify + perf
```

---

## 4. Kiến trúc dữ liệu (Repository Pattern)

- **Có 2 implementation của `IRepository`**, chọn qua env `DATA_SOURCE`:
  - `supabase` → `SupabaseRepository` (production, Supabase Cloud)
  - `local` → `LocalRepository` (in-memory, test/offline)
- **Hợp đồng chung bắt buộc**: mọi method ghi dữ liệu tham chiếu (teacher / class / class section / time shift / session package / ghi danh) phải gọi `bumpReferenceVersion(REFERENCE_CACHE_SCOPE)` trong **cả hai** repo, nếu không cache edge sẽ trả dữ liệu cũ tới 30 s.
- **Thêm/sửa field dữ liệu** thường phải sync 3 nơi: `types/`, `IRepository.ts`, `SupabaseRepository.ts` (+ `LocalRepository.ts` để test chạy được).
- Có **2-way sync** user↔student↔teacher ở DB level (Postgres trigger).

---

## 5. API Routes (src/app/api/) — 35 route

```
admin/reconcile/            POST  đối soát hồ sơ students/teachers thiếu
attendance/                 GET/POST điểm danh
attendance/analytics/       GET
attendance/current-session/ GET  ca đang diễn ra
audit/                      GET  audit log (phân trang)
auth/login/                 POST đăng nhập, phát cookie phiên + rate limit
auth/me/                    GET  user hiện tại (nguồn quyền duy nhất của client)
bootstrap/                  GET  gộp slots+classes+teachers+shifts+students trong 1 request
classes/                    GET/POST/PUT/DELETE
classes/enroll/             POST
classes/sections/           GET/POST/PUT/DELETE
finance/                    GET/POST học phí
finance/expenses/           GET/POST
finance/ledger/             GET
notifications/              GET/POST
packages/                   GET/POST/PUT/DELETE gói buổi
payroll/                    GET/POST chấm công & lương
payment/webhook/            POST trả 410 Gone (đã bỏ, giữ để tích hợp cũ biết)
requests/                   GET/POST yêu cầu
schedule/                   GET lịch
schedule/bulk-daily-action/ POST
schedule/bulk-generate/     POST
schedule/bulk-update-future/ POST
settings/bank/              GET/PUT cấu hình VietQR
shifts/                     GET/POST/PUT/DELETE
students/                   GET (phân trang)/POST
student/bookings/           GET/POST/DELETE buổi lẻ học sinh tự đặt
student/slots/              GET  các buổi lẻ còn đăng ký được (kèm cờ trùng giờ)
student/session-state/      GET  ca hiện tại/kế tiếp + canCheckIn của 1 HS
students/[id]/              GET/PUT/DELETE
student/swap/               POST đổi ca
teacher-checkin/            POST
teachers/                   GET (cache 30 s)/POST/PUT/DELETE
users/                      GET/POST/PUT/DELETE
users/password/             PUT
```

Mọi route gọi `authenticate(request, roles)` trước khi chạm dữ liệu; mọi route ghi đều ghi audit log với actor lấy từ phiên (không hardcode).

---

## 6. Miền nghiệp vụ chính

1. **Phân quyền**: 3 role — `admin` / `teacher` / `student`, mỗi role có portal riêng, chặn ở middleware + ở từng route.
2. **Lớp học & lịch**: class, class_sections (1 lớp nhiều ca), schedule slot, shift, bulk schedule. Học sinh đặt **buổi lẻ** (`student_session_bookings`) — buổi đặt lẻ vào thẳng TKB với badge "Lịch lẻ", huỷ được trước giờ bắt đầu.
3. **Điểm danh (attendance)**: session theo giờ thực, timezone `Asia/Saigon`, analytics.
4. **Học phí & lương (finance)**: tuition invoice, payroll/`sessionRate`, ledger, expense, mã VietQR để học sinh tự chuyển khoản (quản trị đối soát sao kê rồi xác nhận thủ công, **không có webhook/báo chuyển khoản tự động**), monthly package, monthly rollover.
5. **Conflict Engine**: phát hiện trùng lịch real-time. **Lưu ý:** model 100% online — 1 GV có thể dạy nhiều lớp cùng lúc, KHÔNG chặn teacher-conflict.
6. **Discord**: chỉ là nơi dán link phòng học (`classes.meetingLink` thay cho Google Meet). **Không có bot**: không có thư mục `discord-bot/`, không có route `/api/discord/*`, các slash command `/dinh-huong`, `/lop-hoc`, `/vao-hoc` trong `docs/archive/DISCORD_BOT_SPEC.md` và `DISCORD_ORIENTATION_ROOM_SPEC.md` chưa từng được cài đặt.
7. **Hệ thống phụ**: notification, request, audit log, milestone/package.

---

## 7. Hiệu năng (Phase 2) — trạng thái đã đo

| Cơ chế | Chỗ code | Ghi chú |
|---|---|---|
| `GET /api/bootstrap` gộp 5 bảng | `src/app/api/bootstrap/route.ts` | Thay 4 request của trang lịch; trả trong 1 round trip |
| Cache tham chiếu 30 s ở edge | `src/lib/cache/referenceCache.ts` | `caches.default` + version key trong KV `RATE_LIMIT_KV`; header `X-Cache: HIT/MISS/BYPASS` |
| Không cache khi không có Cache API | `edgeCache()` | Node/`next start` → `BYPASS`, test không đọc cache của nhau |
| `public/_headers` | `public/_headers` | `/_next/static/*` immutable 1 năm |
| HTML/API `private, no-store` | `next.config.mjs` | Tránh CDN trả HTML của người khác |
| Probe hồi quy | `scripts/perf-probe.sh` | p50/p95 + ngưỡng ms, exit 1 khi vượt |
| CI hồi quy | `.github/workflows/ci.yml` | job `perf` chạy probe với ngưỡng 800 ms |

Đo thực tế (workerd local, `npm run preview`): `X-Cache` MISS → HIT; sau một `PUT /api/teachers` thì MISS trở lại (version key đổi), request kế tiếp HIT.

---

## 7b. Trạng thái production & nợ kỹ thuật (2026-11-06)

Đã kiểm chứng trên worker thật (không phải suy luận): chặn route theo role, 401 cho API thiếu phiên, 403 khi leo quyền, rate limit login 429 sau 5 lần sai, `/_next/static/*` immutable, HTML `no-store`, RLS chặn `anon` trên mọi bảng, khoá tài khoản thu hồi ngay phiên đang mở (401).

Nợ mở, cần xử lý phía vận hành:

| Việc | Chi tiết |
|---|---|
| Đổi mật khẩu yếu | Đã crack và **đăng nhập thật được** trên production: `nguyễn văn tài` (ADMIN) = `password123`, `gv_nguyen-thi-huong` (TEACHER) và `26007` (STUDENT) = `123456`; hai tài khoản còn hash SHA-256 cũ là `đàm mỹ thuyết` (`password123`) và `ST_DROPOUT_TEST`. Lưu ý: `needsRehash` chỉ nâng **định dạng hash** sang PBKDF2 ở lần login kế tiếp, **không đổi mật khẩu** — `nguyễn văn tài`/`password123` sau khi đã rehash vẫn đăng nhập được 200 kèm quyền ADMIN. |
| Nợ lint | `npm run lint` dùng `--max-warnings=347`; hiện còn **339** cảnh báo (đã sửa bớt trong `access-scoping.test.ts` và `api/classes/sections`). Không được nâng trần để CI xanh. |

---

## 8. Quy tắc làm việc khi sửa lắt nhắt

> Người dùng đã tuyên bố: **từ giờ chỉ sửa nhỏ, không cần load hết dự án.**

1. **Đọc PROJECT_CONTEXT.md này trước** → xác định đúng 1–3 file cần chạm.
2. Chỉ `read` đúng file liên quan + file type/interface nó phụ thuộc. Không dump cả repo.
3. Sửa xong → chạy `npm test` (hoặc test file liên quan) nếu logic chạm business rule.
4. **An toàn DB**: mọi thay đổi schema/sync phải phản ánh vào `supabase/*.sql`.
   Không sửa production DB trực tiếp khi chưa xác nhận.
5. **An toàn cache**: thêm method ghi dữ liệu tham chiếu mới → phải `bumpReferenceVersion` ở cả hai repo, nếu không sẽ trả dữ liệu cũ 30 s.

---

## 9. Bản đồ tra cứu nhanh (Task → File)

| Cần sửa… | Mở file |
|---|---|
| Trang Admin X | `src/app/admin/X/page.tsx` |
| Trang Teacher X | `src/app/teacher/X/page.tsx` |
| Trang Student X | `src/app/student/X/page.tsx` |
| API endpoint `/api/X` | `src/app/api/X/route.ts` |
| Logic nghiệp vụ X | `src/services/X.ts` |
| Truy vấn DB X | `src/repositories/SupabaseRepository.ts` (+ `IRepository.ts`) |
| Kiểu dữ liệu X | `src/types/X.ts` |
| UI component X | `src/components/<domain>/...` |
| Schema database | `supabase/setup.sql` |
| Đặc tả tính năng cũ | `docs/archive/*_SPEC.md` |
| Test tính năng X | `tests/*X*.test.ts` |
| Discord bot | **không tồn tại** — chỉ còn spec lưu trữ ở `docs/archive/DISCORD_*.md` |
| State toàn cục | `src/context/AppContext.tsx` |
| Phiên / phân quyền | `src/lib/auth/session.ts`, `src/middleware.ts` |
| Cache tham chiếu | `src/lib/cache/referenceCache.ts` |
| Thu học phí (báo chuyển khoản + đối soát) | `src/app/api/finance/route.ts`, `src/app/admin/tuition/page.tsx`, `src/app/student/tuition/page.tsx` |

---

_Cập nhật lần cuối: 2026-11-06 — bỏ webhook ngân hàng, chuyển sang báo chuyển khoản + quản trị đối soát._
