# Kế hoạch hoàn thiện WebApp — Student Management Cloudflare

Cập nhật theo đầy đủ các chỉ đạo mới (7 yêu cầu). Trạng thái: khảo sát code xong, chưa đụng `src/`.
Nhánh hiện tại: `codex/hoan-thien-webapp`.

---

## 0. Quyết định kiến trúc then chốt (đã chọn, cần người dùng xác nhận ở bước review)

**Mô hình "1 lớp – nhiều ca":** dùng bảng trung gian `class_sections` (mỗi dòng = 1 ca của lớp) + bảng nối `class_section_students`
(học sinh thuộc ca). Lý do: hiện tại `class_students(class_id, student_id)` chỉ ghi học sinh theo LỚP,
không theo ca, nên không thể "học sinh chỉ tham gia ca đã chọn" nếu không có bảng ca + bảng ghi học sinh theo ca.

- `tuition_invoices.class_id` tiếp tục neo theo LỚP (KHÔNG chuyển sang ca) để không vỡ công nợ đang có.
- `schedule_slots` thêm cột `section_id` (nullable) trỏ `class_sections`; mỗi buổi học thuộc về 1 ca.
- Sổ điểm danh của 1 buổi = học sinh thuộc ca của buổi đó (fallback về cả lớp nếu buổi chưa gán ca).
- "Số buổi còn lại" và "lương giáo viên" đều tính từ trạng thái ca **đã tham gia/hoàn thành** tại buổi học
  (`attendance_records` + `schedule_slots.status = 'Đã hoàn thành'`), không cần thêm bảng tài chính mới.

**Bỏ mã lớp:** dỡ ràng buộc `NOT NULL` + unique index `uq_classes_code` của `classes.code`,
bỏ `code` khỏi form/API/UI, giữ cột nullable tạm thời để không vỡ dữ liệu cũ (có thể drop cột ở migration sau).

---

## 1. Cơ chế lớp học nhiều ca + bỏ mã lớp

### Schema (`supabase/setup.sql`, idempotent)
1. Bảng mới `class_sections`: `id, class_id (FK cascade), name, shift_id, start_time, end_time,
   schedule_days integer[], teacher_id, room_id, is_active, created_at, updated_at`.
2. Bảng mới `class_section_students`: `section_id (FK cascade), student_id (FK cascade), enrolled_at`,
   PK `(section_id, student_id)`.
3. `alter table classes alter column code drop not null`; `drop index if exists uq_classes_code`.
4. `alter table schedule_slots add column if not exists section_id varchar(50)` + FK + index.
5. Backfill: mỗi lớp hiện có → tạo 1 `class_sections` từ `shift_id/start_time/end_time/schedule_days` hiện tại,
   chuyển các dòng `class_students` sang `class_section_students` của ca vừa tạo; gán `section_id` cho các
   `schedule_slots` của lớp.
6. RLS: bật cho 2 bảng mới (không policy, backend dùng service_role).

### Type + Repository
- `types/classroom.ts`: thêm `ClassSection`; `ClassEntity.code` chuyển optional; thêm `sections?: ClassSection[]`.
- `IRepository` + `LocalRepository` + `SupabaseRepository`:
  `getClassSections(classId)`, `getSectionById`, `createClassSection`, `updateClassSection`, `deleteClassSection`,
  `getSectionsByStudentId(studentId)`, `addStudentToSection/removeStudentFromSection`.
  `getScheduleSlotById` trả kèm `sectionId`; `getScheduleSlotsByStudentId` lọc theo ca học sinh tham gia.

### Backend
- `api/classes` POST/PUT: bỏ `code` khỏi validate + bỏ chống trùng mã; nhận `sections[]` và tạo/cập nhật ca.
- `api/classes` PUT: giữ logic đồng bộ lịch tương lai nhưng theo từng ca (mỗi section sinh/đồng bộ lịch riêng).
- `api/classes/enroll`: ENROLL/UNENROLL nhận `sectionId`; CHANGE_SHIFT chuyển học sinh giữa 2 section
  (cùng môn để hạch toán học phí đúng), **bỏ hoàn toàn nhân bản lớp mới + `buildShiftClassCode`**.

