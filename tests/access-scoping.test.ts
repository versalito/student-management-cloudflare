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
  slots: unknown[];
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

  await t.test('GET /api/schedule trần (không tham số) bị chặn cho học viên', async () => {
    const res = await getSchedule(authedAsStudent(self)('http://localhost/api/schedule'));
    assert.equal(res.status, 403);
  });

  await t.test('GET /api/schedule theo classId vẫn dùng được cho học viên', async () => {
    const cls = (await repo.getAllClasses())[0];
    assert.ok(cls, 'seed phải có lớp');
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
