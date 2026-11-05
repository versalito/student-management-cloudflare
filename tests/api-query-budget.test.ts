import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import * as scheduleRoute from '../src/app/api/schedule/route';
import * as attendanceRoute from '../src/app/api/attendance/route';
import * as classesRoute from '../src/app/api/classes/route';
import * as studentsRoute from '../src/app/api/students/route';
import * as teachersRoute from '../src/app/api/teachers/route';
import * as auditRoute from '../src/app/api/audit/route';

/**
 * Hợp đồng của Phase 1 (PERF_OPTIMIZATION_SPEC):
 * - GET chỉ đọc: không gọi createStudent/createTeacher/addAuditLog.
 * - Lọc/phân trang đẩy xuống tầng dữ liệu: route không gọi getAll* rồi filter/slice trong JS.
 */

type Call = { method: string; args: unknown[] };

const calls: Call[] = [];
const originals = new Map<string, unknown>();

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
    throw new Error(`GET không được gọi ${method} (write-on-read)`);
  });
}

beforeEach(() => {
  calls.length = 0;
  originals.clear();

  // Dữ liệu tối thiểu cho các stub.
  stub('getStudentsPage', () => ({ students: [{ id: 'ST001', name: 'An' }], total: 1 }));
  stub('getAllTeachers', () => [{ id: 'GV001', name: 'Thầy B' }]);
  stub('getClassMemberships', () => [{ classId: 'CLS01', studentId: 'ST001' }]);
  stub('getScheduleSlotsQuery', () => [{ id: 'SCH01', classId: 'CLS01' }]);
  stub('getAttendanceByDate', () => [{ id: 'ATT01', date: '2026-01-05' }]);
  stub('getClassesByStudentId', () => [{ id: 'CLS01' }]);
  stub('getAuditLogsPage', () => ({ logs: [{ id: 'LOG01' }], total: 42 }));

  // Các phương thức đọc toàn bảng / ghi dữ liệu không được xuất hiện trong GET.
  poison('getAllStudents');
  poison('getAllClasses');
  poison('getAllUsers');
  poison('getAllScheduleSlots');
  poison('getAllAuditLogs');
  poison('getAttendanceByClassId');
  poison('createStudent');
  poison('createTeacher');
  poison('addAuditLog');
});

afterEach(() => {
  const target = repo as unknown as Record<string, unknown>;
  for (const [method, original] of originals) {
    target[method] = original;
  }
});

describe('API query budget (Phase 1)', () => {
  test('GET /api/students: phân trang 1 query, không auto-heal', async () => {
    const res = await studentsRoute.GET(new Request('http://localhost/api/students?page=1&limit=50&search=an'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.method === 'getStudentsPage').length, 1);
    assert.deepEqual(calls.filter(c => c.method === 'getStudentsPage')[0].args[0], {
      search: 'an',
      page: 1,
      limit: 50,
    });
    assert.equal(body.total, 1);
    assert.equal(body.totalPages, 1);
    assert.equal(body.students.length, 1);
  });

  test('GET /api/teachers: 1 query, không auto-heal', async () => {
    const res = await teachersRoute.GET(new Request('http://localhost/api/teachers'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.method === 'getAllTeachers').length, 1);
    assert.equal(body.teachers.length, 1);
  });

  test('GET /api/schedule?studentId: lọc theo ghi danh + slot query, không đọc toàn bộ slot', async () => {
    const res = await scheduleRoute.GET(new Request('http://localhost/api/schedule?studentId=ST001'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(calls.filter(c => c.method === 'getClassMemberships')[0].args[0], { studentId: 'ST001' });
    assert.deepEqual(calls.filter(c => c.method === 'getScheduleSlotsQuery')[0].args[0], {
      date: undefined,
      classId: undefined,
      teacherId: undefined,
      classIds: ['CLS01'],
    });
    assert.equal(body.slots.length, 1);
  });

  test('GET /api/attendance?date: 1 query theo ngày, không loop từng lớp', async () => {
    const res = await attendanceRoute.GET(new Request('http://localhost/api/attendance?date=2026-01-05'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(calls.filter(c => c.method === 'getAttendanceByDate')[0].args[0], '2026-01-05');
    assert.equal(body.records.length, 1);
  });

  test('GET /api/classes?studentId: lọc theo ghi danh ở tầng dữ liệu', async () => {
    const res = await classesRoute.GET(new Request('http://localhost/api/classes?studentId=ST001'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(calls.filter(c => c.method === 'getClassesByStudentId')[0].args[0], 'ST001');
    assert.equal(body.classes.length, 1);
  });

  test('GET /api/audit: phân trang phía server với offset', async () => {
    const res = await auditRoute.GET(new Request('http://localhost/api/audit?page=3&limit=10&search=LOG'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(calls.filter(c => c.method === 'getAuditLogsPage')[0].args[0], {
      search: 'LOG',
      limit: 10,
      offset: 20,
    });
    assert.equal(body.total, 42);
    assert.equal(body.totalPages, 5);
  });
});
