import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ShiftService } from '../src/services/ShiftService';
import { POST as bulkUpdateFuture } from '../src/app/api/schedule/bulk-update-future/route';
import { POST as bulkDailyAction } from '../src/app/api/schedule/bulk-daily-action/route';
import { POST as shiftsPost } from '../src/app/api/shifts/route';
import { repo } from '../src/repositories';
import { ScheduleSlot, TimeShift } from '../src/types/schedule';

describe('Bulk Schedule Operations Suite', () => {
  const testClassId = 'CLS_BULK_TEST';
  const testTeacherId = 'GV_BULK_01';
  const testRoomId = 'ROOM_BULK_A';

  // Ngày fixture phải tính từ hôm nay: `ShiftService.bulkUpdateShifts` chỉ đồng bộ
  // các slot có `date >= today`, nên mốc cố định trong quá khứ (2026-10-*) làm
  // test này fail vĩnh viễn sau ngày đó.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = (offset: number) =>
    new Date(startOfToday.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const D01 = day(1);
  const D02 = day(2);
  const D05 = day(5);
  const D10 = day(10);
  const D15 = day(15);

  it('Setup: Tạo các ca học giả lập phục vụ kiểm thử', async () => {
    await ShiftService.resetDefaults();

    // Tạo 4 ca học của lớp CLS_BULK_TEST
    const slots: ScheduleSlot[] = [
      {
        id: 'SCH_BULK_01',
        classId: testClassId,
        teacherId: testTeacherId,
        roomId: testRoomId,
        date: D01,
        shiftId: 1,
        startTime: '08:00',
        endTime: '10:00',
        subject: 'Toán Học Đại Số',
        status: 'Đã lên lịch',
      },
      {
        id: 'SCH_BULK_02',
        classId: testClassId,
        teacherId: testTeacherId,
        roomId: testRoomId,
        date: D05,
        shiftId: 1,
        startTime: '08:00',
        endTime: '10:00',
        subject: 'Toán Học Đại Số',
        status: 'Đã lên lịch',
      },
      {
        id: 'SCH_BULK_03',
        classId: testClassId,
        teacherId: testTeacherId,
        roomId: testRoomId,
        date: D10,
        shiftId: 1,
        startTime: '08:00',
        endTime: '10:00',
        subject: 'Toán Học Đại Số',
        status: 'Đã lên lịch',
      },
      {
        id: 'SCH_BULK_04',
        classId: testClassId,
        teacherId: testTeacherId,
        roomId: testRoomId,
        date: D15,
        shiftId: 1,
        startTime: '08:00',
        endTime: '10:00',
        subject: 'Toán Học Đại Số',
        status: 'Đã hủy', // Đã hủy nên không được cập nhật
      },
    ];

    for (const slot of slots) {
      await repo.createScheduleSlot(slot);
    }

    const created = await repo.getScheduleSlotById('SCH_BULK_01');
    assert.ok(created, 'Slot SCH_BULK_01 phải được tạo thành công');
  });

  it('1. Tính năng 1: Thay đổi lịch/ca học hàng loạt TỪ NAY VỀ SAU cho lớp học (Future Bulk Update)', async () => {
    // Dời từ ngày D05 trở đi sang Ca 2 (10:15 - 12:15) và đổi sang phòng ROOM_BULK_B
    const req = new Request('http://localhost/api/schedule/bulk-update-future', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: testClassId,
        fromDate: D05,
        targetShiftId: 2,
        targetRoomId: 'ROOM_BULK_B',
        targetTeacherId: 'GV_BULK_02',
      }),
    });

    const res = await bulkUpdateFuture(req);
    const data = await res.json();
    assert.ok(data.success);
    // Có 2 slot thỏa mãn date >= D05 và status !== 'Đã hủy' là SCH_BULK_02 và SCH_BULK_03
    assert.equal(data.updatedCount, 2);

    // Slot 01 giữ nguyên
    const slot01 = await repo.getScheduleSlotById('SCH_BULK_01');
    assert.equal(slot01?.shiftId, 1);
    assert.equal(slot01?.roomId, testRoomId);
    assert.equal(slot01?.teacherId, testTeacherId);

    // Slot 02 cập nhật Ca 2, giờ 10:15 - 12:15, phòng B, GV 02
    const slot02 = await repo.getScheduleSlotById('SCH_BULK_02');
    assert.equal(slot02?.shiftId, 2);
    assert.equal(slot02?.startTime, '10:15');
    assert.equal(slot02?.endTime, '12:15');
    assert.equal(slot02?.roomId, 'ROOM_BULK_B');
    assert.equal(slot02?.teacherId, 'GV_BULK_02');

    // Slot 03 cũng được cập nhật
    const slot03 = await repo.getScheduleSlotById('SCH_BULK_03');
    assert.equal(slot03?.shiftId, 2);
    assert.equal(slot03?.roomId, 'ROOM_BULK_B');

    // Slot 04 trạng thái 'Đã hủy' không bị đổi
    const slot04 = await repo.getScheduleSlotById('SCH_BULK_04');
    assert.equal(slot04?.status, 'Đã hủy');
    assert.equal(slot04?.shiftId, 1);

    // Kiểm tra Audit Log
    const logs = await repo.getAllAuditLogs();
    const futureLog = logs.find(l => l.targetId === testClassId && l.details.includes(`Thay đổi lịch từ ngày ${D05} về sau`));
    assert.ok(futureLog, 'Phải có AuditLog cho future bulk update');
  });

  it('2. Tính năng 2: Thao tác thay đổi hàng loạt THEO NGÀY (Daily Bulk Operations)', async () => {
    // 2.1 RESCHEDULE_DAY: Dời toàn bộ ca của ngày D01 sang ngày D02
    const reqReschedule = new Request('http://localhost/api/schedule/bulk-daily-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentDate: D01,
        action: 'RESCHEDULE_DAY',
        targetDate: D02,
      }),
    });
    const resReschedule = await bulkDailyAction(reqReschedule);
    const dataReschedule = await resReschedule.json();
    assert.ok(dataReschedule.success);
    assert.equal(dataReschedule.affectedCount, 1);

    const slot01After = await repo.getScheduleSlotById('SCH_BULK_01');
    assert.equal(slot01After?.date, D02);

    // 2.2 SHIFT_MIGRATION: Chuyển ca trong ngày (dời ca 1 sang ca 3 trong ngày D02)
    const reqShiftMigrate = new Request('http://localhost/api/schedule/bulk-daily-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentDate: D02,
        action: 'SHIFT_MIGRATION',
        fromShiftId: 1,
        toShiftId: 3,
      }),
    });
    const resShiftMigrate = await bulkDailyAction(reqShiftMigrate);
    const dataShiftMigrate = await resShiftMigrate.json();
    assert.ok(dataShiftMigrate.success);
    assert.equal(dataShiftMigrate.affectedCount, 1);

    const slot01Shift3 = await repo.getScheduleSlotById('SCH_BULK_01');
    assert.equal(slot01Shift3?.shiftId, 3);
    assert.equal(slot01Shift3?.startTime, '13:30');
    assert.equal(slot01Shift3?.endTime, '15:30');

    // 2.3 ROOM_MIGRATION: Chuyển sang phòng ROOM_LAB_X trong ngày D02
    const reqRoom = new Request('http://localhost/api/schedule/bulk-daily-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentDate: D02,
        action: 'ROOM_MIGRATION',
        targetRoomId: 'ROOM_LAB_X',
      }),
    });
    const resRoom = await bulkDailyAction(reqRoom);
    const dataRoom = await resRoom.json();
    assert.ok(dataRoom.success);
    assert.equal(dataRoom.affectedCount, 1);

    const slot01RoomX = await repo.getScheduleSlotById('SCH_BULK_01');
    assert.equal(slot01RoomX?.roomId, 'ROOM_LAB_X');

    // 2.4 CANCEL_DAY: Hủy tất cả các ca trong ngày D02
    const reqCancel = new Request('http://localhost/api/schedule/bulk-daily-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentDate: D02,
        action: 'CANCEL_DAY',
      }),
    });
    const resCancel = await bulkDailyAction(reqCancel);
    const dataCancel = await resCancel.json();
    assert.ok(dataCancel.success);
    assert.equal(dataCancel.affectedCount, 1);

    const slot01Cancelled = await repo.getScheduleSlotById('SCH_BULK_01');
    assert.equal(slot01Cancelled?.status, 'Đã hủy');
  });

  it('3. Tính năng 3: Thay đổi số lượng ca & thời gian các ca hàng loạt (Bulk Shifts Configuration & Future Sync)', async () => {
    // Trước khi đổi: Slot 02 và Slot 03 đang là Ca 2 (10:15 - 12:15)
    // Cập nhật Ca 2 thành 10:30 - 12:30 qua ShiftService.bulkUpdateShifts với syncFutureSlots = true
    const currentShifts = await ShiftService.getAllShifts();
    const updatedList: TimeShift[] = currentShifts.map(s => {
      if (s.id === 2) {
        return {
          ...s,
          name: 'Ca 2 Giờ Mới (10:30 - 12:30)',
          startTime: '10:30',
          endTime: '12:30',
        };
      }
      return s;
    });

    // Gọi qua API POST /api/shifts với bulkShifts
    const req = new Request('http://localhost/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bulkShifts: updatedList,
        syncFutureSlots: true,
      }),
    });

    const res = await shiftsPost(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.ok(data.syncedSlotsCount >= 2, 'Ít nhất 2 ca tương lai (SCH_BULK_02, SCH_BULK_03) phải được đồng bộ giờ mới');

    // Kiểm tra trực tiếp ca học
    const slot02 = await repo.getScheduleSlotById('SCH_BULK_02');
    assert.equal(slot02?.startTime, '10:30');
    assert.equal(slot02?.endTime, '12:30');

    const slot03 = await repo.getScheduleSlotById('SCH_BULK_03');
    assert.equal(slot03?.startTime, '10:30');
    assert.equal(slot03?.endTime, '12:30');

    // Kiểm tra AuditLog
    const logs = await repo.getAllAuditLogs();
    const bulkShiftLog = logs.find(l => l.targetResource === 'SCHEDULE' && l.targetId === 'BULK_SHIFTS');
    assert.ok(bulkShiftLog, 'Phải ghi nhận AuditLog khi cập nhật cấu hình ca hàng loạt');
  });
});
