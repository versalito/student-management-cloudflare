# STUDENT_PORTAL_FIX_SPEC

> Trạng thái: **ĐÃ HOÀN THÀNH TOÀN BỘ** (2026-11-08)
> Phạm vi: Portal học sinh (TKB, lớp học, điểm danh) + luồng thanh toán.
> Kết quả: 6/6 hạng mục đã implement, 278 tests pass, build sạch, đã smoke E2E trên trình duyệt thật (dashboard + TKB).
> Chi tiết:
> - Hạng mục 1: TKB hiển thị tên lớp thật (dựng từ `ScheduleViewService`, có cache).
> - Hạng mục 2: TKB khớp lớp đã đăng ký, loại slot của lớp "Đã kết thúc" / "Đã hủy" (kèm bộ test `roster-and-finished-class.test.ts`).
> - Hạng mục 3: Nguồn sự thật duy nhất cho cửa sổ điểm danh (`StudentSessionService.evaluateSessionWindow`), trả cờ máy đọc `window: 'open' | 'not_open' | 'ended'` để UI và API `POST /api/attendance` không bao giờ lệch nhau.
> - Hạng mục 4: Đăng ký buổi lẻ qua bảng `student_session_bookings` + panel `ExtraSessionsPanel`, tự huỷ trước giờ, điểm danh tự trừ buổi.
> - Hạng mục 5: Nút điểm danh/đổi ca/xin vắng ngay trên card TKB, đồng bộ trạng thái với dashboard.
> - Hạng mục 6: Gỡ bỏ webhook thanh toán tự động (trả 410 Gone), xoá mock payment, chỉ Admin được chuyển trạng thái hoá đơn.

## 0. Hiện trạng (bằng chứng từ code)

| # | Vấn đề | Vị trí | Nguyên nhân |
|---|---|---|---|
| 1 | TKB hiện tên môn + mã GV | `src/app/student/schedule/page.tsx:287,290` (`slot.subject`, `slot.teacherId`), `student/dashboard/page.tsx:370,374` | Card dùng `subject` (fallback từ lớp) và in thẳng `teacherId` (không map tên); đã có `classMap` nhưng chỉ dùng cho `meetingLink` |
| 2 | TKB lệch lớp đã đăng ký | `api/schedule/route.ts:33-37`; `SupabaseRepository.updateClass():1095-1102`; `student/schedule/page.tsx:98-104` | (a) `updateClass` **xoá toàn bộ** `class_students` rồi insert lại từ mảng in-memory → mất ghi danh khi 2 thao tác xen nhau; (b) TKB không lọc `status = 'Đã hủy'`, vẫn hiện slot lớp đã kết thúc; (c) sau enroll/đổi ca không refetch, AppContext giữ `enrolledClassIds` cũ |
| 3 | Điểm danh không đúng lớp đang/sắp diễn ra | `api/attendance/current-session/route.ts:24-63`; `student/dashboard/page.tsx:59-95, 354, 365-374` | (a) endpoint **không có `studentId`** → trả slot đang chạy của bất kỳ lớp nào trong ngày; (b) `dateParam` fallback trả slot bất kỳ trong tháng; (c) dashboard lấy `slots.slice(0,5)` **không sort** → 5 buổi cũ nhất, tháng hardcode `/{09}/2026` và `slice(8)}/09`; (d) `canCheckIn` tính bằng đồng hồ client |
| 4 | "Lớp học của tôi" chỉ chọn ca cho toàn bộ lịch | `student/classes/page.tsx:52-118`; `api/classes/enroll/route.ts:186-230` | Mô hình ghi danh chỉ có cấp lớp (`class_students`); đổi ca = chuyển nguyên lớp. Không có khái niệm đăng ký **một buổi cụ thể** |
| 5 | Không có nút điểm danh ở TKB | `student/schedule/page.tsx` (không có CTA) | Logic điểm danh chỉ tồn tại ở dashboard, dùng `STUDENT_CHECKIN` |
| 6 | Thanh toán tự động qua API | `api/payment/webhook/route.ts`; `student/tuition/page.tsx:160-188` (`handleConfirmMockPayment`) | Webhook tự gạch nợ không idempotent; nút "xác nhận" phía HS gọi `/api/finance` ghi nhận thanh toán không cần admin |

