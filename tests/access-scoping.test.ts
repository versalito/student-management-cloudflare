import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { GET as getStudents } from '../src/app/api/students/route';
import { GET as getTeachers } from '../src/app/api/teachers/route';
import { GET as getSchedule } from '../src/app/api/schedule/route';
import { GET as getBootstrap } from '../src/app/api/bootstrap/route';
import { GET as getSections } from '../src/app/api/classes/sections/route';
import { GET as getFinance } from '../src/app/api/finance/route';
import { GET as getClasses } from '../src/app/api/classes/route';
import { GET as getPayroll } from '../src/app/api/payroll/route';
import { GET as getAttendance, POST as postAttendance } from '../src/app/api/attendance/route';
import { GET as getStudentDetail } from '../src/app/api/students/[id]/route';
import { POST as postSection, PUT as putSection } from '../src/app/api/classes/sections/route';
import { PUT as putClass } from '../src/app/api/classes/route';
import { GET as getCurrentSession } from '../src/app/api/attendance/current-session/route';
import { GET as getRequests } from '../src/app/api/requests/route';
import { GET as getNotifications, POST as postNotifications } from '../src/app/api/notifications/route';
import { POST as postEnroll } from '../src/app/api/classes/enroll/route';
import { PUT as putTeacher } from '../src/app/api/teachers/route';
import { GET as getTeacherCheckin } from '../src/app/api/teacher-checkin/route';
import { GET as getSessionState } from '../src/app/api/student/session-state/route';
import { getTodayDateStr } from '../src/utils/date';
import { authedAsStudent, authed, teacherUser, studentUser } from './helpers/auth';

/**
 * Hồi quy cho lỗ hổng phân quyền đã khai thác được trên production:
 * một học viên đọc được hồ sơ của mọi học viên, lương của giáo viên, lịch của
 * học viên khác, và (ở route mật khẩu) chiếm được tài khoản quản trị.
 */

/** Hình dạng tối thiểu của các payload mà test này chạm tới. */
interface Json {
  student: { id: string };
  students: { id: string }[];
  teachers: { name?: string; phone?: unknown; hourlyRate?: unknown; ratePerSession?: unknown }[];
  classes: { id: string; studentIds?: string[]; studentCount?: number; isMine?: boolean }[];
  sections: { studentIds?: unknown; studentScheduleDays?: unknown; studentCount?: number }[];
  invoices: { studentId: string }[];
  slots: { classId?: string }[];
}

const json = async (res: Response) => res.json() as Promise<Json>;

