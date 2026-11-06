import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import * as bootstrapRoute from '../src/app/api/bootstrap/route';
import * as teachersRoute from '../src/app/api/teachers/route';
import * as classesRoute from '../src/app/api/classes/route';
import {
  bumpReferenceVersion,
  REFERENCE_CACHE_SCOPE,
  __resetReferenceVersions,
} from '../src/lib/cache/referenceCache';
import { authed } from './helpers/auth';

/**
 * Phase 2 hợp đồng:
 * 1. `/api/bootstrap` gộp request: mỗi bảng tham chiếu đọc đúng 1 lần, và
 *    `classes` dùng chung cho cả danh sách lớp lẫn lịch học.
 * 2. Cache tham chiếu: hit thứ hai không gọi lại repository; ghi dữ liệu làm
 *    mới version nên request sau đọc tươi.
 *
 * Cache API của Workers không có trong Node, nên test cấy một `caches.default`
 * giả vào globalThis (đúng bề mặt match/put mà module dùng).
 */

type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
const originals = new Map<string, unknown>();

function stub(method: string, impl: (...args: unknown[]) => unknown) {
  const target = repo as unknown as Record<string, unknown>;
  if (!originals.has(method)) originals.set(method, target[method]);
  target[method] = (...args: unknown[]) => {
    calls.push({ method, args });
    return impl(...args);
  };
}

