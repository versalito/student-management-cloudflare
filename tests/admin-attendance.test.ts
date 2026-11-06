import test from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import { AttendanceRecord, AttendanceStatus } from '../src/types/attendance';
import { GET, POST } from '../src/app/api/attendance/route';
import { authed, sessionCookie } from './helpers/auth';

test('Admin Attendance & Makeup Attendance Suite: Kiểm tra toàn bộ Giai đoạn 1', async (t) => {
  await t.test('1. Kiểm tra interface AttendanceRecord và các trường mới (checkinTime, originalSlotId, makeupReason, method)', async () => {
    const record: AttendanceRecord = {
      id: 'ATT_TEST_001',
      scheduleSlotId: 'SCH0001',
      classId: 'CLS0001',
      studentId: 'ST0001',
      date: '2026-09-20',
      status: 'Điểm danh bù',
      checkinTime: '08:15:30',
      originalSlotId: 'SCH0099',
      makeupReason: 'Bị ốm có đơn phép',
      method: 'MANUAL',
      updatedBy: 'ADMIN001',
      updatedAt: new Date().toISOString(),
    };

    assert.equal(record.status, 'Điểm danh bù');
    assert.equal(record.originalSlotId, 'SCH0099');
    assert.equal(record.makeupReason, 'Bị ốm có đơn phép');
    assert.equal(record.method, 'MANUAL');
    assert.equal(record.checkinTime, '08:15:30');
  });

  await t.test('2. Repository get & save lưu trữ nguyên vẹn các trường mới', async () => {
    const testRecord: AttendanceRecord = {
      id: 'ATT_TEST_REPO_002',
      scheduleSlotId: 'SCH0002',
      classId: 'CLS0001',
      studentId: 'ST0002',
      date: '2026-09-20',
      status: 'Điểm danh bù',
      checkinTime: '14:02:15',
      note: 'Điểm danh bù cho ca hôm qua',
      originalSlotId: 'SCH0055',
      makeupReason: 'Trùng lịch thi',
      method: 'MANUAL',
      updatedBy: 'ADMIN001',
      updatedAt: new Date().toISOString(),
    };

    await repo.saveAttendanceRecord(testRecord);

    const bySlot = await repo.getAttendanceBySlotId('SCH0002');
    const found = bySlot.find(r => r.id === 'ATT_TEST_REPO_002');
    assert.ok(found, 'Phải tìm thấy bản ghi theo slotId');
    assert.equal(found?.status, 'Điểm danh bù');
    assert.equal(found?.originalSlotId, 'SCH0055');
    assert.equal(found?.makeupReason, 'Trùng lịch thi');
    assert.equal(found?.checkinTime, '14:02:15');
    assert.equal(found?.method, 'MANUAL');
  });

  await t.test('3. API GET /api/attendance hỗ trợ lọc kết hợp slotId, classId, date', async () => {
    const slotId = 'SCH0003';
    const classId = 'CLS0002';
    const date = '2026-09-20';

    const testRecords: AttendanceRecord[] = [
      {
        id: 'ATT_API_001',
        scheduleSlotId: slotId,
        classId: classId,
        studentId: 'ST0003',
        date: date,
        status: 'Có mặt',
        checkinTime: '08:00:00',
        method: 'MANUAL',
        updatedBy: 'ADMIN001',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ATT_API_002',
        scheduleSlotId: slotId,
        classId: classId,
        studentId: 'ST0004',
        date: date,
        status: 'Điểm danh bù',
        checkinTime: '08:05:00',
        originalSlotId: 'SCH0011',
        makeupReason: 'Đổi ca học',
        method: 'MANUAL',
        updatedBy: 'ADMIN001',
        updatedAt: new Date().toISOString(),
      }
    ];

    await repo.saveAttendanceBatch(testRecords);

    // Test GET by slotId
    const reqSlot = authed(`http://localhost:3000/api/attendance?slotId=${slotId}`);
    const resSlot = await GET(reqSlot);
    const dataSlot = await resSlot.json();
    assert.ok(Array.isArray(dataSlot.records));
    assert.ok(dataSlot.records.some((r: any) => r.id === 'ATT_API_001'));
    assert.ok(dataSlot.records.some((r: any) => r.id === 'ATT_API_002'));

    // Test GET by classId and date
    const reqClassDate = authed(`http://localhost:3000/api/attendance?classId=${classId}&date=${date}`);
    const resClassDate = await GET(reqClassDate);
    const dataClassDate = await resClassDate.json();
    assert.ok(dataClassDate.records.length > 0);
    assert.ok(dataClassDate.records.every((r: any) => r.date === date));
  });

  await t.test('4. API POST /api/attendance batch lưu thành công và ghi nhận Audit Log cho Admin', async () => {
    const batchRecords: AttendanceRecord[] = [
      {
        id: 'ATT_BATCH_001',
        scheduleSlotId: 'SCH0004',
        classId: 'CLS0003',
        studentId: 'ST0010',
        date: '2026-09-20',
        status: 'Có mặt',
        checkinTime: '09:00:00',
        method: 'MANUAL',
        updatedBy: 'ADMIN001',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ATT_BATCH_002',
        scheduleSlotId: 'SCH0004',
        classId: 'CLS0003',
        studentId: 'ST0011',
        date: '2026-09-20',
        status: 'Điểm danh bù',
        checkinTime: '09:10:00',
        originalSlotId: 'SCH0012',
        makeupReason: 'Học bù do bận thi',
        method: 'MANUAL',
        updatedBy: 'ADMIN001',
        updatedAt: new Date().toISOString(),
      },
    ];

    const reqPost = authed('http://localhost:3000/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: batchRecords,
        slotId: 'SCH0004',
        updatedBy: 'ADMIN001',
        updaterName: 'Quản trị viên',
      }),
    });

    const resPost = await POST(reqPost);
    const dataPost = await resPost.json();

    assert.equal(resPost.status, 200);
    assert.equal(dataPost.success, true);
    assert.equal(dataPost.count, 2);

    // Kiểm tra Audit Log
    const logs = await repo.getAllAuditLogs();
    const latestLog = logs.find(l => l.targetId === 'SCH0004' && l.action === 'ATTENDANCE_CHECK');
    assert.ok(latestLog, 'Phải có Audit Log ghi lại hành động điểm danh');
    assert.equal(latestLog?.userRole, 'ADMIN');
    assert.equal(latestLog?.userId, 'ADMIN001');
  });
});