### UI (`admin/classes/page.tsx`)
- Bỏ field "Mã lớp"; form thêm danh sách **nhiều ca** (mỗi ca = chọn ca mẫu + giờ + thứ, thêm/xoá).
- Thẻ lớp hiển thị các ca + sĩ số từng ca.
- Thêm **nút Sửa** mở Sheet cập nhật thông tin/thời gian lớp (gọi PUT, gồm sections).
- Quản lý học viên theo từng ca (tab/sheet chọn ca).

---

## 2. Quản lý học sinh: popup + sổ điểm danh

### Popup học sinh (Admin + Giáo viên)
- Mở rộng `components/common/QuickStudentModal.tsx`: thêm **Tuổi** (tính từ `dateOfBirth`,
  "Chưa cập nhật" nếu thiếu) và **Trường** (`targetUniversity`/customUniversity + `gradeLevel`).
- Gắn tên học sinh clickable vào mọi nơi render tên: admin attendance, teacher attendance,
  admin calendar, teacher classes (roster), admin students, admin tuition. Tạo helper click tái dùng
  (state `selectedStudentId` chung + render `<QuickStudentModal/>`).

### Sổ điểm danh (Admin + Giáo viên)
- Thêm cột/tổng hợp **trạng thái điểm danh** từng học sinh trong lớp: đếm Có mặt / Vắng có phép /
  Vắng không phép / Đi muộn / Điểm danh bù trong kỳ. Nguồn: `attendance_records` theo `studentId` + `classId`.
- Roster điểm danh của 1 buổi lấy theo ca (`sectionId`), không theo cả lớp.

---

## 3. Đơn từ / xin phép

- `student/schedule/page.tsx`: mỗi slot thêm nút **"Xin vắng"** (`XIN_NGHI`) và **"Đổi ca"** (`DOI_CA`),
  gọi `api/requests` POST; hiển thị trạng thái đơn ngay trên slot.
- `types/schedule.ts`: `RequestType = 'XIN_NGHI' | 'DOI_CA'`.
- `setup.sql`: bổ sung `'DOI_CA'` vào check `class_requests_type_check` (dòng 408-409).
- `api/requests` DECIDE giữ nguyên (duyệt XIN_NGHI → ghi "Vắng có phép"); duyệt DOI_CA → chuyển ca
  (gọi logic CHANGE_SHIFT theo section).
- **Chỉ bỏ tab "Đơn từ" ở Portal Học sinh** (`navConfig.ts` NAV_GROUPS.STUDENT); Admin/Giáo viên **giữ nguyên**.

---

## 4. Học phí / Số buổi còn lại / Lương GV theo ca đã tham gia-hoàn thành

### Số buổi còn lại
- Thống nhất một nguồn sự thật: `tuition_invoices.session_count / used_sessions`
  (đã hiển thị ở `student/tuition`). `usedSessions` tăng bởi `deductSessionForAttendance` khi có mặt
  (Có mặt / Đi muộn / Điểm danh bù) — giữ nguyên, chỉ xác nhận cơ chế này chạy đúng theo ca.
- Bỏ dần `students.remaining_sessions` / `StudentMonthlyPackage` in-memory (đang dùng tạm, không persist) —
  tránh 2 nguồn số liệu lệch nhau.

### Lương giáo viên theo ca hoàn thành
- `TuitionPayrollService.calculateTeacherPayroll` đã lọc `status === 'Đã hoàn thành'` → giữ.
- Thống nhất `LedgerService.isSessionPayable` về cùng tiêu chí `status === 'Đã hoàn thành'`
  (bỏ nhánh `checkinTime` để không cộng 2 lần / lệch giữa bảng lương và thu-chi).

