import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffRoster } from '../src/utils/rosterDiff';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { loadScheduleView } from '../src/services/ScheduleViewService';
import type { ScheduleSlot } from '../src/types/schedule';

/**
 * Hồi quy cho STUDENT_PORTAL_FIX_SPEC §2:
 *  - ghi danh lớp chỉ ghi phần chênh lệch (không xoá-rồi-chèn toàn bộ roster),
 *  - thời khoá biểu của học sinh không còn buổi của lớp 'Đã kết thúc'.
 */
describe('ghi danh lớp: chỉ áp phần chênh lệch', () => {
  it('thêm và xoá đúng người, giữ nguyên người chung', () => {
    assert.deepEqual(diffRoster(['A', 'B', 'C'], ['B', 'C', 'D']), {
      toAdd: ['A'],
      toRemove: ['D'],
    });
  });

  it('đăng ký thêm một học sinh không đụng tới các dòng đang có', () => {
    // Đúng đường đi của POST /api/classes/enroll: đẩy 1 HS vào roster rồi ghi lại.
    const roster = ['HS2', 'HS3'];
    assert.deepEqual(diffRoster([...roster, 'HS1'], roster), {
      toAdd: ['HS1'],
      toRemove: [],
    });
  });

  it('danh sách rỗng nghĩa là gỡ hết, không phải bỏ qua', () => {
    assert.deepEqual(diffRoster([], ['A', 'B']), { toAdd: [], toRemove: ['A', 'B'] });
  });

  it('chạy lại cùng dữ liệu là không đổi (idempotent)', () => {
    assert.deepEqual(diffRoster(['A', 'B'], ['A', 'B']), { toAdd: [], toRemove: [] });
  });
});

describe('thời khoá biểu học sinh: bỏ lớp đã kết thúc', () => {
  const repo = LocalRepository.getInstance();

  it('slot của lớp Đã kết thúc không lọt vào TKB học sinh', async () => {
    const classes = await repo.getAllClasses();
    const activeCls = classes.find((c) => c.status === 'Đang mở');
    assert.ok(activeCls, 'Seed phải có lớp Đang mở');

    const finishedCls = { ...activeCls, id: 'CLS_FINISHED', code: 'FIN999', status: 'Đã kết thúc' as const };
    await repo.updateClass(finishedCls);

    const studentId = activeCls.studentIds?.[0];
    assert.ok(studentId, 'Lớp Đang mở đầu tiên phải có học sinh');

    const date = '2026-11-09';
    const slotOf = (id: string, classId: string): ScheduleSlot => ({
      id,
      classId,
      teacherId: activeCls.teacherId,
      date,
      shiftId: 1,
      startTime: '18:30',
      endTime: '20:30',
      subject: 'Toán',
      status: 'Đã lên lịch',
    });

    await repo.createScheduleSlotsBatch([
      slotOf('SLOT_ACTIVE', activeCls.id),
      slotOf('SLOT_FINISHED', finishedCls.id),
    ]);

    // Ghi danh cả hai lớp để chắc rằng việc lọc đến từ trạng thái lớp, không
    // phải từ việc học sinh không thuộc lớp.
    await repo.updateClass({ ...activeCls, studentIds: [...(activeCls.studentIds || []), studentId] });
    await repo.updateClass({ ...finishedCls, studentIds: [...(finishedCls.studentIds || []), studentId] });

    const { slots } = await loadScheduleView({ studentId, dateFrom: date, dateTo: date });
    const ids = slots.map((s) => s.id);

    assert.ok(ids.includes('SLOT_ACTIVE'), 'Buổi của lớp Đang mở phải còn');
    assert.ok(!ids.includes('SLOT_FINISHED'), 'Buổi của lớp Đã kết thúc phải bị loại');
  });
});