test('Access scoping: học viên chỉ đọc được dữ liệu của chính mình', async (t) => {
  const repo = LocalRepository.getInstance();
  const self = 'ST001';
  const other = 'ST002';
  assert.ok(await repo.getStudentById(other), 'seed phải có ST002 để test');

  await t.test('GET /api/students?id=<người khác> bị chặn', async () => {
    const res = await getStudents(
      authedAsStudent(self)(`http://localhost/api/students?id=${other}`)
    );
    assert.equal(res.status, 403);
    assert.equal((await json(res)).student, undefined);
  });

  await t.test('GET /api/students không id chỉ trả hồ sơ của chính mình', async () => {
    const res = await getStudents(authedAsStudent(self)('http://localhost/api/students'));
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.equal(data.student?.id, self);
    // Không rò rỉ danh sách: không có mảng students.
    assert.equal(data.students, undefined);
  });

  await t.test('GET /api/students?limit=all không mở toàn bảng cho học viên', async () => {
    const res = await getStudents(
      authedAsStudent(self)('http://localhost/api/students?limit=all')
    );
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.equal(data.students, undefined);
    assert.equal(data.student?.id, self);
  });

  await t.test('Nhân viên vẫn đọc được danh sách đầy đủ', async () => {
    const res = await getStudents(authed('http://localhost/api/students?limit=all'));
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.ok(data.students.length > 1, 'admin phải thấy nhiều học viên');
  });

  await t.test('GET /api/teachers với vai trò học viên không lộ SĐT/lương', async () => {
    const res = await getTeachers(authedAsStudent(self)('http://localhost/api/teachers'));
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.ok(data.teachers.length > 0);
    for (const teacher of data.teachers) {
      assert.equal(teacher.phone, undefined, 'SĐT giáo viên không được trả về');
      assert.equal(teacher.hourlyRate, undefined, 'lương giờ không được trả về');
      assert.equal(teacher.ratePerSession, undefined, 'lương buổi không được trả về');
      assert.ok(teacher.name, 'vẫn phải có tên để hiển thị');
    }
  });

  await t.test('Giáo viên vẫn nhận đủ hồ sơ giáo viên', async () => {
    const res = await getTeachers(authed('http://localhost/api/teachers', {}, teacherUser));
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.ok(data.teachers.some((teacher) => teacher.hourlyRate !== undefined));
  });

  await t.test('GET /api/schedule?studentId=<người khác> bị chặn', async () => {
    const res = await getSchedule(
      authedAsStudent(self)(`http://localhost/api/schedule?studentId=${other}`)
    );
    assert.equal(res.status, 403);
    assert.deepEqual((await json(res)).slots, []);
  });

  await t.test('GET /api/schedule trần chỉ trả ca của lớp chính học viên', async () => {
    // Bất biến: không lộ ca/link phòng của lớp mà học viên không ghi danh —
    // kể cả khi client không truyền `studentId`.
    const res = await getSchedule(authedAsStudent(self)('http://localhost/api/schedule'));
    assert.equal(res.status, 200);
    const { slots } = await json(res);
    const enrolled = new Set((await repo.getClassesByStudentId(self)).map((cls) => cls.id));
    assert.ok(enrolled.size > 0, 'seed phải ghi danh ST001 vào ít nhất 1 lớp');
    for (const slot of slots) {
      const classId = (slot as { classId?: string }).classId;
      assert.ok(
        !classId || enrolled.has(classId),
        `lộ ca của lớp ${classId} mà ${self} không ghi danh`
      );
    }
  });

  await t.test('GET /api/schedule?classId=<lớp ngoài> không trả ca nào', async () => {
    const enrolled = new Set((await repo.getClassesByStudentId(self)).map((cls) => cls.id));
    const foreign = (await repo.getAllClasses()).find((cls) => !enrolled.has(cls.id));
    assert.ok(foreign, 'seed phải có lớp mà ST001 không ghi danh');
    const res = await getSchedule(
      authedAsStudent(self)(`http://localhost/api/schedule?classId=${foreign.id}`)
    );
    assert.equal(res.status, 200);
    assert.deepEqual((await json(res)).slots, []);
  });

  await t.test('GET /api/schedule theo classId của chính mình vẫn dùng được', async () => {
    const cls = (await repo.getClassesByStudentId(self))[0];
    assert.ok(cls, 'seed phải ghi danh ST001 vào ít nhất 1 lớp');
    const res = await getSchedule(
      authedAsStudent(self)(`http://localhost/api/schedule?classId=${cls.id}`)
    );
    assert.equal(res.status, 200);
  });

  await t.test('GET /api/bootstrap?scope=students bị chặn cho học viên', async () => {
    const res = await getBootstrap(
      authedAsStudent(self)('http://localhost/api/bootstrap?scope=students')
    );
    assert.equal(res.status, 403);
  });

  await t.test('GET /api/bootstrap không lộ SĐT giáo viên cho học viên', async () => {
    const res = await getBootstrap(
      authedAsStudent(self)('http://localhost/api/bootstrap?scope=teachers')
    );
    const data = await json(res);
    assert.equal(res.status, 200);
    for (const teacher of data.teachers) {
      assert.equal(teacher.phone, undefined);
      assert.equal(teacher.hourlyRate, undefined);
    }
  });

  await t.test('Admin vẫn bootstrap được danh sách học viên', async () => {
    const res = await getBootstrap(
      authed('http://localhost/api/bootstrap?scope=students')
    );
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(data.students));
  });

  await t.test('GET /api/classes/sections?all=true bị chặn cho học viên', async () => {
    const res = await getSections(
      authedAsStudent(self)('http://localhost/api/classes/sections?all=true')
    );
    assert.equal(res.status, 403);
  });

  await t.test('GET /api/classes/sections?studentId=<người khác> bị chặn', async () => {
    const res = await getSections(
      authedAsStudent(self)(`http://localhost/api/classes/sections?studentId=${other}`)
    );
    assert.equal(res.status, 403);
  });

  await t.test('GET /api/classes/sections theo classId vẫn dùng được cho học viên', async () => {
    const cls = (await repo.getAllClasses())[0];
    const res = await getSections(
      authedAsStudent(self)(`http://localhost/api/classes/sections?classId=${cls.id}`)
    );
    assert.equal(res.status, 200);
  });
});

test('Access scoping: giáo viên không đọc được sổ học phí', async (t) => {
  await t.test('GET /api/finance với vai trò TEACHER bị chặn (RBAC: không có TUITION)', async () => {
    const res = await getFinance(authed('http://localhost/api/finance', {}, teacherUser));
    assert.equal(res.status, 403);
    assert.equal((await json(res)).invoices, undefined);
  });

  await t.test('GET /api/finance vẫn mở cho ADMIN', async () => {
    const res = await getFinance(authed('http://localhost/api/finance'));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await json(res)).invoices));
  });

  await t.test('GET /api/finance cho STUDENT chỉ trả hoá đơn của chính mình', async () => {
    const res = await getFinance(authedAsStudent('ST001')('http://localhost/api/finance?studentId=ST001'));
    assert.equal(res.status, 200);
    const invoices = (await json(res)).invoices;
    assert.ok(invoices.every((invoice) => invoice.studentId === 'ST001'));
  });
});

