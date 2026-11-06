---
name: student-management-cloudflare
description: Playbook vận hành cho dự án Student Management Cloudflare — Cloudflare Workers (API/SSR) + Supabase (Postgres, Auth, Storage) + GitHub. Dùng khi thêm/sửa tính năng, thiết kế UI/UX, viết migration, deploy Worker, hoặc điều tra lỗi production.
---

# Student Management — Cloudflare + Supabase Playbook

Playbook riêng cho repo này. Đọc file này trước khi bắt tay vào thay đổi để giữ đúng kiến trúc, quy ước và bộ công cụ chuẩn.

## Khi nào dùng

Dùng khi:

- Thêm, sửa, hoặc gỡ một tính năng trong repo này.
- Thiết kế hoặc đánh giá UI, component, luồng người dùng.
- Thay đổi schema, viết migration, chỉnh RLS/policy Supabase.
- Deploy hoặc rollback Worker.
- Điều tra lỗi production, đọc Sentry, truy vết code bằng Graphify.

Không dùng cho: dự án khác, câu hỏi lý thuyết không đụng repo, hoặc việc chỉ liên quan hạ tầng ngoài dự án.

## Yếu tố cốt lõi (Core Stack)

| Lớp | Công nghệ | Vai trò |
|-----|-----------|---------|
| Runtime & API | Cloudflare Workers | Chạy API/SSR ở edge, không có Node fs |
| Web | Next.js (OpenNext) trên Workers | UI + route handlers (giả định hiện tại) |
| Database | Supabase Postgres | Nguồn sự thật cho dữ liệu |
| Truy cập DB | `@supabase/supabase-js` (PostgREST) hoặc Hyperdrive + `postgres.js` | Workers không mở TCP Postgres trực tiếp |
| Auth | Supabase Auth | Đăng nhập, JWT, phân quyền |
| Phân quyền dữ liệu | RLS + policy theo role | Bắt buộc bật cho mọi bảng |
| Tệp | Supabase Storage | Ảnh học sinh, tài liệu |
| Repo & CI | GitHub | PR, review, GitHub Actions |
| Observability | Sentry | Lỗi runtime, hiệu năng |
| Design intelligence | UI-UX-Pro-Max | Chọn style, palette, font, UX rules |
| Code graph | Graphify | Bản đồ code, truy vấn quan hệ |

Chi tiết cấu hình, biến môi trường, cấu trúc thư mục: xem [references/architecture.md](references/architecture.md).

## Bộ skill chuẩn — dùng đúng lúc

Ba skill dưới đây là một phần của quy trình.

### 1. UI-UX-Pro-Max — trước khi viết UI

Chạy khi bắt đầu trang/màn hình mới, chọn màu/font/style, hoặc review UX.

```bash
# Định hướng thị giác cho cả trang/màn hình
python3 ~/.agents/skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <keywords>" --design-system -p "Student Management"

# Một vấn đề cụ thể
python3 ~/.agents/skills/ui-ux-pro-max/scripts/search.py "<outcome>" --domain ux

# Theo stack đang dùng
python3 ~/.agents/skills/ui-ux-pro-max/scripts/search.py "<concern>" --stack nextjs
```

Quy tắc: tìm theo kết quả UX trước, rồi mới tìm theo stack. Với a11y, mỗi lần tìm một kết quả quan sát được.

### 2. Graphify — trước khi sửa code lạ

Nếu đã có `graphify-out/graph.json`, coi câu hỏi về codebase là truy vấn Graphify trước tiên.

```bash
graphify query "<câu hỏi về codebase>"
graphify path "AuthModule" "Database"
graphify explain "<tên node>"
```

Sau khi thêm/xóa file hoặc đổi cấu trúc lớn:

```bash
graphify . --update
```

### 3. Sentry — khi có lỗi hoặc trước khi release

```bash
export SENTRY_API="$CODEX_HOME/plugins/cache/openai-api-curated/sentry/5fd93af4/skills/sentry/scripts/sentry_api.py"
python3 "$SENTRY_API" --org <org> --project <project> list-issues --environment prod --time-range 24h --limit 20 --query "is:unresolved"
```

Không in token, không dán stack trace thô, che PII. Chi tiết: [references/observability.md](references/observability.md).

## Chức năng cốt lõi (Core Feature Registry)

Bảng dưới là nguồn sự thật cho phạm vi tính năng. Khi thêm tính năng mới, thêm một dòng và ghi rõ module + bảng liên quan.

| # | Tính năng | Vai trò dùng | Bảng chính | Trạng thái |
|---|-----------|--------------|------------|-----------|
| 1 | Tài khoản & phân quyền | admin, teacher, student, parent | profiles, roles | TODO |
| 2 | Hồ sơ học sinh | admin, teacher | students, guardians | TODO |
| 3 | Lớp học & ca học (class_sections) | admin, teacher, student | classes, class_sections, class_section_students | done |
| 4 | Giáo viên & phân công theo ca | admin, teacher | teachers, assignments, class_sections.teacher_id | done |
| 5 | Môn học & thời khóa biểu | admin, teacher | subjects, timetable | TODO |
| 6 | Điểm số & học bạ | teacher, student, parent | grades, terms | TODO |
| 7 | Điểm danh học sinh | admin, teacher | attendance, schedule_slots | done |
| 8 | Học phí & thanh toán | admin, parent | invoices, payments | TODO |
| 9 | Thông báo | admin, teacher | notifications | TODO |
| 10 | Báo cáo & dashboard | admin | view tổng hợp | TODO |
| 11 | Audit log | admin | audit_logs | done |
| 12 | Chấm công giáo viên theo ca | teacher, admin | schedule_slots (checkin_time, checkout_time, checkin_status, checkin_method, checkin_note) | done |
| 13 | Đặt buổi lẻ (không mua gói) | student | student_session_bookings, schedule_slots | done |

