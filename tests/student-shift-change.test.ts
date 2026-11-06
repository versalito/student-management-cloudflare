import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { POST as enrollClass } from '../src/app/api/classes/enroll/route';
import { repo } from '../src/repositories';
import { ShiftService } from '../src/services/ShiftService';
import { ClassEntity, ClassSection } from '../src/types/classroom';
import { authed, authedAsStudent, sessionCookie, studentSession } from './helpers/auth';

function enrollRequest(
  payload: Record<string, unknown>,
  init: { user?: { id: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT'; username: string; name: string } } = {}
): Request {
  const url = 'http://localhost/api/classes/enroll';
  const init2: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  return init.user ? authed(url, init2, init.user) : authed(url, init2);
}

/** Tạo một lớp với 2 ca học A và B (cùng lớp, hai khung giờ khác nhau). */
async function createClassWithTwoSections(
  id: string,
  shiftA: number,
  shiftB: number,
  subject = 'Toán Cao Cấp',
  teacherId = 'GV001',
  days: number[] = [2, 4, 6]
): Promise<{ cls: ClassEntity; secA: ClassSection; secB: ClassSection }> {
  const cls: ClassEntity = {
    id,
    name: subject + ' - Test ' + id,
    subject,
    teacherId,
    studentIds: [],
    tuitionFee: 3500000,
    scheduleDays: days,
    shiftId: shiftA,
    status: 'Đang mở',
  };
  await repo.createClass(cls);

  const shifts = await ShiftService.getAllShifts();
  const sa = shifts.find((s) => s.id === shiftA) || shifts[0];
  const sb = shifts.find((s) => s.id === shiftB) || shifts[0];

  const secA: ClassSection = {
    id: 'SEC_' + id + '_A',
    classId: id,
    name: sa.name,
    shiftId: shiftA,
    startTime: sa.startTime,
    endTime: sa.endTime,
    scheduleDays: days,
    teacherId,
    isActive: true,
    studentIds: [],
  };
  const secB: ClassSection = {
    ...secA,
    id: 'SEC_' + id + '_B',
    name: sb.name,
    shiftId: shiftB,
    startTime: sb.startTime,
    endTime: sb.endTime,
  };
  await repo.createClassSection(secA);
  await repo.createClassSection(secB);
  return { cls, secA, secB };
}

/** Ghi danh học sinh vào một ca (đồng bộ luôn danh sách lớp + hồ sơ học sinh). */
async function enrollStudentInSection(
  studentId: string,
  classId: string,
  sectionId: string
): Promise<void> {
  await repo.addStudentToSection(sectionId, studentId);
  const cls = await repo.getClassById(classId);
  if (cls && !cls.studentIds.includes(studentId)) {
    cls.studentIds = [...cls.studentIds, studentId];
    await repo.updateClass(cls);
  }
  const student = await repo.getStudentById(studentId);
  if (student && !student.enrolledClassIds.includes(classId)) {
    student.enrolledClassIds = [...student.enrolledClassIds, classId];
    await repo.updateStudent(student);
  }
}

describe('Học sinh đổi ca học (cơ chế section trong lớp)', () => {
  before(async () => {
    await ShiftService.resetDefaults();
  });

  it('1. Đổi ca trong cùng lớp: rời ca A sang ca B, giữ nguyên lớp và hồ sơ', async () => {
    const { secA, secB } = await createClassWithTwoSections('CLS93', 1, 2);
    const studentId = 'ST022';
    await enrollStudentInSection(studentId, 'CLS93', secA.id);

    const res = await enrollClass(
      enrollRequest({
        classId: 'CLS93',
        sectionId: secA.id,
        studentId,
        action: 'CHANGE_SHIFT',
        targetSectionId: secB.id,
        actorId: studentId,
        actorRole: 'STUDENT',
      })
    );
    const data = await res.json();
    assert.ok(data.success, 'Đổi ca phải thành công: ' + JSON.stringify(data));
    assert.equal(data.targetSectionId, secB.id, 'Phải chuyển sang đúng ca B');

    const secAAfter = await repo.getSectionById(secA.id);
    const secBAfter = await repo.getSectionById(secB.id);
    assert.ok(!(secAAfter?.studentIds || []).includes(studentId), 'Học sinh phải rời ca A');
    assert.ok((secBAfter?.studentIds || []).includes(studentId), 'Học sinh phải có trong ca B');

    // Lớp giữ nguyên id, danh sách studentIds vẫn chứa học sinh (hợp các ca).
    const clsAfter = await repo.getClassById('CLS93');
    assert.ok(clsAfter?.studentIds.includes(studentId), 'studentIds của lớp vẫn chứa học sinh');

    const studentAfter = await repo.getStudentById(studentId);
    assert.ok(
      studentAfter?.enrolledClassIds.includes('CLS93'),
      'enrolledClassIds của học sinh không đổi, vẫn chứa CLS93'
    );
  });

  it('2. Từ chối đổi sang chính ca đang học', async () => {
    // ST001 theo seed đang học CLS01, ca mặc định SEC_CLS01.
    await enrollStudentInSection('ST001', 'CLS01', 'SEC_CLS01');
    const res = await enrollClass(
      enrollRequest({
        classId: 'CLS01',
        sectionId: 'SEC_CLS01',
        studentId: 'ST001',
        action: 'CHANGE_SHIFT',
        targetSectionId: 'SEC_CLS01',
        actorId: 'ST001',
        actorRole: 'STUDENT',
      })
    );
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.match(String(data.error), /đang học đúng ca này/);
  });

  it('3. Học sinh tự đổi ca sang section trùng giờ lớp khác vẫn được phép', async () => {
    const { secA, secB } = await createClassWithTwoSections('CLS91', 1, 2);
    const english = await createClassWithTwoSections(
      'CLS92',
      2,
      1,
      'Tiếng Anh Giao Tiếp & IELTS'
    );
    const studentId = 'ST021';

    await enrollStudentInSection(studentId, 'CLS91', secA.id);
    await enrollStudentInSection(studentId, 'CLS92', english.secA.id);

    const res = await enrollClass(
      enrollRequest({
        classId: 'CLS91',
        sectionId: secA.id,
        studentId,
        action: 'CHANGE_SHIFT',
        targetSectionId: secB.id,
      }, { user: studentSession(studentId) })
    );
    const data = await res.json();
    assert.equal(res.status, 200, 'Học sinh tự đổi ca trùng giờ không bị chặn: ' + JSON.stringify(data));
    assert.ok(data.success);

    const secAAfter = await repo.getSectionById(secA.id);
    const secBAfter = await repo.getSectionById(secB.id);
    assert.ok(!(secAAfter?.studentIds || []).includes(studentId), 'Học sinh rời ca A');
    assert.ok((secBAfter?.studentIds || []).includes(studentId), 'Học sinh vào ca B');
  });

  it('4. Quản trị viên vẫn bị chặn 409 khi đổi ca trùng giờ lớp khác', async () => {
    const { secA, secB } = await createClassWithTwoSections('CLS95', 1, 2);
    const english = await createClassWithTwoSections(
      'CLS96',
      2,
      1,
      'Tiếng Anh Giao Tiếp & IELTS'
    );
    const studentId = 'ST023';
    await enrollStudentInSection(studentId, 'CLS95', secA.id);
    await enrollStudentInSection(studentId, 'CLS96', english.secA.id);

    const res = await enrollClass(
      enrollRequest({
        classId: 'CLS95',
        sectionId: secA.id,
        studentId,
        action: 'CHANGE_SHIFT',
        targetSectionId: secB.id,
        actorId: 'ADMIN001',
      })
    );
    assert.equal(res.status, 409, 'Quản trị viên phải bị chặn 409 khi trùng giờ');

    const secAAfter = await repo.getSectionById(secA.id);
    assert.ok((secAAfter?.studentIds || []).includes(studentId), 'Học sinh vẫn ở ca A khi đổi ca thất bại');
    const secBAfter = await repo.getSectionById(secB.id);
    assert.ok(!(secBAfter?.studentIds || []).includes(studentId), 'Học sinh không vào ca B khi bị chặn');
  });
});