test('Access scoping: học viên không nhận danh sách mã học viên của lớp/ca', async (t) => {
  const repo = LocalRepository.getInstance();

  await t.test('GET /api/classes trả studentCount thay cho studentIds', async () => {
    const cls = (await repo.getAllClasses()).find((c) => (c.studentIds || []).length > 0);
    assert.ok(cls, 'seed phải có lớp đã có học viên');
    const res = await getClasses(authedAsStudent(cls.studentIds[0])('http://localhost/api/classes'));
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.ok(data.classes.length > 0);
    for (const klass of data.classes) {
      assert.equal(klass.studentIds, undefined, 'không được trả mã học viên');
      assert.equal(typeof klass.studentCount, 'number');
    }
    const own = data.classes.find((klass) => klass.id === cls.id);
    assert.ok(own, 'phải tìm thấy lớp của học viên');
    assert.equal(own.isMine, true, 'học viên nhận ra lớp của mình qua isMine');
  });

  await t.test('GET /api/classes/sections trả isMine/studentCount thay cho studentIds', async () => {
    const cls = (await repo.getAllClasses()).find((c) => (c.studentIds || []).length > 0);
    assert.ok(cls);
    const res = await getSections(
      authedAsStudent(cls.studentIds[0])(`http://localhost/api/classes/sections?classId=${cls.id}`)
    );
    const data = await json(res);
    assert.equal(res.status, 200);
    assert.ok(data.sections.length > 0);
    for (const section of data.sections) {
      assert.equal(section.studentIds, undefined, 'không được trả mã học viên');
      assert.equal(section.studentScheduleDays, undefined, 'không được trả thứ riêng của người khác');
      assert.equal(typeof section.studentCount, 'number');
    }
  });

  await t.test('ADMIN vẫn nhận đủ studentIds', async () => {
    const res = await getClasses(authed('http://localhost/api/classes'));
    const data = await json(res);
    assert.ok(data.classes.some((klass) => Array.isArray(klass.studentIds)));
  });
});

test('Access scoping: khoá tài khoản thu hồi ngay phiên đang mở', async (t) => {
  const repo = LocalRepository.getInstance();
  const id = 'ST002';

  await t.test('phiên của tài khoản bị khoá bị từ chối ở mọi route, không chỉ /api/auth/me', async () => {
    const before = await repo.getUserById(id);
    assert.ok(before?.isActive, 'seed phải có ST002 đang hoạt động');

    // Token vẫn còn hạn 8 h; đây chính là điều kiện của lỗ hổng cũ.
    const request = () => authedAsStudent(id)('http://localhost/api/students');
    assert.equal((await getStudents(request())).status, 200);

    try {
      await repo.updateUser({ ...before, isActive: false });
      assert.equal(
        (await getStudents(request())).status,
        401,
        'phiên cũ của tài khoản đã khoá không được chạm dữ liệu'
      );
    } finally {
      const after = await repo.getUserById(id);
      if (after) await repo.updateUser({ ...after, isActive: true });
    }
  });
});

