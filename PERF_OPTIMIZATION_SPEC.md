# PERF_OPTIMIZATION_SPEC

> Trạng thái: KẾ HOẠCH (chưa implement)
> Ngày đo baseline: 2026-11-05, `next start` local (Node 22), Supabase Cloud từ VN.
> Nguyên tắc: không đổi hành vi nghiệp vụ; mỗi PR một nhóm thay đổi; có số đo trước/sau.

## 1. Mục tiêu

| Chỉ số | Hiện tại (đo) | Mục tiêu |
|---|---|---|
| API p95 (local, warm) | 567–1083 ms | ≤ 250 ms |
| Số query DB / request GET | 1–7 | ≤ 2 |
| Số round trip browser→API / trang | 3–7 | 1–2 |
| Payload lớn nhất | 84.9 KB (`/api/audit`) | ≤ 50 KB (có phân trang) |
| Trang sẵn sàng dữ liệu (calendar/students) | ~1.1 s | ≤ 400 ms local, ≤ 1 s trên 4G |

Frontend bundle **không** phải nút cổ chai: First Load JS 104–117 kB (shared 87.2 kB), SPA nav 380 ms. Không tối ưu bundle ở phase đầu.

## 2. Baseline đo được

Đo bằng `curl -w` trên server `next start` + browser thật (Chromium, PerformanceResourceTiming), tài khoản admin, 2026-11-05.

| Endpoint | Query/req (theo code) | Đo được | Payload |
|---|---|---|---|
| `GET /api/students?page=1&limit=20` | 4 + N write auto-heal | 1083 ms | 4.4 KB |
| `GET /api/teachers` | 2 + N write auto-heal | 683–822 ms | 1.5 KB |
| `GET /api/schedule?date=…` | 3 (luôn đọc 699 slot) | 431–619 ms | 2.7 KB |
| `GET /api/classes` | 2 | 253–366 ms | 1.7 KB |
| `GET /api/users` | 1 | 233–254 ms | 3.2 KB |
| `GET /api/finance` | 1 (full table) | 137–252 ms | 5.2 KB |
| `GET /api/notifications` | 1, **gọi 2 lần/trang** | 245 + 152 ms | 0.3 KB |
| `GET /api/audit` | 1, **không phân trang, 260 dòng** | 15 ms *(cache Next Data Cache)* | 84.9 KB |
| `GET /api/attendance?date=…` | 7 (1 + 5 lớp + slots) | 1.0–1.7 s *(probe trước đó)* | — |

Suy ra: 1 round trip PostgREST ≈ **150–350 ms** khi ấm. Vì vậy mọi endpoint nhiều query gần như cộng tuyến tính.

Payload `2.7 KB` của `/api/schedule?date=` không phản ánh chi phí: server vẫn đọc toàn bộ 699 slot (≈190 KB) rồi mới lọc theo ngày trong JS.

## 3. Chẩn đoán (6 nguyên nhân, xếp theo tác động)

1. **Lọc/phân trang ở tầng JS thay vì SQL.** `getAll*` (allUsers/students/classes/slots/invoices/auditLogs) rồi `filter/slice` trong route. Index đã có sẵn (`idx_schedule_slots_date`, `idx_attendance_date`, `idx_audit_logs_timestamp`…) nhưng không được dùng.
2. **Nhiều query tuần tự cho một màn hình.** `/api/attendance?date` = 1 + N(lớp) + slots; `/api/students` = users + students + classes(+class_students).
3. **Write-on-read trong GET.** `/api/students` và `/api/teachers` tự "chữa" dữ liệu (INSERT student/teacher + audit log) mỗi lần GET: không idempotent, phá cache, chặn read-only/bulkhead, tạo subrequest ngoài dự kiến.
4. **Không có tầng cache.** Không SWR/React Query ở client, không KV/Cache API ở edge cho dữ liệu tham chiếu (classes, teachers, shifts, packages). Mỗi lần điều hướng = đọc lại DB.
5. **`select('*')` + không giới hạn cột.** `/api/audit` trả 84.9 KB; slots trả 699 dòng.
6. **Chi phí biên của trang webhook/tuition.** `reconcileInvoices` chạy ở client webhook, không idempotent (đã ghi nhận ở audit bảo mật trước).