## 1. Hạng mục 1 — TKB hiển thị tên lớp

**Thay đổi**
- Card slot: tiêu đề = `cls.name` (`classMap.get(slot.classId)?.name`), fallback `slot.classId`.
- Dòng phụ: `slot.startTime–slot.endTime` · `cls?.roomId || slot.roomId` · link phòng online.
- Bỏ `slot.subject` và `slot.teacherId` khỏi card (GV vẫn xem được ở portal GV).
- Dashboard "Buổi học sắp tới": `{cls.name}` thay `{slot.subject} ({slot.classId})`.
- API `/api/schedule` trả thêm `className` để client không phải ghép thủ công (giữ `subject` cho admin/teacher).

**Acceptance**: không còn chuỗi `GV0xx`/tên môn trong card TKB của HS; card hiển thị đúng tên lớp như tab "Lớp học của tôi".

## 2. Hạng mục 2 — TKB luôn khớp lớp đã đăng ký

**Bất biến cần bảo đảm**
```
classesInTimetable(student) == class_students(student) − lớp 'Đã kết thúc'
slotsInTimetable(student)  == slots(class ∈ classesInTimetable) − slot 'Đã hủy'
                     ∪ bookings(student, status='Đã đăng ký')
```

**Thay đổi**
1. API: một query hợp nhất phía server thay vì 2 bước JS
   - `class_students?student_id=eq.X` → `schedule_slots?class_id=in.(...)&status=neq.Đã hủy&date=gte.<from>&date=lte.<to>`
   - trả `source: 'class' | 'booking'`, kèm `className`, `classStatus`.
2. Sửa `updateClass`: **không** xoá-rồi-chèn toàn bộ roster; chỉ `insert`/`delete` phần chênh lệch (`diff`), hoặc chuyển thao tác ghi danh sang RPC transaction:
   ```sql
   create or replace function enroll_student(p_class text, p_student text) ...
   create or replace function unenroll_student(...) ...   -- 1 transaction, idempotent
   ```
3. Enroll/UNENROLL/CHANGE_SHIFT dùng RPC trên; route trả kèm `student` + `slots` mới hoặc client refetch `student`, `schedule`, `session-state`.
4. Lọc bỏ slot `Đã hủy` và slot của lớp `Đã kết thúc` ở mọi màn HS.
5. Thêm kiểm tra nhất quán (script + test): sau chuỗi enroll/đổi ca ngẫu nhiên, `timetable.classIds == class_students`.

**Acceptance**
- HS đổi ca: TKB tuần này biến mất lớp cũ, xuất hiện lớp mới ngay (không reload trang).
- Bỏ đăng ký lớp: không còn buổi nào của lớp đó trong TKB/lịch sử "sắp tới".
- Chạy script kiểm tra 100 vòng thao tác ngẫu nhiên: 0 lệch.

## 3. Hạng mục 3 — Điểm danh đúng lớp đang/sắp diễn ra

**Thay đổi**
1. Endpoint mới `GET /api/student/session-state?studentId=`:
   ```json
   {
     "current": { "slotId","className","startTime","endTime","canCheckIn", "alreadyChecked" },
     "next":    { "slotId","className","date","startTime","canCheckIn" },
     "checkedInToday": [...]
   }
   ```
   - Nguồn: union TKB ở mục 2, chỉ slot của HS, sort `date, startTime`.
   - `current` = slot có `startTime ≤ now ≤ endTime` **hôm nay**; `next` = slot gần nhất sau `now` trong 7 ngày.
   - `canCheckIn` tính **server-side** theo Asia/Saigon, cửa sổ `[startTime − 10', endTime]` (chốt với bạn), kèm `reason`.
2. `GET /api/attendance/current-session`: bắt buộc `studentId` (hoặc `teacherId` cho portal GV); bỏ nhánh `dateParam` fallback trả slot bất kỳ; trả `hasActiveSession:false` khi không có.
3. Dashboard:
   - bỏ `slots.slice(0,5)`; dùng `next` + `current` từ endpoint trên;
   - tiêu đề "Buổi học sắp tới" bỏ hardcode tháng; ngày render từ `slot.date` (`DD/MM`);
   - nút điểm danh đọc `canCheckIn` từ server, không tự tính giờ.