test('Access scoping: giáo viên chỉ chạm học viên và lớp mình dạy', async (t) => {
  const repo = LocalRepository.getInstance();
  const teacherId = 'GV001';
  const ownClasses = await repo.getClassesByTeacherId(teacherId);
  const foreignClass = (await repo.getAllClasses()).find((cls) => cls.teacherId !== teacherId);
  assert.ok(ownClasses.length > 0, 'seed phải giao lớp cho GV001');
  assert.ok(foreignClass, 'seed phải có lớp của giáo viên khác');

  const ownStudentId = ownClasses[0].studentIds[0];
  const foreignStudentId = (foreignClass.studentIds || []).find(
    (id) => !ownClasses.some((cls) => (cls.studentIds || []).includes(id))
  );
  assert.ok(ownStudentId, 'lớp của GV001 phải có học viên');
  assert.ok(foreignStudentId, 'lớp khác phải có học viên ngoài lớp GV001');

  await t.test('GET /api/students chỉ trả học viên thuộc lớp mình dạy', async () => {
    const res = await getStudents(
      authed('http://localhost/api/students?limit=all', {}, teacherUser)
    );
    const data = await json(res);
    assert.equal(res.status, 200);
    const allowed = new Set(ownClasses.flatMap((cls) => cls.studentIds || []));
    assert.ok(data.students.length > 0);
    for (const student of data.students) {
      assert.ok(allowed.has(student.id), `lộ hồ sơ ${student.id} ngoài lớp GV001`);
    }
  });

  await t.test('GET /api/students/:id ngoài lớp bị chặn', async () => {
    const res = await getStudentDetail(
      authed(`http://localhost/api/students/${foreignStudentId}`, {}, teacherUser),
      { params: Promise.resolve({ id: foreignStudentId! }) }
    );
    assert.equal(res.status, 403);
  });

  await t.test('GET /api/students/:id trong lớp vẫn đọc được', async () => {
    const res = await getStudentDetail(
      authed(`http://localhost/api/students/${ownStudentId}`, {}, teacherUser),
      { params: Promise.resolve({ id: ownStudentId }) }
    );
    assert.equal(res.status, 200);
  });

  await t.test('GET /api/payroll không tham số chỉ trả lương của chính mình', async () => {
    const res = await getPayroll(
      authed('http://localhost/api/payroll?month=2026-09', {}, teacherUser)
    );
    const data = (await res.json()) as { payroll?: { teacherId?: string }; payrolls?: unknown };
    assert.equal(res.status, 200);
    assert.equal(data.payrolls, undefined, 'không được trả bảng lương toàn trung tâm');
    assert.equal(data.payroll?.teacherId, teacherId);
  });

  await t.test('GET /api/attendance không classId chỉ trả sổ của lớp mình', async () => {
    const res = await getAttendance(
      authed('http://localhost/api/attendance?date=2026-09-02', {}, teacherUser)
    );
    const records = ((await res.json()) as { records: { classId: string }[] }).records;
    assert.equal(res.status, 200);
    const allowed = new Set(ownClasses.map((cls) => cls.id));
    for (const record of records) {
      assert.ok(allowed.has(record.classId), `lộ sổ điểm danh lớp ${record.classId}`);
    }
  });

  await t.test('POST /api/attendance cho lớp ngoài phạm vi bị chặn', async () => {
    const res = await postAttendance(
      authed(
        'http://localhost/api/attendance',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            record: {
              id: 'ATT_TEST_FOREIGN',
              scheduleSlotId: 'SLOT_TEST',
              classId: foreignClass.id,
              studentId: foreignStudentId,
              date: '2026-09-02',
              status: 'Có mặt',
            },
          }),
        },
        teacherUser
      )
    );
    assert.equal(res.status, 403);
  });
});

test('Access scoping: giáo viên không đổi được giáo viên/ca của lớp khác', async (t) => {
  const repo = LocalRepository.getInstance();
  const ownClass = (await repo.getClassesByTeacherId('GV001'))[0];
  const foreignClass = (await repo.getAllClasses()).find((cls) => cls.teacherId !== 'GV001');
  assert.ok(ownClass && foreignClass, 'seed phải có lớp của GV001 và lớp của người khác');

  const foreignSection = (await repo.getClassSections(foreignClass.id))[0];

  await t.test('PUT /api/classes/sections cướp ca của giáo viên khác bị chặn', async () => {
    assert.ok(foreignSection, 'lớp khác phải có ca');
    const res = await putSection(
      authed(
        'http://localhost/api/classes/sections',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionId: foreignSection.id, teacherId: 'GV001' }),
        },
        teacherUser
      )
    );
    assert.equal(res.status, 403);
  });

  await t.test('PUT /api/classes/sections không gán ca sang người khác được', async () => {
    const res = await putSection(
      authed(
        'http://localhost/api/classes/sections',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionId: foreignSection.id, teacherId: 'GV002' }),
        },
        teacherUser
      )
    );
    assert.equal(res.status, 403);
  });

  await t.test('POST /api/classes/sections (tạo ca) là quyền quản trị', async () => {
    const res = await postSection(
      authed(
        'http://localhost/api/classes/sections',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classId: foreignClass.id, startTime: '07:00', endTime: '09:00' }),
        },
        teacherUser
      )
    );
    assert.equal(res.status, 403);
  });

  await t.test('PUT /api/classes đổi giáo viên lớp khác bị chặn', async () => {
    const res = await putClass(
      authed(
        'http://localhost/api/classes',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classId: foreignClass.id, teacherId: 'GV001' }),
        },
        teacherUser
      )
    );
    assert.equal(res.status, 403);
  });
});