Vấn đề **kiến trúc Cloudflare** (không phải perf nhưng cùng chủ đề):
- `bulk-generate`: vòng lặp `days × classes`, mỗi cặp gọi `getAllScheduleSlots()` (dòng 150) + `ConflictEngine` gọi lại toàn bộ slot (dòng 44). 90 ngày × 5 lớp ≈ 128 cặp × 2 lần đọc × 699 dòng ≈ 179k dòng, ~256 subrequest tuần tự → vượt giới hạn subrequest (50/1000) và CPU 30 s của Worker, dù local chạy được.
- `next start` cache `GET` theo `revalidate: 1 year` (quan sát: `/api/audit` trả snapshot cũ sau khi ghi). Trên OpenNext mặc định cache là `dummy` nên production hiện không cache — nhưng nếu deploy Node/self-host thì đây là **bug đúng/sai**, không chỉ perf. Phải khai báo tường minh `no-store` hoặc tag.

## 4. Phase 1 — P0: dùng SQL + gộp query (1–2 ngày)

Mục tiêu: mỗi endpoint GET ≤ 2 round trip, ≤ 250 ms local.

| # | Việc | Cách làm | Kỳ vọng |
|---|---|---|---|
| 1.1 | `/api/schedule` | Đẩy `date`/`classId`/`teacherId` xuống `.eq()`; `select` cột cần dùng; bỏ `getAllClasses` khi chỉ cần 1 ngày | 3→1 query; 619→~200 ms; payload server-side 190 KB→~5 KB |
| 1.2 | `/api/attendance?date` | 1 query `attendance_records?date=eq` (index có) + 1 query slots của ngày; bỏ vòng lặp theo lớp | 7→2 query; 1.7 s→~400 ms |
| 1.3 | `/api/students` | Bỏ auto-heal khỏi GET (chuyển sang job/POST `/api/sync`); 1 query `students` + embed `class_students`; search/pagination bằng `.ilike`/`.range()` | 4+N→1 query; 1083→~300 ms |
| 1.4 | `/api/teachers` | Bỏ auto-heal; 1 query | 822→~250 ms; hết ghi ẩn |
| 1.5 | `/api/classes` | Embed `classes?select=*,class_students(student_id)` | 2→1 query |
| 1.6 | `/api/audit` | `limit`/cursor (`before=timestamp`), `select` cột | 84.9 KB→~12 KB |
| 1.7 | Notifications | Sửa `useEffect` deps `[currentUser]`→`[currentUser?.id]`; 1 fetch/lần mount | bỏ 1 request + 1 poll timer mỗi 15 s |

**Acceptance Phase 1**
- `curl` lại 7 endpoint trên: p95 ≤ 250 ms (warm), query/request ≤ 2.
- Không còn INSERT/UPDATE trong GET (grep `createStudent|createTeacher` trong route GET).
- Trang `/admin/calendar` và `/admin/students`: request chậm nhất ≤ 350 ms.

**Rủi ro**: bỏ auto-heal làm lộ dữ liệu lệch (user có role STUDENT nhưng thiếu bản ghi `students`). Xử lý bằng script one-off `npm run db:reconcile` + log, chạy trước khi deploy Phase 1.

## 5. Phase 2 — P1: giảm round trip & cache (2–3 ngày)

