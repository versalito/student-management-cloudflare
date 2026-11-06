import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import { ConflictEngine } from '../src/services/ConflictEngine';
import { getTodayDateStr, getNowTimeStr } from '../src/utils/date';
import { GET as getAttendanceRoute } from '../src/app/api/attendance/route';
import { authed, sessionCookie } from './helpers/auth';

describe('System Logic Refinement Suite: Time Overlap, Asia/Saigon Timezone & Attendance Roster', () => {
  it('1. ConflictEngine: Phát hiện trùng lớp khi cùng một lớp bị xếp 2 ca giao nhau về giờ thực tế', async () => {
    const engine = new ConflictEngine(repo);
    const testDate = '2026-11-25';

    await repo.createScheduleSlot({
      id: 'SCH_OVERLAP_1',
      classId: 'CLS01',
      teacherId: 'GV001',
      date: testDate,
      shiftId: 1,
      startTime: '18:00',
      endTime: '20:00',
      subject: 'Vẽ Tượng',
      status: 'Đã lên lịch'
    });

    const conflictResult = await engine.checkScheduleConflict({
      classId: 'CLS01', // Cùng lớp bị xếp trùng giờ
      teacherId: 'GV002',
      date: testDate,
      shiftId: 2,
      startTime: '19:00',
      endTime: '21:00',
      subject: 'Bố cục màu',
      status: 'Đã lên lịch'
    });

    assert.equal(conflictResult.hasConflict, true, 'Phải phát hiện xung đột trùng lớp khi cùng lớp xếp trùng giờ');
    assert.equal(conflictResult.conflicts[0].type, 'CLASS_CONFLICT');
  });

  it('2. Date Utilities: getTodayDateStr và getNowTimeStr định dạng chuẩn', () => {
    const today = getTodayDateStr();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'Phải có định dạng YYYY-MM-DD');

    const nowTime = getNowTimeStr();
    assert.match(nowTime, /^\d{2}:\d{2}$/, 'Phải có định dạng HH:mm');
  });

  it('3. Attendance API: Tự động hợp nhất học sinh mới thêm vào lớp vào danh sách điểm danh của slot', async () => {
    const classId = 'CLS_ROSTER_SYNC_TEST';
    const slotId = 'SCH_ROSTER_SYNC_TEST';
    const newStudentId = 'ST_ROSTER_NEW';

    // Tạo lớp có 1 học sinh mới
    await repo.createClass({
      id: classId,
      code: 'RST101',
      name: 'Lớp Test Roster Điểm Danh',
      subject: 'Toán',
      teacherId: 'GV001',
      startTime: '18:30',
      endTime: '20:30',
      scheduleDays: [2, 4, 6],
      tuitionFee: 1000000,
      studentIds: [newStudentId],
      status: 'Đang mở',
    });

    // Tạo slot cho lớp đó nhưng chưa có bản ghi điểm danh nào
    await repo.createScheduleSlot({
      id: slotId,
      classId: classId,
      teacherId: 'GV001',
      date: '2026-11-27',
      shiftId: 1,
      startTime: '18:30',
      endTime: '20:30',
      subject: 'Toán',
      status: 'Đã lên lịch'
    });

    // Gọi GET /api/attendance?slotId=...
    const req = authed(`http://localhost/api/attendance?slotId=${slotId}`);
    const res = await getAttendanceRoute(req);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(data.records));
    assert.ok(data.records.some((r: any) => r.studentId === newStudentId), 'Học sinh mới trong lớp phải tự động xuất hiện trong roster điểm danh');
  });
});