test('Access scoping: giáo viên vẫn nhận được ca chưa phân công', async (t) => {
  const repo = LocalRepository.getInstance();
  const available = (await repo.getAllClassSections()).find(
    (sec) => !sec.teacherId || sec.teacherId === 'CHUA_PHAN_CONG' || sec.teacherId === ''
  );

  await t.test('PUT /api/classes/sections tự nhận ca trống trả 200', async () => {
    if (!available) {
      // Seed production không còn ca trống; tạo tạm để kiểm nhánh hợp lệ.
      const cls = (await repo.getClassesByTeacherId('GV001'))[0];
      await repo.createClassSection({
        id: 'SEC_TEST_FREE',
        classId: cls.id,
        name: 'Ca trống',
        shiftId: 1,
        startTime: '07:00',
        endTime: '09:00',
        scheduleDays: [2, 4],
        isActive: true,
        studentIds: [],
      });
    }
    const section = available
      ?? (await repo.getSectionById('SEC_TEST_FREE'));
    assert.ok(section);

    try {
      const res = await putSection(
        authed(
          'http://localhost/api/classes/sections',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sectionId: section.id, teacherId: 'GV001' }),
          },
          teacherUser
        )
      );
      assert.equal(res.status, 200);
      const after = await repo.getSectionById(section.id);
      assert.equal(after?.teacherId, 'GV001');
    } finally {
      if (section.id === 'SEC_TEST_FREE') {
        await repo.deleteClassSection('SEC_TEST_FREE');
      }
    }
  });
});