### Fix lỗi thông tin người nhận (ưu tiên cao)
- `api/settings/bank/route.ts` đang lưu `currentBankConfig` in-memory → mất khi Worker restart/đa instance.
- Thêm bảng `app_settings (key varchar primary key, value jsonb, updated_at)` + RLS trong `setup.sql`;
  thêm repository `getAppSetting(key)` / `setAppSetting(key, value)` (LocalRepository lưu in-memory để test).
- Route GET đọc từ DB (fallback `DEFAULT_BANK_CONFIG`), POST ghi DB rồi trả `{ success, bankConfig }`.
- Bỏ fallback `localStorage['admin_bank_config']` ở `admin/tuition` và `student/tuition` (đọc qua API là đủ).

### Hoá đơn thêm "gói + giá"
- `tuition_invoices` thêm `package_name varchar(255)`, `package_price numeric(12,2)` (idempotent alter).
- `types/finance.ts` `TuitionInvoice` thêm `packageName?`, `packagePrice?`.
- Mapper `mapTuitionInvoiceFromDb/ToDb` + `createInvoice` snapshot `packageName/packagePrice`.
- `api/finance/route.ts`: nhánh `PURCHASE_PACKAGE` và `CREATE` gửi snapshot tên + giá gói.
- Hiển thị trong hoá đơn ở `admin/tuition` và `student/tuition` (Badge "Gói 10 buổi — 1.500.000đ").

---

## 5. Thứ tự triển khai (mỗi pha build + test riêng)

1. Cập nhật kế hoạch này (file này) — đã xong.
2. **Fix người nhận học phí** (ít rủi ro, đau nhất): schema `app_settings` → repo → route bank → sửa test bank.
3. **Hoá đơn thêm gói + giá** (type + mapper + schema + createInvoice + finance route + hiển thị).
4. **Nhiều ca + bỏ mã lớp + nút Sửa lớp** (schema section + backfill → repo → API → UI).
5. **Popup học sinh + sổ điểm danh trạng thái**.
6. **Nút xin vắng/đổi ca trên TKB học sinh + bỏ tab Đơn từ (student)**.
7. Verify tổng: lint + test + build/deploy dry-run.

---

## 6. Rủi ro & điểm dễ gây bug nhỏ (cần kiểm tra kỹ)

- Bỏ `code`: phải đồng bộ schema + API + UI + seed + hiển thị (`{cls.code} • {cls.id}` ở admin/classes ~387)
  để tránh `duplicate key` khi cột còn NOT NULL/unique.
- Chuyển CHANGE_SHIFT → section: giữ `findOverlappingEnrollment` chống trùng giờ, đồng bộ `enrolledClassIds`.
- `getScheduleSlotsByStudentId` hiện lọc theo `classIds` → phải đổi sang lọc theo ca học sinh tham gia,
  nếu không học sinh vẫn thấy toàn bộ ca của lớp.
- Điểm danh roster: `attendance/route.ts` đang merge `cls.studentIds` → đổi sang `section` studentIds.
- Lương: thống nhất 1 tiêu chí "ca hoàn thành" ở cả `TuitionPayrollService` lẫn `LedgerService`.
- Test cần điều chỉnh: `bank-settings-vietqr.test.ts` (từ in-memory → persist),
  `student-shift-change.test.ts` (CHANGE_SHIFT theo section), `tuition-payroll.test.ts`,
  `milestone3-packages-attendance.test.ts`, `shifts-and-box-schedule.test.ts`.

---

## 7. Verify cuối cùng
- `./node_modules/.bin/tsc --noEmit` sạch.
- `npm run lint`, `npm test` (DATA_SOURCE=local), `npm run build` / `wrangler deploy --dry-run`.
- Migration chạy được và có đường rollback; không lộ secret; RLS mọi bảng bật.
- Cập nhật Feature Registry trong `.agents/skills/student-management-cloudflare/SKILL.md`.

