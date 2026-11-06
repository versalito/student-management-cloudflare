import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import * as scheduleRoute from '../src/app/api/schedule/route';
import * as attendanceRoute from '../src/app/api/attendance/route';
import * as classesRoute from '../src/app/api/classes/route';
import * as studentsRoute from '../src/app/api/students/route';
import * as teachersRoute from '../src/app/api/teachers/route';
import * as auditRoute from '../src/app/api/audit/route';
import * as analyticsRoute from '../src/app/api/attendance/analytics/route';
import { authed, sessionCookie } from './helpers/auth';

/**
 * Hợp đồng của Phase 1 (PERF_OPTIMIZATION_SPEC):
 * - GET chỉ đọc: không gọi createStudent/createTeacher/addAuditLog.
 * - Lọc/phân trang đẩy xuống tầng dữ liệu: route không gọi getAll* rồi filter/slice trong JS.
 */

type Call = { method: string; args: unknown[] };

const calls: Call[] = [];
const originals = new Map<string, unknown>();
/**
 * Ghi nhận hàm cấm thực sự được gọi.
 *
 * Không dựa vào exception: auto-heal cũ bọc `createTeacher` trong try/catch nên
 * lỗi bị nuốt và test vẫn xanh. Ở đây mỗi lần implementation poison chạy là một
 * lần ghi nhận, kể cả khi caller nuốt exception.
 */
const poisonedHits: string[] = [];

function stub(method: string, impl: (...args: any[]) => unknown) {
  const target = repo as unknown as Record<string, unknown>;
  if (!originals.has(method)) originals.set(method, target[method]);
  target[method] = (...args: unknown[]) => {
    calls.push({ method, args });
    return impl(...args);
  };
}

function poison(method: string) {
  stub(method, () => {
    poisonedHits.push(method);
    throw new Error(`GET không được gọi ${method} (write-on-read)`);
  });
}

beforeEach(() => {
  calls.length = 0;
  originals.clear();
  poisonedHits.length = 0;

  // Dữ liệu tối thiểu cho các stub.
  stub('getStudentsPage', () => ({ students: [{ id: 'ST001', name: 'An' }], total: 1 }));
  stub('getAllClasses', () => [{ id: 'CLS01', name: 'Lớp 12A', subject: 'Toán' }]);
  stub('getAllClassSections', () => []);
  stub('getAllTeachers', () => [{ id: 'GV001', name: 'Thầy B' }]);
  stub('getClassMemberships', () => [{ classId: 'CLS01', studentId: 'ST001' }]);
  stub('getSectionsByStudentId', () => [{
    id: 'SEC01', classId: 'CLS01', name: 'Ca 1', startTime: '18:00', endTime: '20:30',
    studentIds: ['ST001'], studentScheduleDays: { ST001: [] },
  }]);
  stub('getScheduleSlotsQuery', () => [{ id: 'SCH01', classId: 'CLS01' }]);
  stub('getAttendanceByDate', () => [{ id: 'ATT01', date: '2026-01-05' }]);
  stub('getClassesByStudentId', () => [{ id: 'CLS01' }]);
  stub('getAuditLogsPage', () => ({ logs: [{ id: 'LOG01' }], total: 42 }));
  stub('getAttendanceByMonth', () => [{
    id: 'ATT01', studentId: 'ST001', classId: 'CLS01', date: '2026-01-05', status: 'Có mặt',
  }]);
  stub('getMaxScheduleSlotNumber', () => 388);

  // Các phương thức đọc toàn bảng / ghi dữ liệu không được xuất hiện trong GET.
  poison('getAllStudents');
  poison('getAllUsers');
  poison('getAllScheduleSlots');
  poison('getAllAuditLogs');
  poison('getAttendanceByClassId');
  poison('getScheduleSlotById');
  poison('createStudent');
  poison('createTeacher');
  poison('addAuditLog');
});

afterEach(() => {
  const target = repo as unknown as Record<string, unknown>;
  for (const [method, original] of originals) {
    target[method] = original;
  }

  // Hợp đồng toàn cục: không handler GET nào được chạm hàm ghi / đọc toàn bảng.
  assert.deepEqual(poisonedHits, [], 'GET đã gọi hàm cấm (write-on-read)');
});

