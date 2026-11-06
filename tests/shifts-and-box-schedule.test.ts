import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ShiftService } from '../src/services/ShiftService';
import { GET as getShifts, PUT as updateShift, POST as createShift, DELETE as deleteShift } from '../src/app/api/shifts/route';
import { POST as enrollClass } from '../src/app/api/classes/enroll/route';
import { PUT as updateClassTeacher } from '../src/app/api/classes/route';
import { repo } from '../src/repositories';
import { authed, authedAsStudent, sessionCookie } from './helpers/auth';

describe('Dynamic Shifts & Schedule Box Suite', () => {
  it('1. Đọc danh sách ca học mặc định từ ShiftService', async () => {
    ShiftService.resetDefaults();
    const shifts = await ShiftService.getAllShifts();
    assert.equal(shifts.length, 5);
    assert.equal(shifts[0].name, 'Ca 1 (08:00 - 10:00)');
    assert.equal(shifts[0].startTime, '08:00');
    assert.equal(shifts[0].endTime, '10:00');
  });

  it('2. API GET /api/shifts trả về danh sách ca học', async () => {
    await ShiftService.resetDefaults();
    const res = await getShifts(authed('http://localhost/api/shifts'));
    const data = await res.json();
    assert.ok(data.success);
    assert.ok(Array.isArray(data.shifts));
    assert.equal(data.shifts.length, 5);
  });

  it('3. API PUT /api/shifts cập nhật khung giờ ca học (sửa Ca 1 thành 08:30 - 10:30)', async () => {
    const req = authed('http://localhost/api/shifts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shiftId: 1,
        name: 'Ca 1 Buổi Sáng',
        startTime: '08:30',
        endTime: '10:30',
      }),
    });
    const res = await updateShift(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.equal(data.shift.startTime, '08:30');
    assert.equal(data.shift.endTime, '10:30');
    assert.equal(data.shift.name, 'Ca 1 Buổi Sáng');

    const updated = await ShiftService.getShiftById(1);
    assert.equal(updated?.startTime, '08:30');
  });

  it('4. API POST /api/shifts thêm ca học mới (Ca 6)', async () => {
    const req = authed('http://localhost/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shiftNumber: 6,
        name: 'Ca 6 Buổi Tối Muộn',
        startTime: '20:45',
        endTime: '22:45',
      }),
    });
    const res = await createShift(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.equal(data.shift.id, 6);
    assert.equal(data.shift.startTime, '20:45');
    assert.equal(data.shift.endTime, '22:45');

    const shifts = await ShiftService.getAllShifts();
    assert.ok(shifts.some(s => s.name === 'Ca 6 Buổi Tối Muộn'));
  });

  it('5. Kiểm tra ghi nhận Audit Log khi thay đổi khung giờ ca học', async () => {
    const logs = await repo.getAllAuditLogs();
    const shiftLog = logs.find(l => l.targetResource === 'SCHEDULE' && l.targetId.startsWith('SHIFT_'));
    assert.ok(shiftLog, 'Phải có Audit Log ghi nhận thay đổi khung giờ ca học');
  });

  it('6. Luồng học sinh đăng ký chọn ca học (ENROLL) và đổi ca khác (UNENROLL)', async () => {
    const testClassId = 'CLS02';
    const testStudentId = 'ST002';

    // 6.0 Dữ liệu seed: ST002 đang học CLS01 (Toán, Thứ 2-4-6, Ca 1) trùng giờ với CLS02.
    // Trước khi đăng ký ca mới, hủy lớp trùng giờ hiện tại để giải phóng lịch.
    const reqUnenrollConflicting = authed('http://localhost/api/classes/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: 'CLS01',
        studentId: testStudentId,
        action: 'UNENROLL',
        actorId: testStudentId,
      }),
    });
    await enrollClass(reqUnenrollConflicting);

    // 6.1 Ghi danh / Chọn ca này
    const reqEnroll = authed('http://localhost/api/classes/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: testClassId,
        studentId: testStudentId,
        action: 'ENROLL',
        actorId: testStudentId,
      }),
    });
    const resEnroll = await enrollClass(reqEnroll);
    const dataEnroll = await resEnroll.json();
    assert.ok(dataEnroll.success, 'Đăng ký ca học phải thành công khi không trùng giờ');

    const updatedCls = await repo.getClassById(testClassId);
    assert.ok(updatedCls?.studentIds.includes(testStudentId), 'Học viên phải có trong danh sách studentIds của lớp');

    // 6.2 Hủy ca / Đổi ca khác
    const reqUnenroll = authed('http://localhost/api/classes/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: testClassId,
        studentId: testStudentId,
        action: 'UNENROLL',
        actorId: testStudentId,
      }),
    });
    const resUnenroll = await enrollClass(reqUnenroll);
    const dataUnenroll = await resUnenroll.json();
    assert.ok(dataUnenroll.success, 'Hủy / đổi ca phải thành công');

    const clsAfterUnenroll = await repo.getClassById(testClassId);
    assert.ok(!clsAfterUnenroll?.studentIds.includes(testStudentId), 'Học viên phải được xoá khỏi lớp');
  });

  it('6b. Học sinh tự đăng ký ca TRÙNG GIỜ với lớp đã enrolled vẫn được phép', async () => {
    const testStudentId = 'ST003';
    // ST003 theo seed học CLS01 (Toán, Thứ 2-4-6, Ca 1). CLS02 (Tiếng Anh) trùng ngày + trùng giờ.
    const reqEnroll = authedAsStudent(testStudentId)('http://localhost/api/classes/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: 'CLS02',
        studentId: testStudentId,
        action: 'ENROLL',
      }),
    });
    const resEnroll = await enrollClass(reqEnroll);
    const dataEnroll = await resEnroll.json();
    assert.equal(resEnroll.status, 200, 'Học sinh tự đăng ký không bị chặn vì trùng giờ');
    assert.ok(dataEnroll.success, 'Đăng ký phải thành công: ' + JSON.stringify(dataEnroll));

    const cls = await repo.getClassById('CLS02');
    assert.ok(cls?.studentIds.includes(testStudentId), 'Học viên phải được thêm vào lớp');

    // Dọn dẹp để không ảnh hưởng các test sau.
    const cleanup = authedAsStudent(testStudentId)('http://localhost/api/classes/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: 'CLS02', studentId: testStudentId, action: 'UNENROLL' }),
    });
    await enrollClass(cleanup);
  });

  it('6c. Quản trị viên vẫn bị chặn khi thêm học viên vào lớp TRÙNG GIỜ', async () => {
    const testStudentId = 'ST004';
    // ST004 theo seed học CLS01 (Toán, Thứ 2-4-6, Ca 1). CLS02 (Tiếng Anh) trùng ngày + trùng giờ.
    const reqEnroll = authed('http://localhost/api/classes/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: 'CLS02',
        studentId: testStudentId,
        action: 'ENROLL',
        actorId: 'ADMIN001',
      }),
    });
    const resEnroll = await enrollClass(reqEnroll);
    const dataEnroll = await resEnroll.json();
    assert.equal(resEnroll.status, 409, 'Quản trị viên phải bị chặn 409 khi trùng giờ');
    assert.ok(dataEnroll.error && dataEnroll.error.includes('trùng giờ'), 'Message lỗi phải nói rõ trùng giờ');

    const cls = await repo.getClassById('CLS02');
    assert.ok(!cls?.studentIds.includes(testStudentId), 'Học viên KHÔNG được thêm vào lớp khi trùng giờ');
  });

  it('7. Luồng giáo viên nhận ca dạy (Claim Shift)', async () => {
    const testClassId = 'CLS03';
    const newTeacherId = 'GV003';

    const reqClaim = authed('http://localhost/api/classes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId: testClassId,
        teacherId: newTeacherId,
        actorId: newTeacherId,
      }),
    });
    const resClaim = await updateClassTeacher(reqClaim);
    const dataClaim = await resClaim.json();
    assert.ok(dataClaim.success, 'Giáo viên nhận ca dạy phải thành công');

    const updatedClass = await repo.getClassById(testClassId);
    assert.equal(updatedClass?.teacherId, newTeacherId, 'TeacherId của lớp phải được cập nhật');

    const teacher = await repo.getTeacherById(newTeacherId);
    assert.ok(teacher?.assignedClassIds.includes(testClassId), 'assignedClassIds của giáo viên phải chứa lớp');
  });

  it('8. Thêm ca 7 động và kiểm tra số lượng ca tăng lên', async () => {
    const req = authed('http://localhost/api/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ca 7 Sáng Sớm',
        startTime: '06:00',
        endTime: '07:30',
      }),
    });
    const res = await createShift(req);
    const data = await res.json();
    assert.ok(data.success);
    assert.equal(data.shift.name, 'Ca 7 Sáng Sớm');

    const shifts = await ShiftService.getAllShifts();
    assert.equal(shifts.length, 7);
  });

  it('9. API DELETE /api/shifts xóa ca học và kiểm tra số lượng ca giảm', async () => {
    // Xóa Ca 6
    const reqDelete6 = authed('http://localhost/api/shifts?id=6', {
      method: 'DELETE',
    });
    const resDelete6 = await deleteShift(reqDelete6);
    const dataDelete6 = await resDelete6.json();
    assert.ok(dataDelete6.success);

    // Xóa Ca 5
    const reqDelete5 = authed('http://localhost/api/shifts?id=5', {
      method: 'DELETE',
    });
    const resDelete5 = await deleteShift(reqDelete5);
    const dataDelete5 = await resDelete5.json();
    assert.ok(dataDelete5.success);

    const shifts = await ShiftService.getAllShifts();
    assert.equal(shifts.length, 5); // Ban đầu 5 + Ca 6 + Ca 7 = 7, xóa 2 ca còn 5 ca
    assert.ok(!shifts.some(s => s.id === 6));
    assert.ok(!shifts.some(s => s.id === 5));

    // Kiểm tra Audit Log của DELETE SHIFT
    const logs = await repo.getAllAuditLogs();
    const deleteShiftLog = logs.find(l => l.action === 'DELETE' && l.targetId === 'SHIFT_6');
    assert.ok(deleteShiftLog, 'Phải có Audit Log DELETE cho SHIFT_6');
  });

  it('10. ShiftService.deleteShift trả về false khi id không tồn tại', async () => {
    const ok = await ShiftService.deleteShift(9999);
    assert.equal(ok, false);
  });
});
