import test from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import { BookingService, slotRangesOverlap, slotHasStarted, settleBookingsAttended } from '../src/services/BookingService';
import { loadScheduleView } from '../src/services/ScheduleViewService';
import { POST } from '../src/app/api/attendance/route';
import { authedAsStudent } from './helpers/auth';
import { getTodayDateStr } from '../src/utils/date';
import type { ClassEntity, ClassSection } from '../src/types/classroom';
import type { ScheduleSlot } from '../src/types/schedule';

/**
 * Học buổi lẻ: đặt / huỷ / trùng giờ / thanh toán theo buổi.
 * Dùng ngày tương lai xa (2099) để `slotHasStarted` không phụ thuộc lúc chạy test.
 */
const DATE = '2099-01-05';
const OTHER_DATE = '2099-01-06';
/** Ngày hôm nay theo Asia/Saigon + mốc ISO dùng cho dòng booking trong test điểm danh. */
const todayStr = getTodayDateStr();
const nowIso = new Date().toISOString();

/** Lỗi nghiệp vụ có `code`/`status` (BookingError) — dùng cho assert.rejects. */
function isBookingError(code: string, status?: number) {
  return (err: unknown) => {
    const coded = err as { code?: string; status?: number };
    return coded?.code === code && (status === undefined || coded.status === status);
  };
}

function makeClass(id: string, name: string, status: ClassEntity['status'] = 'Đang mở'): ClassEntity {
  return {
    id,
    name,
    subject: 'Toán',
    teacherId: 'GV001',
    studentIds: [],
    tuitionFee: 1000000,
    scheduleDays: [2],
    startTime: '18:30',
    endTime: '20:30',
    status,
  };
}

function makeSection(id: string, classId: string, startTime = '18:30', endTime = '20:30'): ClassSection {
  return {
    id,
    classId,
    name: `Ca ${startTime}`,
    startTime,
    endTime,
    scheduleDays: [2],
    isActive: true,
    studentIds: [],
  };
}

function makeSlot(id: string, classId: string, date = DATE, startTime = '18:30', endTime = '20:30'): ScheduleSlot {
  return {
    id,
    classId,
    teacherId: 'GV001',
    date,
    shiftId: 5,
    startTime,
    endTime,
    subject: 'Toán',
    status: 'Đã lên lịch',
  };
}

async function seedFixtures() {
  await repo.createClass(makeClass('CLS_BOOK', 'Lớp buổi lẻ'));
  await repo.createClass(makeClass('CLS_BOOK_2', 'Lớp buổi lẻ 2'));
  await repo.createClass(makeClass('CLS_CLOSED', 'Lớp đã kết thúc', 'Đã kết thúc'));
  await repo.createClassSection(makeSection('SEC_BOOK', 'CLS_BOOK'));
  await repo.createClassSection(makeSection('SEC_BOOK_2', 'CLS_BOOK_2', '19:00', '21:00'));

  await repo.createScheduleSlot(makeSlot('SCH_BOOK_A', 'CLS_BOOK'));
  await repo.createScheduleSlot(makeSlot('SCH_BOOK_B', 'CLS_BOOK_2', DATE, '19:00', '21:00'));
  await repo.createScheduleSlot(makeSlot('SCH_BOOK_OTHER_DAY', 'CLS_BOOK', OTHER_DATE));
  await repo.createScheduleSlot(makeSlot('SCH_BOOK_CLOSED', 'CLS_CLOSED'));
  await repo.createScheduleSlot({
    ...makeSlot('SCH_BOOK_CANCELLED', 'CLS_BOOK'),
    status: 'Đã hủy',
  });
}