describe('API query budget (Phase 1)', () => {
  test('GET /api/students: phân trang 1 query, không auto-heal', async () => {
    const res = await studentsRoute.GET(authed('http://localhost/api/students?page=1&limit=50&search=an'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.method === 'getStudentsPage').length, 1);
    const studentQuery = calls.filter(c => c.method === 'getStudentsPage')[0].args[0] as Record<string, unknown>;
    assert.equal(studentQuery.search, 'an');
    assert.equal(studentQuery.page, 1);
    assert.equal(studentQuery.limit, 50);
    assert.equal(body.total, 1);
    assert.equal(body.totalPages, 1);
    assert.equal(body.students.length, 1);
  });

  test('GET /api/teachers: 1 query, không auto-heal', async () => {
    const res = await teachersRoute.GET(authed('http://localhost/api/teachers'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.method === 'getAllTeachers').length, 1);
    assert.equal(body.teachers.length, 1);
  });

  test('GET /api/schedule?studentId: lọc theo ca ở tầng dữ liệu, không đọc toàn bộ slot', async () => {
    const res = await scheduleRoute.GET(authed('http://localhost/api/schedule?studentId=ST001'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.method === 'getSectionsByStudentId').length, 1);
    assert.deepEqual(calls.filter(c => c.method === 'getScheduleSlotsQuery')[0].args[0], {
      date: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      classId: undefined,
      teacherId: undefined,
      classIds: ['CLS01'],
      sectionIds: ['SEC01'],
      includeUnsectioned: true,
      excludeCancelled: true,
    });
    assert.equal(body.slots.length, 1);
  });

  test('GET /api/schedule?studentId: chỉ giữ buổi đúng thứ học sinh chọn trong ca', async () => {
    stub('getSectionsByStudentId', () => [{
      id: 'SEC01', classId: 'CLS01', name: 'Ca 1', startTime: '18:00', endTime: '20:30',
      studentIds: ['ST001'], studentScheduleDays: { ST001: [2] },
    }]);
    stub('getScheduleSlotsQuery', () => [
      { id: 'MON', classId: 'CLS01', sectionId: 'SEC01', date: '2026-11-02' },
      { id: 'TUE', classId: 'CLS01', sectionId: 'SEC01', date: '2026-11-03' },
      { id: 'LEGACY', classId: 'CLS01', date: '2026-11-03' },
    ]);

    const res = await scheduleRoute.GET(authed('http://localhost/api/schedule?studentId=ST001'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.slots.map((s: { id: string }) => s.id), ['MON', 'LEGACY']);
  });

  test('GET /api/attendance?date: 1 query theo ngày, không loop từng lớp', async () => {
    const res = await attendanceRoute.GET(authed('http://localhost/api/attendance?date=2026-01-05'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(calls.filter(c => c.method === 'getAttendanceByDate')[0].args[0], '2026-01-05');
    assert.equal(body.records.length, 1);
  });

  test('GET /api/classes?studentId: lọc theo ghi danh ở tầng dữ liệu', async () => {
    const res = await classesRoute.GET(authed('http://localhost/api/classes?studentId=ST001'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(calls.filter(c => c.method === 'getClassesByStudentId')[0].args[0], 'ST001');
    assert.equal(body.classes.length, 1);
  });

  test('GET /api/attendance/analytics: 1 query theo tháng, không loop từng lớp', async () => {
    // Thống kê chuyên cần đọc học viên + ca học, nhưng KHÔNG được đọc sổ theo từng lớp.
    stub('getAllStudents', () => [{ id: 'ST001', name: 'An', enrolledClassIds: ['CLS01'] }]);
    stub('getAllScheduleSlots', () => [{ id: 'SCH01', date: '2026-01-05' }]);
    const res = await analyticsRoute.GET(authed('http://localhost/api/attendance/analytics?month=2026-01'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.method === 'getAttendanceByMonth').length, 1);
    assert.deepEqual(calls.filter(c => c.method === 'getAttendanceByMonth')[0].args[0], '2026-01');
    assert.equal(body.items.length, 1);
  });

  test('GET /api/students?limit=all: vẫn bị chặn trần 1000 dòng', async () => {
    await studentsRoute.GET(authed('http://localhost/api/students?limit=all'));

    const studentQuery = calls.filter(c => c.method === 'getStudentsPage')[0].args[0] as Record<string, unknown>;
    assert.equal(studentQuery.limit, 1000);
  });

  test('GET /api/students?limit=99999: hạ xuống trần 1000', async () => {
    await studentsRoute.GET(authed('http://localhost/api/students?limit=99999'));

    const studentQuery = calls.filter(c => c.method === 'getStudentsPage')[0].args[0] as Record<string, unknown>;
    assert.equal(studentQuery.limit, 1000);
  });

  test('POST /api/schedule: sinh mã bằng max function, không đọc toàn bộ slot', async () => {
    stub('getScheduleSlotsQuery', () => []);
    stub('createScheduleSlot', (slot: { id: string }) => slot);
    stub('addAuditLog', () => undefined);

    const res = await scheduleRoute.POST(authed('http://localhost/api/schedule', {
      method: 'POST',
      body: JSON.stringify({
        classId: 'CLS01', teacherId: 'GV001', date: '2026-11-20', shiftId: 1,
        startTime: '08:00', endTime: '10:00', subject: 'Toán', status: 'Đã lên lịch',
      }),
    }) as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.method === 'getMaxScheduleSlotNumber').length, 1);
    assert.equal(body.slot.id, 'SCH0389');
  });

  test('GET /api/audit: phân trang phía server với offset', async () => {
    const res = await auditRoute.GET(authed('http://localhost/api/audit?page=3&limit=10&search=LOG'));
    const body = await res.json();

    assert.equal(res.status, 200);
    const auditQuery = calls.filter(c => c.method === 'getAuditLogsPage')[0].args[0] as Record<string, unknown>;
    assert.equal(auditQuery.search, 'LOG');
    assert.equal(auditQuery.limit, 10);
    assert.equal(auditQuery.offset, 20);
    assert.equal(body.total, 42);
    assert.equal(body.totalPages, 5);
  });
});
