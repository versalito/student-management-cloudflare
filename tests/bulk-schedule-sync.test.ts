import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { BulkScheduleService } from '../src/services/BulkScheduleService';
import { POST as bulkGenerateRoute } from '../src/app/api/schedule/bulk-generate/route';
import { POST as createClassRoute, PUT as updateClassRoute, DELETE as deleteClassRoute } from '../src/app/api/classes/route';
import { authed, sessionCookie } from './helpers/auth';

test('Bulk Schedule Generation & 2-Way Sync Suite', async (t) => {
  const repo = LocalRepository.getInstance();
  const bulkService = new BulkScheduleService(repo);

  await t.test('1. Kiểm thử sinh lịch lặp định kỳ (Thứ 2-4-6) trong 1 khoảng thời gian', async () => {
    // Tạo 1 lớp thử nghiệm: CLS_TEST_RECURRING
    const testClass = {
      id: 'CLS_TEST_REC',
      code: 'REC101',
      name: 'Lớp Lập trình Python Căn bản',
      subject: 'Python Cơ bản',
      teacherId: 'GV001',
      studentIds: [],
      tuitionFee: 2000000,
      scheduleDays: [2, 4, 6], // Thứ 2, 4, 6
      shiftId: 1,
      meetingLink: 'https://meet.google.com/test-room',
      status: 'Đang mở' as const,
      createdAt: new Date().toISOString(),
    };
    await repo.createClass(testClass);

    // Xóa các slot cũ của lớp này nếu có
    const allSlots = await repo.getAllScheduleSlots();
    for (const slot of allSlots) {
      if (slot.classId === 'CLS_TEST_REC') {
        slot.status = 'Đã hủy';
        await repo.updateScheduleSlot(slot);
      }
    }

    // Khoảng thời gian: từ 2026-10-01 đến 2026-10-31 (tháng 10/2026)
    // 2026-10-01 là Thứ 5 (day 5)
    // Đếm các ngày T2, T4, T6 trong tháng 10/2026:
    // T2 (Mon): 5, 12, 19, 26 (4 ngày)
    // T4 (Wed): 7, 14, 21, 28 (4 ngày)
    // T6 (Fri): 2, 9, 16, 23, 30 (5 ngày)
    // Tổng cộng: 4 + 4 + 5 = 13 ngày
    const result = await bulkService.generateRecurringSlots({
      classIds: ['CLS_TEST_REC'],
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      overwriteExisting: false,
      actorId: 'ADMIN001',
    });

    assert.equal(result.summary.createdCount, 13, 'Phải sinh đúng 13 ca học cho Thứ 2, 4, 6 trong tháng 10/2026');
    assert.equal(result.createdSlots.length, 13);
    assert.equal(result.summary.conflictCount, 0);

    // Kiểm tra slot mẫu
    const firstSlot = result.createdSlots[0];
    assert.equal(firstSlot.classId, 'CLS_TEST_REC');
    assert.equal(firstSlot.date, '2026-10-02'); // Ngày T6 đầu tiên
    assert.equal(firstSlot.teacherId, 'GV001');
    assert.equal(firstSlot.shiftId, 1);

    // Kiểm tra nếu chạy lại với overwriteExisting = false -> skippedCount = 13
    const rerunResult = await bulkService.generateRecurringSlots({
      classIds: ['CLS_TEST_REC'],
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      overwriteExisting: false,
    });
    assert.equal(rerunResult.summary.skippedCount, 13, 'Phải bỏ qua 13 ca đã có sẵn');
    assert.equal(rerunResult.summary.createdCount, 0);
  });

  await t.test('2. Kiểm thử API POST /api/schedule/bulk-generate', async () => {
    // Tạo thêm lớp CLS_TEST_API
    const testClass = {
      id: 'CLS_TEST_API',
      code: 'API102',
      name: 'Lớp Thiết kế Đồ họa AI',
      subject: 'Photoshop AI',
      teacherId: 'GV002',
      studentIds: [],
      tuitionFee: 1800000,
      scheduleDays: [3, 5], // Thứ 3, Thứ 5
      shiftId: 2,
      status: 'Đang mở' as const,
      createdAt: new Date().toISOString(),
    };
    await repo.createClass(testClass);

    const req = authed('http://localhost/api/schedule/bulk-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classIds: ['CLS_TEST_API'],
        startDate: '2026-11-01',
        endDate: '2026-11-15',
        actorId: 'ADMIN001',
      }),
    });

    const res = await bulkGenerateRoute(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.ok(data.summary);
    assert.ok(data.summary.createdCount > 0);
  });

  await t.test('3. Kiểm thử tạo lớp mới với autoGenerateSchedule = true', async () => {
    const req = authed('http://localhost/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lớp Test Tự Động Sinh Lịch',
        code: 'AUTOGEN1',
        subject: 'ReactJS Nâng Cao',
        teacherId: 'GV003',
        shiftId: 3,
        scheduleDays: [2, 4, 6],
        tuitionFee: 2500000,
        autoGenerateSchedule: true,
        generateMonths: 1,
      }),
    });

    const res = await createClassRoute(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.ok(data.class);
    assert.ok(data.bulkScheduleResult, 'Phải có kết quả bulkScheduleResult');
    assert.ok(data.bulkScheduleResult.summary.createdCount > 0, 'Phải tự động sinh được các ca học');

    const createdClassId = data.class.id;
    const slots = await repo.getScheduleSlotsByClassId(createdClassId);
    assert.ok(slots.length > 0, 'Lớp mới phải có các ca học trong repo');
  });

  await t.test('4. Kiểm thử đồng bộ 2 chiều: Khi đổi giáo viên/ca thì các ca tương lai (date >= today) đổi theo', async () => {
    const today = new Date().toISOString().split('T')[0];
    const testClassId = 'CLS_SYNC_TEST';

    // Tạo lớp mẫu
    const cls = {
      id: testClassId,
      code: 'SYN101',
      name: 'Lớp Test Đồng Bộ',
      subject: 'Tiếng Anh Giao Tiếp',
      teacherId: 'GV001',
      studentIds: [],
      tuitionFee: 1500000,
      scheduleDays: [2, 4, 6],
      shiftId: 1,
      meetingLink: 'https://old-link.com',
      status: 'Đang mở' as const,
      createdAt: new Date().toISOString(),
    };
    await repo.createClass(cls);

    // Tạo 1 ca trong quá khứ (2026-01-01) và 2 ca trong tương lai (2029-12-01, 2029-12-03)
    await repo.createScheduleSlot({
      id: 'SCH_PAST_01',
      classId: testClassId,
      teacherId: 'GV001',
      date: '2026-01-01',
      shiftId: 1,
      startTime: '08:00',
      endTime: '10:00',
      subject: 'Tiếng Anh Giao Tiếp',
      meetingLink: 'https://old-link.com',
      status: 'Đã hoàn thành',
    });

    await repo.createScheduleSlot({
      id: 'SCH_FUT_01',
      classId: testClassId,
      teacherId: 'GV001',
      date: '2029-12-01',
      shiftId: 1,
      startTime: '08:00',
      endTime: '10:00',
      subject: 'Tiếng Anh Giao Tiếp',
      meetingLink: 'https://old-link.com',
      status: 'Đã lên lịch',
    });

    await repo.createScheduleSlot({
      id: 'SCH_FUT_02',
      classId: testClassId,
      teacherId: 'GV001',
      date: '2029-12-03',
      shiftId: 1,
      startTime: '08:00',
      endTime: '10:00',
      subject: 'Tiếng Anh Giao Tiếp',
      meetingLink: 'https://old-link.com',
      status: 'Đã lên lịch',
    });

    // Cập nhật lớp: Đổi sang GV002, shift 2, link mới
    const req = authed('http://localhost/api/classes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: testClassId,
        teacherId: 'GV002',
        shiftId: 2,
        meetingLink: 'https://new-link.com/room',
      }),
    });

    const res = await updateClassRoute(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.ok(data.syncedSlotsCount >= 2, 'Phải đồng bộ ít nhất 2 ca tương lai');

    // Kiểm tra ca trong quá khứ không bị đổi teacherId
    const pastSlot = await repo.getScheduleSlotById('SCH_PAST_01');
    assert.equal(pastSlot?.teacherId, 'GV001', 'Ca trong quá khứ không được đổi teacherId');

    // Kiểm tra ca tương lai được cập nhật toàn diện
    const fut1 = await repo.getScheduleSlotById('SCH_FUT_01');
    assert.equal(fut1?.teacherId, 'GV002');
    assert.equal(fut1?.shiftId, 2);
    assert.equal(fut1?.meetingLink, 'https://new-link.com/room');

    const fut2 = await repo.getScheduleSlotById('SCH_FUT_02');
    assert.equal(fut2?.teacherId, 'GV002');
    assert.equal(fut2?.shiftId, 2);
  });

  await t.test('5. Kiểm thử xóa lớp thì tự động xóa hoặc hủy các ca tương lai', async () => {
    const delClassId = 'CLS_DEL_TEST';
    await repo.createClass({
      id: delClassId,
      code: 'DEL101',
      name: 'Lớp Chuẩn Bị Xóa',
      subject: 'Kiểm thử Xóa',
      teacherId: 'GV001',
      studentIds: [],
      tuitionFee: 1000000,
      scheduleDays: [2, 4],
      shiftId: 1,
      status: 'Đang mở' as const,
    });

    // Tạo 1 ca tương lai
    await repo.createScheduleSlot({
      id: 'SCH_DEL_FUT',
      classId: delClassId,
      teacherId: 'GV001',
      date: '2029-12-10',
      shiftId: 1,
      startTime: '08:00',
      endTime: '10:00',
      subject: 'Kiểm thử Xóa',
      status: 'Đã lên lịch',
    });

    const req = authed(`http://localhost/api/classes?id=${delClassId}`, {
      method: 'DELETE',
    });

    const res = await deleteClassRoute(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.ok(data.cancelledSlotsCount >= 1, 'Phải đánh dấu hủy ca tương lai');

    // Kiểm tra slot tương lai đã được chuyển sang 'Đã hủy'
    const futSlot = await repo.getScheduleSlotById('SCH_DEL_FUT');
    assert.equal(futSlot?.status, 'Đã hủy', 'Ca tương lai phải có status Đã hủy');

    // Kiểm tra lớp đã bị xóa
    const deletedClass = await repo.getClassById(delClassId);
    assert.equal(deletedClass, null, 'Lớp phải không còn trong repo');
  });
});