/** Cache API giả: lưu theo URL, đếm match để chứng minh hit. */
function installFakeCache() {
  const store = new Map<string, Response>();
  const fake = {
    match: async (request: Request) => {
      const hit = store.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    put: async (request: Request, response: Response) => {
      store.set(request.url, response.clone());
    },
  };
  Object.defineProperty(globalThis, 'caches', {
    value: { default: fake },
    configurable: true,
    writable: true,
  });
  return store;
}

const globalWithCaches = globalThis as { caches?: unknown };
const hadCaches = 'caches' in globalWithCaches;
const originalCaches = globalWithCaches.caches;

const classes = [
  { id: 'CLS01', name: 'Lớp 12A', subject: 'Toán', studentIds: ['ST001'] },
  { id: 'CLS02', name: 'Lớp 12B', subject: 'Lý', studentIds: ['ST002'] },
];
const teachers = [{ id: 'GV001', name: 'Thầy B' }];
const shifts = [{ id: 1, name: 'Ca 1', startTime: '08:00', endTime: '10:00' }];
const students = [
  { id: 'ST001', name: 'An', enrolledClassIds: ['CLS01'] },
  { id: 'ST002', name: 'Bình', enrolledClassIds: ['CLS02'] },
];

beforeEach(() => {
  calls.length = 0;
  __resetReferenceVersions();
  installFakeCache();

  stub('getAllClasses', () => classes);
  stub('getAllTeachers', () => teachers);
  stub('getAllTimeShifts', () => shifts);
  stub('getAllClassSections', () => [{
    id: 'SEC01', classId: 'CLS01', name: 'Ca 1', startTime: '18:00', endTime: '20:30', studentIds: ['ST001'],
  }]);
  stub('getScheduleSlotsQuery', () => [
    { id: 'SCH01', classId: 'CLS01', sectionId: 'SEC01', teacherId: 'GV001', date: '2026-11-05' },
  ]);
  stub('getStudentsByIds', (...args) => {
    const ids = args[0] as string[];
    return students.filter((s) => ids.includes(s.id));
  });
  // Không được đọc cả bảng students khi bootstrap chỉ cần học sinh đã ghi danh.
  stub('getAllStudents', () => {
    throw new Error('bootstrap không được đọc toàn bộ bảng students');
  });
});

afterEach(() => {
  const target = repo as unknown as Record<string, unknown>;
  for (const [method, original] of originals) {
    target[method] = original;
  }
  if (hadCaches) {
    globalWithCaches.caches = originalCaches;
  } else {
    delete globalWithCaches.caches;
  }
});

describe('GET /api/bootstrap', () => {
  test('gộp scope: mỗi bảng đọc 1 lần, classes chia sẻ cho slots', async () => {
    const res = await bootstrapRoute.GET(
      authed('http://localhost/api/bootstrap?scope=slots,classes,teachers,shifts,students&date=2026-11-05')
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(calls.filter((c) => c.method === 'getAllClasses').length, 1);
    assert.equal(calls.filter((c) => c.method === 'getAllTeachers').length, 1);
    assert.equal(calls.filter((c) => c.method === 'getAllTimeShifts').length, 1);
    assert.equal(calls.filter((c) => c.method === 'getScheduleSlotsQuery').length, 1);
    assert.equal(calls.filter((c) => c.method === 'getAllClassSections').length, 1);

    assert.equal(body.classes.length, 2);
    assert.equal(body.teachers.length, 1);
    assert.equal(body.shifts.length, 1);
    assert.equal(body.slots.length, 1);
    // Giờ/tên lấy từ ca và giáo viên — cùng logic với /api/schedule.
    assert.equal(body.slots[0].startTime, '18:00');
    assert.equal(body.slots[0].teacherName, 'Thầy B');
  });

  test('chỉ nạp học sinh đã ghi danh, không đọc cả bảng', async () => {
    const res = await bootstrapRoute.GET(
      authed('http://localhost/api/bootstrap?scope=classes,students')
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    const idsCall = calls.filter((c) => c.method === 'getStudentsByIds');
    assert.equal(idsCall.length, 1);
    assert.deepEqual((idsCall[0].args[0] as string[]).sort(), ['ST001', 'ST002']);
    assert.equal(body.students.length, 2);
    assert.equal(body.slots, undefined);
  });

  test('scope=students một mình vẫn nạp classes để biết ai ghi danh', async () => {
    const res = await bootstrapRoute.GET(authed('http://localhost/api/bootstrap?scope=students'));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.classes, undefined, 'không trả classes khi không được xin');
    assert.equal(body.students.length, 2);
    // Payload rút gọn: đủ cho hiển thị, không gửi cả hồ sơ.
    assert.deepEqual(Object.keys(body.students[0]).sort(), ['avatarUrl', 'id', 'name', 'phone'].filter((k) => k in body.students[0]).sort());
    assert.equal(body.students[0].enrolledClassIds, undefined);
  });

  test('scope hẹp chỉ trả đúng phần được yêu cầu', async () => {
    const res = await bootstrapRoute.GET(authed('http://localhost/api/bootstrap?scope=teachers'));
    const body = await res.json();

    assert.deepEqual(Object.keys(body).sort(), ['teachers']);
    assert.equal(calls.filter((c) => c.method === 'getAllClasses').length, 0);
    assert.equal(calls.filter((c) => c.method === 'getScheduleSlotsQuery').length, 0);
  });

  test('chưa đăng nhập -> 401, không đọc dữ liệu', async () => {
    const res = await bootstrapRoute.GET(new Request('http://localhost/api/bootstrap?scope=classes'));
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });
});

describe('Cache tham chiếu ở edge', () => {
  test('GET /api/teachers: request thứ hai đọc từ cache', async () => {
    const first = await teachersRoute.GET(authed('http://localhost/api/teachers'));
    const firstBody = await first.json();
    const second = await teachersRoute.GET(authed('http://localhost/api/teachers'));
    const secondBody = await second.json();

    assert.equal(first.headers.get('X-Cache'), 'MISS');
    assert.equal(second.headers.get('X-Cache'), 'HIT');
    assert.equal(calls.filter((c) => c.method === 'getAllTeachers').length, 1);
    assert.deepEqual(secondBody.teachers, firstBody.teachers);
  });

  test('GET /api/classes: danh sách đầy đủ dùng cache, bản lọc theo học sinh thì không', async () => {
    await classesRoute.GET(authed('http://localhost/api/classes'));
    const second = await classesRoute.GET(authed('http://localhost/api/classes'));
    assert.equal(second.headers.get('X-Cache'), 'HIT');
    assert.equal(calls.filter((c) => c.method === 'getAllClasses').length, 1);

    stub('getClassesByStudentId', () => [classes[0]]);
    const filtered = await classesRoute.GET(authed('http://localhost/api/classes?studentId=ST001'));
    assert.equal(filtered.headers.get('X-Cache'), null);
    assert.equal(calls.filter((c) => c.method === 'getClassesByStudentId').length, 1);
  });

  test('bump version sau khi ghi -> request kế tiếp đọc tươi', async () => {
    await teachersRoute.GET(authed('http://localhost/api/teachers'));
    const cachedRes = await teachersRoute.GET(authed('http://localhost/api/teachers'));
    assert.equal(cachedRes.headers.get('X-Cache'), 'HIT');
    assert.equal(calls.filter((c) => c.method === 'getAllTeachers').length, 1);

    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);

    const freshRes = await teachersRoute.GET(authed('http://localhost/api/teachers'));
    assert.equal(freshRes.headers.get('X-Cache'), 'MISS');
    assert.equal(calls.filter((c) => c.method === 'getAllTeachers').length, 2);
  });

  test('bootstrap dùng lại cache của /api/classes và /api/teachers', async () => {
    await classesRoute.GET(authed('http://localhost/api/classes'));
    await teachersRoute.GET(authed('http://localhost/api/teachers'));
    const before = calls.length;

    const res = await bootstrapRoute.GET(
      authed('http://localhost/api/bootstrap?scope=classes,teachers')
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Cache'), 'HIT');
    assert.equal(calls.length, before, 'bootstrap hit cache không được đọc lại database');
  });
});