| # | Việc | Chi tiết | Kỳ vọng |
|---|---|---|---|
| 2.1 | BFF/bootstrap endpoint | `GET /api/bootstrap?scope=admin.calendar` trả `{classes, teachers, slots, studentsLite}` trong **một** response (server chạy `Promise.all`) | 4 request → 1; trang calendar ~1.1 s → ~350 ms |
| 2.2 | Cache dữ liệu tham chiếu | Cloudflare `caches.default`/KV cho `classes/teachers/shifts/packages` TTL 30–60 s + version key tăng khi ghi; client dùng SWR (stale-while-revalidate 30 s) | 250 ms → 5–20 ms khi hit |
| 2.3 | Vị trí DB & Worker | Xác nhận region Supabase trong dashboard; nếu không phải `ap-southeast-1` → tạo project đúng region (hoặc read replica). Bật `[placement] mode = "smart"` trong `wrangler.toml` | 150–350 ms/query → 20–80 ms (kỳ vọng; đo lại) |
| 2.4 | `select` hẹp | Thay `select('*')` bằng danh sách cột ở các `getAll*` nóng | −40–80% payload/parse |
| 2.5 | Pagination keyset | students/invoices/audit: `?after=<id>&limit=50`, trả `nextCursor`; bỏ `slice()` | payload ổn định |
| 2.6 | EXPLAIN | `EXPLAIN (ANALYZE, BUFFERS)` cho 6 query nóng sau khi đổi; thêm composite index nếu cần (`schedule_slots(class_id,date)`, `attendance_records(student_id,date)`) | loại bỏ seq scan còn lại |

Lưu ý topology: với Workers, `browser → Worker` và `Worker → PostgREST` **nối tiếp**. Smart Placement chỉ đổi chỗ độ trễ, không giảm tổng; giảm thật đến từ (a) ít round trip hơn, (b) cache ở edge, (c) DB gần người dùng. Vì vậy 2.1/2.2 trước 2.3.

## 6. Phase 3 — P1: đường ghi (bulk & webhook)

- `BulkScheduleService`: đọc slots **một lần** trước vòng lặp; dựng map `classId|date`; tính toàn bộ slot mới trong bộ nhớ; `upsert` theo chunk 100; sinh ID bằng sequence/RPC thay vì quét max `SCHnnn`.
- `ConflictEngine`: nhận `slots` đã có qua tham số (không tự fetch); kiểm tra theo index trong bộ nhớ.
- `payment/webhook`: chuyển đối soát vào một Postgres function (transaction + `ON CONFLICT` theo `transactionId`) → 1 round trip, idempotent.
- Trần an toàn: chặn `days × classes > 2000` với lỗi 422 rõ ràng; log `subrequest count`.

**Acceptance**: bulk 30 ngày × 5 lớp chạy < 20 s trong Worker, < 100 subrequest, không lỗi 1102/1101.

## 7. Phase 4 — P2: trải nghiệm (sau khi data path xong)

- `loading.tsx`/skeleton cho 16 trang; optimistic update cho điểm danh.
- Polling 15 s → SSE hoặc 60 s + `ETag`/`If-None-Match` (mỗi tab hiện tốn 4 req/phút).
- Chuyển các trang chỉ-đọc (audit, guides, dashboard) sang Server Component đọc repo trực tiếp, bỏ 1 hop HTTP.
- `dynamic import` cho modal nặng (students/tuition) nếu bundle > 150 kB sau Phase 1–2.

## 8. Đo lường & gate

- Middleware `withTiming(handler)` log `{route, ms, queries}` ra Cloudflare Logs; đặt `Server-Timing` header để đo từ browser.
- Trước merge mỗi PR: chạy `scripts/perf-probe.sh` (curl 7 endpoint × 20 lần, in p50/p95) và dán số vào PR.
- Budget trong CI: fail nếu p95 vượt ngưỡng của Phase tương ứng.

## 9. Không làm (anti-goals)

- Không rewrite framework, không đổi sang D1/Drizzle trong đợt này.
- Không tối ưu bundle/JS trước Phase 4 (bundle hiện đã ổn).
- Không cache HTML của trang có auth.
- Không "vá" bằng `revalidate` dài cho endpoint mutable.

## 10. Thứ tự thực hiện

1. PR-1: Phase 1.1–1.5 (SQL + bỏ write-on-read) — tác động lớn nhất, rủi ro thấp.
2. PR-2: Phase 1.6–1.7 + probe script/CI budget.
3. PR-3: Phase 2.1–2.2 (bootstrap + cache).
4. PR-4: Phase 2.3–2.6 (region/placement/index).
5. PR-5: Phase 3 (bulk + webhook) — bắt buộc trước khi bật bulk-generate trên production.
