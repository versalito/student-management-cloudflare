import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import { GET as attendanceGet } from '../src/app/api/attendance/route';
import { POST as enrollPost } from '../src/app/api/classes/enroll/route';
import { POST as swapPost } from '../src/app/api/student/swap/route';
import { ClassEntity, ClassSection } from '../src/types/classroom';
import { ScheduleSlot } from '../src/types/schedule';
import { dateToDayOfWeek } from '../src/utils/date';
import { authed, sessionCookie } from './helpers/auth';

function enrollReq(payload: Record<string, unknown>): Request {
  return authed('http://localhost/api/classes/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function swapReq(payload: Record<string, unknown>): Request {
  return authed('http://localhost/api/student/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function makeScheduleSlot(partial: {
  id: string;
  classId: string;
  sectionId: string;
  date: string;
  shiftId: number;
}): ScheduleSlot {
  return {
    id: partial.id,
    classId: partial.classId,
    sectionId: partial.sectionId,
    teacherId: 'GV001',
    date: partial.date,
    shiftId: partial.shiftId,
    startTime: '08:00',
    endTime: '10:00',
    subject: 'Toán',
    status: 'Đã lên lịch',
  };
}

describe('Ca riêng + Thứ riêng + Đổi ca trong ngày (schedule_days & student_slot_swaps)', () => {
  const classId = 'CLS_SD001';
  const secA = 'SEC_SD001_A';
  const secB = 'SEC_SD001_B';
  const studentId = 'ST_SD001';
  const monday = '2026-10-12';
  const wednesday = '2026-10-14';

  before(async () => {
    await repo.createStudent({
      id: studentId,
      name: 'Học viên Test Ca Riêng',
      phone: '0900000000',
      status: 'Đang học',
      enrolledClassIds: [],
      createdAt: new Date().toISOString(),
    });

    const cls: ClassEntity = {
      id: classId,
      name: 'Toán - Test Ca Riêng',
      subject: 'Toán',
      teacherId: 'GV001',
      studentIds: [],
      tuitionFee: 3500000,
      scheduleDays: [2, 4],
      shiftId: 1,
      status: 'Đang mở',
    };
    await repo.createClass(cls);

    const secAA: ClassSection = {
      id: secA,
      classId,
      name: 'Ca 1 (08:00 - 10:00)',
      shiftId: 1,
      startTime: '08:00',
      endTime: '10:00',
      scheduleDays: [2, 4],
      teacherId: 'GV001',
      isActive: true,
      studentIds: [],
    };
    const secBB: ClassSection = {
      ...secAA,
      id: secB,
      name: 'Ca 2 (10:15 - 12:15)',
      shiftId: 2,
      startTime: '10:15',
      endTime: '12:15',
    };
    await repo.createClassSection(secAA);
    await repo.createClassSection(secBB);

    await repo.createScheduleSlot(
      makeScheduleSlot({ id: 'SCH_SD001_MON_A', classId, sectionId: secA, date: monday, shiftId: 1 })
    );
    await repo.createScheduleSlot(
      makeScheduleSlot({ id: 'SCH_SD001_MON_B', classId, sectionId: secB, date: monday, shiftId: 2 })
    );
    await repo.createScheduleSlot(
      makeScheduleSlot({ id: 'SCH_SD001_WED_A', classId, sectionId: secA, date: wednesday, shiftId: 1 })
    );
  });

  it('1. ENROLL chọn ca A + thứ [2] -> chỉ trả buổi Thứ 2 của ca A', async () => {
    assert.equal(dateToDayOfWeek(monday), 2);
    assert.equal(dateToDayOfWeek(wednesday), 4);

    const res = await enrollPost(
      enrollReq({
        classId,
        sectionId: secA,
        studentId,
        action: 'ENROLL',
        actorId: 'ADMIN001',
        actorRole: 'ADMIN',
        scheduleDays: [2],
      })
    );
    const data = await res.json();
    assert.ok(data.success, 'ENROLL phải thành công: ' + JSON.stringify(data));

    const sections = await repo.getSectionsByStudentId(studentId);
    assert.ok(sections.some((s) => s.id === secA), 'Học sinh phải thuộc ca A');

    const daysMap = await repo.getSectionStudentScheduleDays(secA);
    assert.deepEqual(daysMap[studentId], [2], 'Thứ riêng của học sinh phải là [2]');

    const slots = await repo.getScheduleSlotsByStudentId(studentId);
    const slotIds = slots.map((s) => s.id).sort();
    assert.deepEqual(slotIds, ['SCH_SD001_MON_A'], 'Chỉ thấy buổi Thứ 2 của ca A: ' + JSON.stringify(slotIds));
  });

  it('2. Đổi ca nhanh trong ngày: từ slot ca A sang slot ca B cùng ngày', async () => {
    const swapRes = await swapPost(
      swapReq({
        studentId,
        fromSlotId: 'SCH_SD001_MON_A',
        toSlotId: 'SCH_SD001_MON_B',
        date: monday,
      })
    );
    const swapData = await swapRes.json();
    assert.equal(swapRes.status, 200, 'Đổi ca must 200: ' + JSON.stringify(swapData));
    assert.ok(swapData.success, 'Đổi ca phải thành công');
    assert.equal(swapData.swap.status, 'ACTIVE');

    const attRes = await attendanceGet(
      authed('http://localhost/api/attendance?slotId=SCH_SD001_MON_B')
    );
    const attData = await attRes.json();
    const rosterIds = (attData.records || []).map((r: any) => r.studentId);
    assert.ok(rosterIds.includes(studentId), 'Roster ca đích phải có học sinh: ' + JSON.stringify(rosterIds));

    const attResA = await attendanceGet(
      authed('http://localhost/api/attendance?slotId=SCH_SD001_MON_A')
    );
    const attDataA = await attResA.json();
    const rosterA = (attDataA.records || []).map((r: any) => r.studentId);
    assert.ok(!rosterA.includes(studentId), 'Roster ca xuất phát không còn học sinh: ' + JSON.stringify(rosterA));
  });
});

describe('Học sinh tự rời lớp (UNENROLL) trên portal học sinh', () => {
  const classId = 'CLS_SD002';
  const secOnly = 'SEC_SD002_ONLY';
  const studentId = 'ST_SD002';

  before(async () => {
    await repo.createStudent({
      id: studentId,
      name: 'Học viên Test Rời Lớp',
      phone: '0910000000',
      status: 'Đang học',
      enrolledClassIds: [classId],
      createdAt: new Date().toISOString(),
    });

    const cls: ClassEntity = {
      id: classId,
      name: 'Vật Lý - Test Rời Lớp',
      subject: 'Vật Lý',
      teacherId: 'GV001',
      studentIds: [studentId],
      tuitionFee: 3000000,
      scheduleDays: [2],
      shiftId: 1,
      status: 'Đang mở',
    };
    await repo.createClass(cls);

    const sec: ClassSection = {
      id: secOnly,
      classId,
      name: 'Ca 1 (08:00 - 10:00)',
      shiftId: 1,
      startTime: '08:00',
      endTime: '10:00',
      scheduleDays: [2],
      teacherId: 'GV001',
      isActive: true,
      studentIds: [studentId],
    };
    await repo.createClassSection(sec);
  });

  it('1. UNENROLL gỡ học sinh khỏi ca và enrolledClassIds khi ca là ca duy nhất', async () => {
    const res = await enrollPost(
      enrollReq({
        classId,
        sectionId: secOnly,
        studentId,
        action: 'UNENROLL',
        actorId: studentId,
        actorRole: 'STUDENT',
      })
    );
    const data = await res.json();
    assert.equal(res.status, 200, 'UNENROLL phải 200: ' + JSON.stringify(data));
    assert.ok(data.success);

    const secAfter = await repo.getSectionById(secOnly);
    assert.ok(!(secAfter?.studentIds || []).includes(studentId), 'Học sinh phải rời khỏi ca');

    const studentAfter = await repo.getStudentById(studentId);
    assert.ok(
      !(studentAfter?.enrolledClassIds || []).includes(classId),
      'enrolledClassIds phải gỡ classId khi rời ca duy nhất: ' + JSON.stringify(studentAfter?.enrolledClassIds)
    );

    const clsAfter = await repo.getClassById(classId);
    assert.ok(!(clsAfter?.studentIds || []).includes(studentId), 'studentIds của lớp không còn học sinh');
  });
});