test('Access scoping: bootstrap/analytics/roster không mở dữ liệu lớp khác cho giáo viên', async (t) => {
  const repo = LocalRepository.getInstance();
  const teacherId = 'GV001';

  await t.test('GET /api/bootstrap?scope=students bị chặn cho giáo viên', async () => {
    const res = await getBootstrap(
      authed('http://localhost/api/bootstrap?scope=students', {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });

  await t.test('GET /api/bootstrap?scope=classes không lộ mã học viên lớp khác', async () => {
    const res = await getBootstrap(
      authed('http://localhost/api/bootstrap?scope=classes', {}, teacherUser)
    );
    const data = await res.json() as { classes: { id: string; studentIds?: string[]; studentCount?: number }[] };
    assert.equal(res.status, 200);
    const own = new Set((await repo.getClassesByTeacherId(teacherId)).map((c) => c.id));
    for (const cls of data.classes) {
      if (own.has(cls.id)) continue;
      assert.equal(cls.studentIds, undefined, `lớp ${cls.id} không được lộ studentIds`);
      assert.equal(typeof cls.studentCount, 'number');
    }
  });

  await t.test('GET /api/classes/sections?all=true chỉ trả studentIds của ca mình dạy', async () => {
    const res = await getSections(
      authed('http://localhost/api/classes/sections?all=true', {}, teacherUser)
    );
    const data = await res.json() as { sections: { id: string; teacherId?: string; studentIds?: string[]; studentCount?: number }[] };
    assert.equal(res.status, 200);
    assert.ok(data.sections.length > 0);
    for (const sec of data.sections) {
      if (sec.teacherId === teacherId) continue;
      assert.equal(sec.studentIds, undefined, `ca ${sec.id} không được lộ studentIds`);
      assert.equal(typeof sec.studentCount, 'number');
    }
  });

  await t.test('GET /api/attendance/analytics chỉ trả học viên lớp mình dạy', async () => {
    const { GET: getAnalytics } = await import('../src/app/api/attendance/analytics/route');
    const res = await getAnalytics(
      authed('http://localhost/api/attendance/analytics?month=2026-09', {}, teacherUser)
    );
    const data = await res.json() as { items: { studentId: string }[] };
    assert.equal(res.status, 200);

    const ownStudents = new Set(
      (await repo.getClassesByTeacherId(teacherId)).flatMap((cls) => cls.studentIds || [])
    );
    for (const section of await repo.getSectionsByTeacherId(teacherId)) {
      for (const id of section.studentIds || []) ownStudents.add(id);
    }
    for (const item of data.items) {
      assert.ok(ownStudents.has(item.studentId), `lộ học viên ${item.studentId}`);
    }
  });

  await t.test('GET /api/attendance/analytics?classId=<lớp ngoài> bị chặn', async () => {
    const { GET: getAnalytics } = await import('../src/app/api/attendance/analytics/route');
    const own = new Set((await repo.getClassesByTeacherId(teacherId)).map((c) => c.id));
    const foreign = (await repo.getAllClasses()).find((c) => !own.has(c.id));
    assert.ok(foreign, 'seed phải có lớp ngoài phạm vi');

    const res = await getAnalytics(
      authed(`http://localhost/api/attendance/analytics?classId=${foreign.id}`, {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });
});

test('Access scoping: giáo viên vẫn mở được sổ điểm danh theo ca (slotId)', async (t) => {
  const repo = LocalRepository.getInstance();
  const teacherId = 'GV001';
  const ownClassIds = new Set((await repo.getClassesByTeacherId(teacherId)).map((c) => c.id));

  const allSlots = await repo.getAllScheduleSlots();
  const ownSlot = allSlots.find((s) => ownClassIds.has(s.classId));
  const foreignSlot = allSlots.find((s) => !ownClassIds.has(s.classId));
  assert.ok(ownSlot && foreignSlot, 'seed phải có ca trong và ngoài phạm vi');

  await t.test('?slotId= ca mình dạy trả sổ (không rỗng nhầm)', async () => {
    const res = await getAttendance(
      authed(`http://localhost/api/attendance?slotId=${ownSlot.id}`, {}, teacherUser)
    );
    assert.equal(res.status, 200);
    const data = await res.json() as { records: { classId?: string }[] };
    assert.ok(Array.isArray(data.records));
    // Server ghép roster của ca vào sổ; nếu nhánh phân quyền chặn sớm, mảng rỗng.
    assert.ok(
      data.records.length > 0 || (ownSlot.sectionId === undefined && ownSlot.classId),
      'sổ của ca mình dạy không được rỗng'
    );
    for (const rec of data.records) {
      assert.equal(rec.classId, ownSlot.classId);
    }
  });

  await t.test('?slotId= ca lớp khác bị chặn', async () => {
    const res = await getAttendance(
      authed(`http://localhost/api/attendance?slotId=${foreignSlot.id}`, {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });
});

test('Access scoping: /api/attendance/current-session không mở ca của giáo viên khác', async (t) => {
  const repo = LocalRepository.getInstance();
  const teacherId = 'GV001';
  const ownClassIds = new Set((await repo.getClassesByTeacherId(teacherId)).map((c) => c.id));
  const today = getTodayDateStr();

  const allSlots = await repo.getAllScheduleSlots();
  const todaySlots = allSlots.filter((s) => s.date === today && s.status !== 'Đã hủy');
  const foreignTodaySlot = todaySlots.find((s) => !ownClassIds.has(s.classId));

  await t.test('?teacherId=<giáo viên khác> bị chặn', async () => {
    const res = await getCurrentSession(
      authed('http://localhost/api/attendance/current-session?teacherId=GV002', {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });

  await t.test('không tham số không trả ca ngoài phạm vi', async () => {
    const res = await getCurrentSession(
      authed('http://localhost/api/attendance/current-session', {}, teacherUser)
    );
    assert.equal(res.status, 200);
    const data = await res.json() as { hasActiveSession: boolean; slot?: { classId: string } };
    if (data.hasActiveSession && data.slot) {
      assert.ok(
        ownClassIds.has(data.slot.classId),
        `trả ca của lớp ${data.slot.classId} ngoài phạm vi ${[...ownClassIds].join(',')}`
      );
    }
    assert.ok(foreignTodaySlot === undefined || !data.hasActiveSession || data.slot!.classId !== foreignTodaySlot.classId);
  });
});

test('Access scoping: danh sách đơn từ của giáo viên chỉ gồm lớp mình phụ trách', async (t) => {
  const repo = LocalRepository.getInstance();
  const teacherId = 'GV001';
  const ownClasses = await repo.getClassesByTeacherId(teacherId);
  const ownSections = await repo.getSectionsByTeacherId(teacherId);
  const allowed = new Set<string>([
    ...ownClasses.map((c) => c.id),
    ...ownSections.map((sec) => sec.classId),
  ]);
  const all = await repo.getAllRequests();
  assert.ok(all.length > 0, 'seed phải có đơn từ');
  const foreign = all.filter((r) => !allowed.has(r.classId));
  assert.ok(foreign.length > 0, 'seed phải có đơn ngoài phạm vi giáo viên');

  await t.test('không truyền teacherId không trả đơn lớp khác', async () => {
    const res = await getRequests(authed('http://localhost/api/requests', {}, teacherUser));
    assert.equal(res.status, 200);
    const data = await res.json() as { requests: { classId: string }[] };
    assert.ok(data.requests.length > 0, 'giáo viên phải thấy đơn của lớp mình');
    for (const r of data.requests) {
      assert.ok(allowed.has(r.classId), `lộ đơn của lớp ${r.classId}`);
    }
  });

  await t.test('admin vẫn thấy toàn bộ đơn', async () => {
    const res = await getRequests(authed('http://localhost/api/requests'));
    const data = await res.json() as { requests: unknown[] };
    assert.equal(data.requests.length, all.length);
  });
});

test('Access scoping: giáo viên không đọc lương/SĐT của đồng nghiệp', async (t) => {
  const repo = LocalRepository.getInstance();
  const all = await repo.getAllTeachers();
  const self = all.find((x) => x.id === 'GV001');
  const other = all.find((x) => x.id !== 'GV001');
  assert.ok(self && other, 'seed phải có >= 2 giáo viên');

  await t.test('GET /api/teachers ẩn lương người khác, giữ của mình', async () => {
    const res = await getTeachers(authed('http://localhost/api/teachers', {}, teacherUser));
    assert.equal(res.status, 200);
    const data = await res.json() as {
      teachers: { id: string; hourlyRate?: number; ratePerSession?: number; phone?: string }[];
    };
    const me = data.teachers.find((x) => x.id === self.id);
    const them = data.teachers.find((x) => x.id === other.id);
    assert.ok(me && them, 'phải trả cả hai hồ sơ');
    assert.equal(me.hourlyRate, self.hourlyRate, 'phải giữ lương của chính mình');
    assert.equal(them.hourlyRate, undefined, 'không được lộ lương đồng nghiệp');
    assert.equal(them.ratePerSession, undefined);
    assert.equal(them.phone, undefined, 'không được lộ SĐT đồng nghiệp');
  });

  await t.test('GET /api/teachers?id=<đồng nghiệp> cũng bị ẩn', async () => {
    const res = await getTeachers(
      authed(`http://localhost/api/teachers?id=${other.id}`, {}, teacherUser)
    );
    const data = await res.json() as { teacher: { hourlyRate?: number; phone?: string } };
    assert.equal(data.teacher.hourlyRate, undefined);
    assert.equal(data.teacher.phone, undefined);
  });

  await t.test('ADMIN vẫn thấy đầy đủ', async () => {
    const res = await getTeachers(authed(`http://localhost/api/teachers?id=${other.id}`));
    const data = await res.json() as { teacher: { hourlyRate?: number; phone?: string } };
    assert.equal(data.teacher.hourlyRate, other.hourlyRate);
    assert.equal(data.teacher.phone, other.phone);
  });
});

test('Access scoping: giáo viên không sửa hồ sơ/không đọc chấm công của đồng nghiệp', async (t) => {
  const repo = LocalRepository.getInstance();
  const others = (await repo.getAllTeachers()).filter((x) => x.id !== 'GV001');
  const victim = others[0];

  await t.test('PUT /api/teachers hồ sơ đồng nghiệp bị chặn', async () => {
    const res = await putTeacher(
      authed('http://localhost/api/teachers', {
        method: 'PUT',
        body: JSON.stringify({ id: victim.id, name: victim.name, specialty: victim.specialty, bio: 'x' }),
      }, teacherUser)
    );
    assert.equal(res.status, 403, 'giáo viên không được sửa hồ sơ người khác');
    const after = await repo.getTeacherById(victim.id);
    assert.equal(after?.bio, victim.bio, 'hồ sơ nạn nhân phải nguyên vẹn');
  });

  await t.test('PUT /api/teachers hồ sơ của chính mình vẫn được', async () => {
    const me = await repo.getTeacherById('GV001');
    assert.ok(me);
    const res = await putTeacher(
      authed('http://localhost/api/teachers', {
        method: 'PUT',
        body: JSON.stringify({ id: 'GV001', name: me.name, specialty: me.specialty, bio: me.bio }),
      }, teacherUser)
    );
    assert.equal(res.status, 200);
  });

  await t.test('GET /api/teacher-checkin?teacherId=<đồng nghiệp> bị chặn', async () => {
    const res = await getTeacherCheckin(
      authed(`http://localhost/api/teacher-checkin?teacherId=${victim.id}`, {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });

  await t.test('GET /api/teacher-checkin trần chỉ trả ca của chính mình', async () => {
    const res = await getTeacherCheckin(
      authed('http://localhost/api/teacher-checkin', {}, teacherUser)
    );
    assert.equal(res.status, 200);
    const data = await res.json() as { slots: { teacherId: string }[] };
    assert.ok(data.slots.length > 0);
    for (const slot of data.slots) assert.equal(slot.teacherId, 'GV001');
  });

  await t.test('GET /api/student/session-state học viên lớp khác bị chặn', async () => {
    const foreignClass = (await repo.getAllClasses()).find((cls) => cls.teacherId !== 'GV001');
    const owned = new Set(
      (await repo.getClassesByTeacherId('GV001')).flatMap((cls) => cls.studentIds || [])
    );
    const foreignStudentId = (foreignClass?.studentIds || []).find((id) => !owned.has(id));
    assert.ok(foreignStudentId, 'seed phải có học viên ngoài lớp GV001');
    const res = await getSessionState(
      authed(`http://localhost/api/student/session-state?studentId=${foreignStudentId}`, {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });
});

test('Access scoping: giáo viên không ghi danh vào lớp mình không dạy', async (t) => {
  const repo = LocalRepository.getInstance();
  const foreignClass = (await repo.getAllClasses()).find((cls) => cls.teacherId !== 'GV001');
  const owned = new Set(
    (await repo.getClassesByTeacherId('GV001')).flatMap((cls) => cls.studentIds || [])
  );
  const studentId = (foreignClass?.studentIds || []).find((id) => !owned.has(id));
  assert.ok(foreignClass && studentId, 'seed phải có lớp khác với học viên ngoài lớp GV001');
  const before = await repo.getClassById(foreignClass.id);

  const res = await postEnroll(
    authed('http://localhost/api/classes/enroll', {
      method: 'POST',
      body: JSON.stringify({ classId: foreignClass.id, studentId, action: 'ENROLL' }),
    }, teacherUser)
  );
  assert.equal(res.status, 403, 'không được ghi danh vào lớp ngoài phạm vi');

  const after = await repo.getClassById(foreignClass.id);
  assert.deepEqual(after?.studentIds, before?.studentIds, 'sĩ số lớp không được đổi');
});

test('Access scoping: giáo viên tự đổi ca học viên trong lớp mình vẫn được', async (t) => {
  const repo = LocalRepository.getInstance();
  const ownClass = (await repo.getClassesByTeacherId('GV001'))[0];
  const sections = await repo.getClassSections(ownClass.id);
  const studentId = (sections[0]?.studentIds || [])[0];
  assert.ok(studentId, 'ca của GV001 phải có học viên');

  const res = await postEnroll(
    authed('http://localhost/api/classes/enroll', {
      method: 'POST',
      body: JSON.stringify({
        classId: ownClass.id,
        studentId,
        action: 'CHANGE_SHIFT',
        sectionId: sections[0].id,
        targetSectionId: sections[0].id,
        targetShiftId: sections[0].shiftId,
      }),
    }, teacherUser)
  );
  assert.ok([200, 400, 409].includes(res.status), `đổi ca trong lớp mình không được là 403, nhận ${res.status}`);
});

test('Access scoping: lịch dạy của giáo viên chỉ gồm ca của chính mình', async (t) => {
  const repo = LocalRepository.getInstance();
  const all = await repo.getAllScheduleSlots();
  const others = all.filter((s) => s.teacherId !== 'GV001');
  assert.ok(all.some((s) => s.teacherId === 'GV001'), 'seed phải có ca của GV001');
  assert.ok(others.length > 0, 'seed phải có ca của giáo viên khác');

  await t.test('gọi trần không trả ca người khác', async () => {
    const res = await getSchedule(authed('http://localhost/api/schedule', {}, teacherUser));
    assert.equal(res.status, 200);
    const data = await res.json() as { slots: { teacherId: string }[] };
    assert.ok(data.slots.length > 0);
    for (const slot of data.slots) assert.equal(slot.teacherId, 'GV001');
  });

  await t.test('?teacherId=<đồng nghiệp> bị chặn', async () => {
    const res = await getSchedule(
      authed(`http://localhost/api/schedule?teacherId=${others[0].teacherId}`, {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });

  await t.test('ADMIN vẫn xem được lịch toàn trung tâm', async () => {
    const res = await getSchedule(authed('http://localhost/api/schedule'));
    const data = await res.json() as { slots: unknown[] };
    assert.ok(data.slots.length > 1);
  });
});

test('Access scoping: thông báo chỉ chủ sở hữu (và ADMIN) đọc/đánh dấu', async (t) => {
  const repo = LocalRepository.getInstance();
  const studentId = studentUser.id;
  const created = await repo.addNotification({
    title: 'ZZ notif scope',
    message: 'perm probe',
    type: 'INFO',
    recipientRole: 'STUDENT',
    recipientUserId: studentId,
    isRead: false,
  });

  await t.test('giáo viên gọi trần không đọc được thông báo của người khác', async () => {
    const res = await getNotifications(authed('http://localhost/api/notifications', {}, teacherUser));
    assert.equal(res.status, 403);
  });

  await t.test('giáo viên ?userId=<học viên> bị chặn', async () => {
    const res = await getNotifications(
      authed(`http://localhost/api/notifications?userId=${studentId}`, {}, teacherUser)
    );
    assert.equal(res.status, 403);
  });

  await t.test('giáo viên MARK_READ thông báo của học viên bị chặn', async () => {
    const res = await postNotifications(
      authed('http://localhost/api/notifications', {
        method: 'POST',
        body: JSON.stringify({ action: 'MARK_READ', id: created.id }),
      }, teacherUser)
    );
    assert.equal(res.status, 403);
    const after = (await repo.getNotifications(studentId, 'STUDENT')).find((n) => n.id === created.id);
    assert.equal(after?.isRead, false, 'thông báo phải còn chưa đọc');
  });

  await t.test('học viên đọc và đánh dấu đọc thông báo của chính mình', async () => {
    const list = await getNotifications(
      authed(`http://localhost/api/notifications?userId=${studentId}`, {}, studentUser)
    );
    assert.equal(list.status, 200);
    const mark = await postNotifications(
      authed('http://localhost/api/notifications', {
        method: 'POST',
        body: JSON.stringify({ action: 'MARK_READ', id: created.id }),
      }, studentUser)
    );
    assert.equal(mark.status, 200);
  });

  await t.test('ADMIN vẫn đọc theo userId', async () => {
    const res = await getNotifications(
      authed(`http://localhost/api/notifications?userId=${studentId}`)
    );
    assert.equal(res.status, 200);
  });
});
