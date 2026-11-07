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
import { authedAsStudent, authed, teacherUser } from './helpers/auth';

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