4. `LiveSessionTracker` (GV/Admin) giữ `teacherId`, không bị ảnh hưởng.

**Acceptance**
- HS A không thấy ca của lớp HS B ở bất kỳ thời điểm nào.
- Trước khi mở (sớm hơn 10' so với `startTime`) → nút disabled, lý do "Còn N phút nữa mới mở điểm danh (mở sớm 10 phút)"; trong cửa sổ → enabled; sau `endTime` → "Ca đã kết thúc".
- Ở 2 múi giờ máy khác nhau (UTC, +07), trạng thái nút giống nhau.

## 4. Hạng mục 4 — Chọn lịch lẻ (đăng ký từng buổi)

**Mô hình dữ liệu mới**
```sql
CREATE TABLE student_session_bookings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  slot_id     VARCHAR(50) NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL DEFAULT 'Đã đăng ký'
              CHECK (status IN ('Đã đăng ký','Đã hủy','Đã học')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, slot_id)
);
CREATE INDEX idx_ssb_student ON student_session_bookings(student_id);
CREATE INDEX idx_ssb_slot    ON student_session_bookings(slot_id);
```

**Không có sức chứa lớp**: bỏ hẳn khái niệm "còn chỗ"/`isFull`. Booking chỉ bị chặn bởi: slot đã qua, slot `Đã hủy`, lớp `Đã kết thúc`, trùng giờ với buổi khác của HS. Xoá `maxCapacity = 15` và mọi badge "Còn chỗ"/`{n}/{15}` ở `student/classes/page.tsx:257-291,375,453`.

**API**
| Method | Route | Việc |
|---|---|---|
| GET | `/api/student/slots?from&to&subject` | slot của các lớp `Đang mở` trong khoảng ngày, kèm `bookedByMe`, `conflict`, `className` (không tính sức chứa) |
| POST | `/api/student/bookings` `{slotId}` | kiểm tra: slot chưa diễn ra, slot không `Đã hủy`, lớp `Đang mở`, không trùng giờ với slot HS đã có cùng ngày → insert (idempotent) |
| DELETE | `/api/student/bookings?slotId=` | chỉ cho huỷ trước `startTime` |

**UI (tab "Lớp học của tôi")**
- Thêm chế độ "Chọn buổi lẻ": dải tuần (T2→CN) + chip ca `18:30–20:30 · Lớp A`; chọn nhiều buổi rồi "Đăng ký N buổi".
- Buổi đã đặt hiện trong TKB với badge "Lịch lẻ"; huỷ được trước giờ.
- Chế độ cũ (đăng ký lớp/đổi ca) giữ nguyên, không phá luồng hiện tại.

**Ràng buộc nghiệp vụ (đề xuất)**
- Học bù/lịch lẻ chỉ áp dụng cho môn HS đang/đã học? → mặc định: mọi lớp `Đang mở`, lọc theo môn ở UI.
- Trừ buổi: mỗi lần điểm danh thành công trừ 1 buổi trong gói (giữ nguyên hành vi hiện tại). Không tạo hóa đơn riêng cho buổi lẻ.

**Acceptance**: HS đặt 1 buổi ngày 12/11 ca 3; TKB hiện buổi đó; điểm danh buổi đó thành công và trừ 1 buổi; huỷ trước giờ hoạt động, huỷ sau giờ bị chặn 400.

## 5. Hạng mục 5 — Nút điểm danh trong TKB

- Trên card slot **hôm nay** (và slot lịch lẻ hôm nay), render CTA theo state từ `session-state`:
  `Sắp diễn ra (còn 25')` → disabled · `Đang diễn ra` → nút "Điểm danh" · đã điểm danh → badge `Có mặt 18:32`/`Đi muộn` · kết thúc → disabled.
- Nút gọi `POST /api/attendance {action:'STUDENT_CHECKIN', studentId, scheduleSlotId}` (đã có).
- Backend mở rộng kiểm tra ghi danh: `isEnrolled = cls.studentIds.includes(studentId) || bookingExists(studentId, slotId)`.
- Bấm xong: cập nhật badge tại chỗ + refetch `session-state`; hiển thị toast, không cần reload.

**Acceptance**: đúng cửa sổ mới bấm được; sau bấm, reload trang vẫn thấy badge; API trả 409 kèm record nếu đã điểm danh (UI hiển thị record thay vì lỗi).

## 6. Hạng mục 6 — Bỏ thanh toán tự động, giữ thủ công

**Bỏ**
- `POST /api/payment/webhook` → trả `410 Gone` (giữ file 1 dòng để tránh 404 im lặng) + xoá mục hướng dẫn SePay/Casso trong `admin/guides`.
- `handleConfirmMockPayment` + `paymentSuccess` trong `student/tuition/page.tsx`; bỏ `setTimeout` tự đóng modal sau thanh toán.
- Nhánh `POST /api/finance` với `paymentAmount` (processPayment) chỉ dùng cho HS → chuyển sang admin-only (`PUT UPDATE_STATUS`).

**Giữ (thủ công)**
- Admin ghi nhận tại `admin/tuition` → `PUT /api/finance {action:'UPDATE_STATUS', status:'Đã nộp', paymentMethod, paidDate, transactionCode:'MANUAL-…'}` (đã có).
- HS chỉ xem QR + nội dung chuyển khoản + trạng thái hóa đơn; modal ghi rõ "Admin sẽ xác nhận sau khi nhận được tiền".
- (Tuỳ chọn) nút "Tôi đã chuyển khoản" chỉ tạo notification cho admin, không đổi trạng thái hóa đơn.

**Acceptance**: không còn đường nào set hóa đơn thành `Đã nộp` ngoài `UPDATE_STATUS`; webhook trả 410; HS không thể tự đánh dấu đã thanh toán.

## 7. Thứ tự thực hiện

| PR | Nội dung | Phụ thuộc |
|---|---|---|
| 1 | Hạng mục 1 (tên lớp) + 3 (session-state, sort/label dashboard) | — |
| 2 | Hạng mục 2 (query hợp nhất, RPC ghi danh, lọc hủy/kết thúc, consistency test) | PR-1 |
| 3 | Hạng mục 5 (nút điểm danh trong TKB, mở rộng STUDENT_CHECKIN) | PR-1 |
| 4 | Hạng mục 6 (bỏ webhook + mock payment) | độc lập |
| 5 | Hạng mục 4 (bảng bookings, API, UI chọn buổi lẻ) | PR-2 |

Bỏ sức chứa lớp đã chốt: không thêm cột `capacity`, không chặn ghi danh/booking theo sĩ số.

## 8. Cần chốt trước khi code

1. ~~Cửa sổ điểm danh: `start − 10'` → `end` (đề xuất) hay đúng `start`.~~ **Đã chốt: `start − 10'` → `end`.** Điểm mở lấy từ `EARLY_CHECKIN_MINUTES` trong `StudentSessionService`; nút ở UI và `POST /api/attendance` dùng chung một hàm nên không lệch nhau.
2. ~~Buổi lẻ trừ gói buổi (đề xuất) hay tạo hóa đơn riêng.~~ **Đã chốt: trừ 1 buổi trong gói đang hoạt động** tại thời điểm điểm danh (qua `POST /api/attendance` `usedSessions += 1`). Không tạo hoá đơn riêng.
3. ~~HS bấm "Tôi đã chuyển khoản": bỏ hẳn (đề xuất) hay chỉ bắn notification cho admin.~~ **Đã chốt: bỏ hẳn.** Modal hiển thị mã VietQR + thông tin chuyển khoản rõ ràng kèm dòng "Admin sẽ xác nhận sau khi nhận được tiền"; gỡ hoàn toàn mock payment và webhook.

## 9. Kiểm thử

- Unit: `session-state` (biên ±1 phút, ca qua đêm, 2 múi giờ), booking conflict/trùng giờ/huỷ muộn.
- Integration: enroll → đổi ca → unenroll → TKB đúng ở từng bước (so sánh với `class_students`).
- Smoke tay: 4 kịch bản — TKB tên lớp, điểm danh đúng cửa sổ, đặt 1 buổi lẻ rồi điểm danh, admin xác nhận thanh toán thủ công.