test('Học buổi lẻ (student_session_bookings)', async (t) => {
  await seedFixtures();
  const service = new BookingService(repo);

  await t.test('1. Khoảng giờ trùng tính cả ca qua nửa đêm', () => {
    assert.equal(
      slotRangesOverlap(
        { date: DATE, startTime: '18:30', endTime: '20:30' },
        { date: DATE, startTime: '20:00', endTime: '21:00' },
      ),
      true,
    );
    assert.equal(
      slotRangesOverlap(
        { date: DATE, startTime: '18:30', endTime: '20:30' },
        { date: DATE, startTime: '20:30', endTime: '21:30' },
      ),
      false,
      'Chạm mép không tính là trùng',
    );
    assert.equal(
      slotRangesOverlap(
        { date: DATE, startTime: '22:00', endTime: '01:00' },
        { date: DATE, startTime: '21:00', endTime: '23:30' },
      ),
      true,
      'Ca qua nửa đêm vẫn so đúng phía trước nửa đêm',
    );
    assert.equal(
      slotRangesOverlap(
        { date: DATE, startTime: '22:00', endTime: '01:00' },
        { date: DATE, startTime: '00:30', endTime: '01:30' },
      ),
      false,
      '00:30 cùng ngày là sáng sớm, không phải sau 22:00',
    );
    assert.equal(
      slotRangesOverlap(
        { date: DATE, startTime: '18:30', endTime: '20:30' },
        { date: OTHER_DATE, startTime: '18:30', endTime: '20:30' },
      ),
      false,
      'Khác ngày thì không trùng',
    );
  });

  await t.test('2. Danh sách buổi đăng ký được: chỉ lớp đang mở, bỏ buổi đã huỷ và buổi trùng giờ được đánh dấu', async () => {
    const slots = await service.listBookableSlots({ studentId: 'ST001', from: DATE, to: OTHER_DATE });
    const ids = slots.map((s) => s.id);

    assert.ok(ids.includes('SCH_BOOK_A'), 'Buổi của lớp đang mở phải có trong danh sách');
    assert.ok(!ids.includes('SCH_BOOK_CLOSED'), 'Lớp đã kết thúc không được đăng ký');
    assert.ok(!ids.includes('SCH_BOOK_CANCELLED'), 'Buổi đã huỷ không được đăng ký');
    assert.deepEqual(slots.map((s) => s.date), [...slots.map((s) => s.date)].sort(), 'Sắp theo ngày');
  });

  await t.test('3. Đặt buổi: tạo dòng mới, gọi lại không tạo trùng', async () => {
    const first = await service.book('ST001', 'SCH_BOOK_A');
    assert.equal(first.alreadyBooked, false);
    assert.equal(first.booking.status, 'Đã đăng ký');
    assert.equal(first.booking.studentId, 'ST001');
    assert.equal(first.booking.slotId, 'SCH_BOOK_A');

    const second = await service.book('ST001', 'SCH_BOOK_A');
    assert.equal(second.alreadyBooked, true, 'Lần hai phải là no-op');
    assert.equal(second.booking.id, first.booking.id);

    const rows = await repo.getSessionBookings({ studentId: 'ST001', slotId: 'SCH_BOOK_A' });
    assert.equal(rows.length, 1, 'Một học sinh chỉ có một dòng cho một buổi');
  });

  await t.test('4. Trùng giờ với buổi đã đặt thì bị từ chối', async () => {
    await assert.rejects(
      () => service.book('ST001', 'SCH_BOOK_B'),
      isBookingError('TIME_CONFLICT', 409),
    );
    const rows = await repo.getSessionBookings({ studentId: 'ST001', slotId: 'SCH_BOOK_B' });
    assert.equal(rows.filter((b) => b.status !== 'Đã hủy').length, 0, 'Không được ghi dòng khi trùng giờ');
  });

  await t.test('5. Lớp đã kết thúc / buổi đã huỷ / không tồn tại đều bị chặn', async () => {
    await assert.rejects(() => service.book('ST001', 'SCH_BOOK_CLOSED'), isBookingError('CLASS_NOT_OPEN'));
    await assert.rejects(() => service.book('ST001', 'SCH_BOOK_CANCELLED'), isBookingError('SLOT_CANCELLED'));
    await assert.rejects(() => service.book('ST001', 'SCH_KHONG_TON_TAI'), isBookingError('SLOT_NOT_FOUND'));
  });

  await t.test('6. Thời khoá biểu hợp nhất buổi lẻ với nhãn source=booking', async () => {
    const view = await loadScheduleView({ studentId: 'ST001', date: DATE });
    const booked = view.slots.find((s) => s.id === 'SCH_BOOK_A');
    assert.ok(booked, 'Buổi lẻ phải xuất hiện trong thời khoá biểu');
    assert.equal(booked?.source, 'booking');
    assert.ok(booked?.bookingId, 'Phải kèm mã đăng ký để huỷ');
  });

  await t.test('7. Huỷ trước giờ học: giữ dòng với trạng thái Đã hủy, đặt lại thì hồi sinh dòng cũ', async () => {
    const cancelled = await service.cancel('ST001', 'SCH_BOOK_A');
    assert.equal(cancelled.status, 'Đã hủy');

    const rows = await repo.getSessionBookings({ studentId: 'ST001', slotId: 'SCH_BOOK_A' });
    assert.equal(rows.length, 1, 'Huỷ không xoá dòng');
    assert.equal(rows[0].status, 'Đã hủy');

    const view = await loadScheduleView({ studentId: 'ST001', date: DATE });
    assert.equal(view.slots.find((s) => s.id === 'SCH_BOOK_A'), undefined, 'Buổi đã huỷ không còn trong TKB');

    const rebooked = await service.book('ST001', 'SCH_BOOK_A');
    assert.equal(rebooked.booking.id, rows[0].id, 'Đặt lại dùng đúng dòng cũ');
    assert.equal(rebooked.booking.status, 'Đã đăng ký');

    const again = await repo.getSessionBookings({ studentId: 'ST001', slotId: 'SCH_BOOK_A' });
    assert.equal(again.length, 1, 'Không sinh dòng thứ hai');
  });

  await t.test('8. Huỷ buổi đã bắt đầu thì bị chặn', async () => {
    assert.equal(slotHasStarted({ date: '2020-01-01', startTime: '18:30' }), true);

    // Dòng đặt được tạo thẳng trong DB (đường API đã chặn đặt buổi quá khứ).
    await repo.createScheduleSlot(makeSlot('SCH_BOOK_PAST', 'CLS_BOOK', '2020-01-01'));
    await repo.createSessionBooking({
      id: 'BKG_PAST',
      studentId: 'ST001',
      slotId: 'SCH_BOOK_PAST',
      status: 'Đã đăng ký',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    });

    await assert.rejects(
      () => service.cancel('ST001', 'SCH_BOOK_PAST'),
      isBookingError('SLOT_STARTED'),
      'Buổi đã bắt đầu không được huỷ',
    );

    await assert.rejects(
      () => service.cancel('ST001', 'SCH_BOOK_OTHER_DAY'),
      isBookingError('BOOKING_NOT_FOUND'),
      'Huỷ buổi chưa đặt phải báo không tìm thấy',
    );
  });

  await t.test('9. Điểm danh chốt buổi lẻ thành Đã học và khoá huỷ', async () => {
    await settleBookingsAttended(repo, [
      { scheduleSlotId: 'SCH_BOOK_A', studentId: 'ST001', status: 'Có mặt' },
    ]);

    const rows = await repo.getSessionBookings({ studentId: 'ST001', slotId: 'SCH_BOOK_A' });
    assert.equal(rows[0].status, 'Đã học');

    await assert.rejects(
      () => service.cancel('ST001', 'SCH_BOOK_A'),
      isBookingError('BOOKING_COMPLETED'),
    );
  });

  await t.test('10. Buổi trùng giờ vẫn hiện trong danh sách kèm lý do thay vì biến mất', async () => {
    const slots = await service.listBookableSlots({ studentId: 'ST002', from: DATE, to: DATE });
    const a = slots.find((s) => s.id === 'SCH_BOOK_A');
    const b = slots.find((s) => s.id === 'SCH_BOOK_B');
    assert.ok(a && b, 'Cả hai buổi đều phải trả về cho học sinh chưa đặt gì');
    assert.equal(a?.conflict, undefined);
    assert.equal(b?.conflict, undefined);

    await service.book('ST002', 'SCH_BOOK_A');
    const afterBook = await service.listBookableSlots({ studentId: 'ST002', from: DATE, to: DATE });
    const conflictB = afterBook.find((s) => s.id === 'SCH_BOOK_B');
    assert.equal(conflictB?.conflict?.slotId, 'SCH_BOOK_A', 'Buổi trùng giờ phải kèm thông tin xung đột');
    assert.equal(afterBook.find((s) => s.id === 'SCH_BOOK_A'), undefined, 'Buổi đã đặt không còn trong danh sách mời');
  });

  await t.test('11. Điểm danh lại buổi lẻ đã chốt Đã học báo 409, không phải 403 sai danh sách lớp', async () => {
    // Ca phủ trọn hôm nay để cửa sổ điểm danh luôn mở, không phụ thuộc giờ chạy test.
    await repo.createClass(makeClass('CLS_CHECKIN', 'Lớp điểm danh buổi lẻ'));
    await repo.createScheduleSlot(makeSlot('SCH_CHECKIN', 'CLS_CHECKIN', todayStr, '00:00', '23:59'));
    await repo.createSessionBooking({
      id: 'BKG_CHECKIN',
      studentId: 'ST003',
      slotId: 'SCH_CHECKIN',
      status: 'Đã đăng ký',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const checkIn = () =>
      POST(
        authedAsStudent('ST003')('http://localhost/api/attendance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'STUDENT_CHECKIN',
            studentId: 'ST003',
            scheduleSlotId: 'SCH_CHECKIN',
          }),
        }),
      );

    const first = await checkIn();
    assert.equal(first.status, 200, 'Học sinh đặt buổi lẻ phải tự điểm danh được');
    const rows = await repo.getSessionBookings({ studentId: 'ST003', slotId: 'SCH_CHECKIN' });
    assert.equal(rows[0].status, 'Đã học', 'Điểm danh phải chốt buổi lẻ thành Đã học');

    const second = await checkIn();
    assert.equal(second.status, 409, 'Lần điểm danh thứ hai phải là 409 đã điểm danh rồi');
  });

  await t.test('12. Điểm danh buổi lẻ trừ đúng 1 buổi trong gói, điểm danh lại không trừ thêm', async () => {
    await repo.createClass(makeClass('CLS_DEDUCT', 'Lớp trừ buổi'));
    await repo.createScheduleSlot(makeSlot('SCH_DEDUCT', 'CLS_DEDUCT', todayStr, '00:00', '23:59'));
    await repo.createSessionBooking({
      id: 'BKG_DEDUCT',
      studentId: 'ST004',
      slotId: 'SCH_DEDUCT',
      status: 'Đã đăng ký',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await repo.createTuitionInvoice({
      id: 'TUI_DEDUCT',
      studentId: 'ST004',
      classId: 'CLS_DEDUCT',
      title: 'Gói 10 buổi - lớp trừ buổi',
      sessionCount: 10,
      usedSessions: 2,
      amount: 1000000,
      paidAmount: 1000000,
      remainingAmount: 0,
      dueDate: todayStr,
      status: 'Đã nộp',
    });

    const res = await POST(
      authedAsStudent('ST004')('http://localhost/api/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'STUDENT_CHECKIN',
          studentId: 'ST004',
          scheduleSlotId: 'SCH_DEDUCT',
        }),
      }),
    );
    assert.equal(res.status, 200, 'Điểm danh buổi lẻ phải thành công');

    const after = (await repo.getTuitionInvoicesByStudentId('ST004')).find((i) => i.id === 'TUI_DEDUCT');
    assert.equal(after?.usedSessions, 3, 'Điểm danh 1 buổi phải trừ đúng 1 buổi trong gói');

    // Lần hai bị chặn 409 nên không được trừ thêm buổi nào.
    await POST(
      authedAsStudent('ST004')('http://localhost/api/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'STUDENT_CHECKIN',
          studentId: 'ST004',
          scheduleSlotId: 'SCH_DEDUCT',
        }),
      }),
    );
    const afterRetry = (await repo.getTuitionInvoicesByStudentId('ST004')).find((i) => i.id === 'TUI_DEDUCT');
    assert.equal(afterRetry?.usedSessions, 3, 'Điểm danh trùng không được trừ thêm buổi');
  });
});