Đổi `TODO` thành `in-progress` hoặc `done` khi làm. Giữ đúng thứ tự ưu tiên triển khai.

## Quy trình chuẩn cho một thay đổi

1. Khảo sát: đọc code liên quan hoặc `graphify query`; xác nhận tính năng nằm trong Feature Registry.
2. UI: nếu có giao diện, chạy UI-UX-Pro-Max trước khi code.
3. Dữ liệu: nếu đụng schema, tạo migration bằng `scripts/new-migration.sh` và bật RLS.
4. Code: theo quy ước ở [references/architecture.md](references/architecture.md).
5. Kiểm thử: chạy lint + test + build; xác minh migration trên nhánh dev.
6. Cập nhật graph: `graphify . --update` nếu cấu trúc file đổi.
7. PR: nhánh `codex/<mô-tả>`, mô tả vấn đề và cách xác minh.
8. Deploy: `wrangler deploy` theo môi trường; đặt secret bằng `wrangler secret put`.
9. Quan sát: sau deploy, kiểm tra Sentry 24h gần nhất.

Chi tiết từng quy trình: [references/feature-workflow.md](references/feature-workflow.md).

## Quy ước

- Nhánh: `codex/<slug>`; commit theo Conventional Commits.
- Không commit `.dev.vars`, `.env`, hay service role key.
- Mọi bảng mới phải có `id`, `created_at`, `updated_at` và bật RLS.
- Tên bảng/cột dùng snake_case; tên component PascalCase.
- Không hardcode URL hay key; dùng biến môi trường và `wrangler.toml`/`wrangler.jsonc`.
- Giờ của một buổi học chỉ được tính qua `src/utils/slotTime.ts` (`resolveSlotTimeRange`) và
  `SlotTimeService` phía server: thứ tự ca học → slot → lớp. Không đọc thẳng `slot.startTime`
  ở route/handler vì slot cũ có thể thiếu giờ, khiến nút UI và API bất đồng.
- Cửa sổ điểm danh chỉ do server quyết định (`StudentSessionService` → `GET /api/student/session-state`).
  Client hiển thị `canCheckIn` + `reason`; không tự so `new Date()` để bật/tắt nút.
- Điểm danh tự phục vụ của học sinh dùng `src/hooks/useStudentCheckin.ts` cho cả dashboard và TKB —
  đừng viết lại logic POST/409/badge ở từng trang.
- Ghi danh lớp (`updateClass`) chỉ áp phần chênh lệch qua `diffRoster`; không xoá-rồi-chèn toàn bộ
  `class_students` (làm lớp trống tạm thời và mất dữ liệu khi bước chèn lỗi).
- TKB của học sinh không hiển thị buổi của lớp `Đã kết thúc` (lọc trong `ScheduleViewService`,
  không lọc ở client).
- Buổi lẻ do `ScheduleViewService` gắn `source: 'booking'` + `bookingId`; TKB chỉ hiện badge
  "Lịch lẻ" và nút Huỷ (gọi `DELETE /api/student/bookings`) khi có `source === 'booking'`.
  Server chặn huỷ sau giờ bắt đầu — client chỉ phản ánh, không tự quyết định.

## Bảo mật & dữ liệu

- `SUPABASE_SERVICE_ROLE_KEY` chỉ dùng server-side, không bao giờ lộ ra client.
- Bật RLS cho mọi bảng; policy theo `auth.uid()` và role.
- Secret của Worker: `wrangler secret put <NAME>` cho từng môi trường.
- Dữ liệu học sinh là dữ liệu cá nhân: che PII trong log và Sentry.

## Kiểm thử & xác minh

- [ ] `npm run lint` sạch.
- [ ] `npm test` (hoặc test liên quan) pass.
- [ ] `npm run build` hoặc `wrangler deploy --dry-run` không lỗi.
- [ ] Migration áp dụng được trên DB dev và có đường rollback.
- [ ] Không có secret trong diff.
- [ ] Sentry không phát sinh lỗi mới sau deploy.

## Lỗi thường gặp & cách sửa

| Triệu chứng | Nguyên nhân thường gặp | Cách sửa |
|-------------|------------------------|----------|
| `ReferenceError: process is not defined` | Dùng API Node trong Worker | Chuyển sang Web API; bật `nodejs_compat` nếu buộc |
| Query trả rỗng dù có dữ liệu | RLS chặn | Kiểm tra policy và JWT role |
| `fetch failed` khi nối Postgres | Workers không mở TCP trực tiếp | Dùng PostgREST hoặc Hyperdrive |
| Deploy lỗi secret | Thiếu biến môi trường | `wrangler secret put` cho đúng môi trường |
| UI lệch trên mobile | Bỏ qua mobile-first | Chạy UI-UX-Pro-Max `--domain ux` và sửa theo checklist |

## Mở rộng file này

Đây là tài liệu sống. Khi thêm một chức năng cốt lõi hoặc một yếu tố cốt lõi mới:

1. Cập nhật bảng Core Feature Registry hoặc Core Stack.
2. Thêm chi tiết vào reference tương ứng, không nhồi vào SKILL.md.
3. Thêm một dòng vào Quy ước nếu có ràng buộc mới.
