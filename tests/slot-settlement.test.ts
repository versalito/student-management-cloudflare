import test from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import { GET, POST } from '../src/app/api/attendance/route';
import { TuitionPayrollService } from '../src/services/TuitionPayrollService';
import { authed } from './helpers/auth';
import { getTodayDateStr } from '../src/utils/date';
import type { ScheduleSlot } from '../src/types/schedule';

/**
 * Lỗi thật trên production 2026-11-07: 153 buổi đã qua, **0 buổi** ở trạng thái
 * `Đã hoàn thành` và 0 `checkin_time`, nên `GET /api/payroll?month=2026-10` trả
 * `grossSalary: 0` cho mọi giáo viên dù sổ điểm danh vẫn được ghi. Nguyên nhân:
 * chỉ luồng `/api/teacher-checkin` CHECKOUT mới ghi `Đã hoàn thành`.
 *
 * Test này khoá hành vi mới: ghi sổ điểm danh cho một buổi **đã kết thúc** phải
 * tự chốt buổi sang `Đã hoàn thành`, để lương giáo viên tính được.
 */
test('Chốt buổi từ sổ điểm danh: lương giáo viên không còn bằng 0', async (t) => {
  const teacher = await repo.getTeacherById('GV001');
  assert.ok(teacher, 'seed phải có GV001');

  // Buổi đã qua hẳn (7 ngày trước), chưa chốt, chưa ai check-in.
  const pastDate = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const pastDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' }).format(pastDate);
  const slot: ScheduleSlot = {
    id: 'SCH_SETTLE_001',
    classId: 'CLS0001',
    teacherId: 'GV001',
    date: pastDateStr,
    shiftId: 1,
    subject: 'Toán',
    startTime: '18:00',
    endTime: '19:30',
    status: 'Đã lên lịch',
  };
  await repo.createScheduleSlot(slot);

  await t.test('trước khi ghi sổ: buổi chưa chốt và lương tháng = 0', async () => {
    const stored = await repo.getScheduleSlotById('SCH_SETTLE_001');
    assert.equal(stored?.status, 'Đã lên lịch');

    const month = pastDateStr.slice(0, 7);
    const payroll = await new TuitionPayrollService(repo).calculateTeacherPayroll('GV001', month);
    assert.equal(payroll.totalSlots, 0);
    assert.equal(payroll.grossSalary, 0);
  });

  await t.test('ghi sổ điểm danh buổi đã kết thúc → buổi tự chốt Đã hoàn thành', async () => {
    const res = await POST(
      authed('http://localhost:3000/api/attendance', {
        method: 'POST',
        body: JSON.stringify({
          record: {
            id: 'ATT_SETTLE_001',
            scheduleSlotId: 'SCH_SETTLE_001',
            classId: 'CLS0001',
            studentId: 'ST0001',
            date: pastDateStr,
            status: 'Có mặt',
            method: 'MANUAL',
            updatedBy: 'FAKE_CLIENT_ID',
            updatedAt: new Date().toISOString(),
          },
        }),
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const stored = await repo.getScheduleSlotById('SCH_SETTLE_001');
    assert.equal(stored?.status, 'Đã hoàn thành', 'buổi đã qua + có điểm danh phải được chốt');
  });

  await t.test('sau khi chốt: lương tháng tính đúng 1 buổi', async () => {
    const month = pastDateStr.slice(0, 7);
    const payroll = await new TuitionPayrollService(repo).calculateTeacherPayroll('GV001', month);
    assert.equal(payroll.totalSlots, 1);
    assert.equal(payroll.grossSalary, teacher.ratePerSession || teacher.hourlyRate);
    assert.ok(payroll.grossSalary > 0, 'lương phải > 0 sau khi buổi được chốt');
  });

  await t.test('buổi hôm nay chưa kết thúc thì KHÔNG chốt (giáo viên còn check-in)', async () => {
    const today = getTodayDateStr();
    const futureSlot: ScheduleSlot = {
      ...slot,
      id: 'SCH_SETTLE_002',
      date: today,
      startTime: '23:30',
      endTime: '23:59',
      status: 'Đã lên lịch',
    };
    await repo.createScheduleSlot(futureSlot);

    await POST(
      authed('http://localhost:3000/api/attendance', {
        method: 'POST',
        body: JSON.stringify({
          record: {
            id: 'ATT_SETTLE_002',
            scheduleSlotId: 'SCH_SETTLE_002',
            classId: 'CLS0001',
            studentId: 'ST0001',
            date: today,
            status: 'Có mặt',
            method: 'MANUAL',
            updatedBy: 'ADMIN001',
            updatedAt: new Date().toISOString(),
          },
        }),
      }),
    );

    const stored = await repo.getScheduleSlotById('SCH_SETTLE_002');
    assert.equal(stored?.status, 'Đã lên lịch', 'buổi chưa kết thúc không được tự chốt');
  });

  await t.test('buổi đã hủy không bị chốt đè', async () => {
    const cancelled: ScheduleSlot = {
      ...slot,
      id: 'SCH_SETTLE_003',
      status: 'Đã hủy',
    };
    await repo.createScheduleSlot(cancelled);

    await POST(
      authed('http://localhost:3000/api/attendance', {
        method: 'POST',
        body: JSON.stringify({
          record: {
            id: 'ATT_SETTLE_003',
            scheduleSlotId: 'SCH_SETTLE_003',
            classId: 'CLS0001',
            studentId: 'ST0001',
            date: pastDateStr,
            status: 'Có mặt',
            method: 'MANUAL',
            updatedBy: 'ADMIN001',
            updatedAt: new Date().toISOString(),
          },
        }),
      }),
    );

    const stored = await repo.getScheduleSlotById('SCH_SETTLE_003');
    assert.equal(stored?.status, 'Đã hủy');
  });
});
