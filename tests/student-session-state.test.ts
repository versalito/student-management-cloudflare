import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionState, evaluateSessionWindow } from '../src/services/StudentSessionService';
import type { ScheduleSlotWithClassName } from '../src/repositories/IRepository';
import type { AttendanceRecord } from '../src/types/attendance';

function slot(partial: Partial<ScheduleSlotWithClassName> & { id: string }): ScheduleSlotWithClassName {
  return {
    classId: 'CLS01',
    teacherId: 'GV001',
    date: '2026-11-06',
    shiftId: 1,
    startTime: '18:30',
    endTime: '20:30',
    subject: 'Toán',
    status: 'Đã lên lịch',
    className: 'Toán 12 - Ca tối',
    ...partial,
  };
}

describe('session-state: cửa sổ điểm danh do server quyết định', () => {
  it('mở đúng trong ca, đóng trước giờ và sau giờ', () => {
    assert.deepEqual(evaluateSessionWindow('18:30', '20:30', 18 * 60 + 29).open, false);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 18 * 60 + 30).open, true);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 20 * 60 + 30).open, true);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 20 * 60 + 31).open, false);
  });

  it('ca qua đêm mở ở cả hai phía nửa đêm', () => {
    assert.equal(evaluateSessionWindow('22:00', '01:00', 23 * 60).open, true);
    assert.equal(evaluateSessionWindow('22:00', '01:00', 30).open, true);
    assert.equal(evaluateSessionWindow('22:00', '01:00', 21 * 60 + 59).open, false);
    assert.equal(evaluateSessionWindow('22:00', '01:00', 60 + 1).open, false);
  });

  it('cùng dữ liệu + cùng giờ server ⇒ cùng kết quả (không phụ thuộc múi giờ máy client)', () => {
    const slots = [slot({ id: 'SCH1' })];
    const a = buildSessionState({ slots, records: [], today: '2026-11-06', now: '19:00' });
    const b = buildSessionState({ slots, records: [], today: '2026-11-06', now: '19:00' });
    assert.deepEqual(a, b);
    assert.equal(a.current?.id, 'SCH1');
    assert.equal(a.current?.canCheckIn, true);
  });

  it('current là ca đang diễn ra, next là ca gần nhất sau hiện tại', () => {
    const slots = [
      slot({ id: 'SCH_LATE', startTime: '21:00', endTime: '22:00' }),
      slot({ id: 'SCH_NOW' }),
      slot({ id: 'SCH_TOMORROW', date: '2026-11-07', startTime: '08:00', endTime: '10:00' }),
    ];
    const state = buildSessionState({ slots, records: [], today: '2026-11-06', now: '19:00' });
    assert.equal(state.current?.id, 'SCH_NOW');
    assert.equal(state.next?.id, 'SCH_LATE');
  });

  it('chưa tới giờ thì canCheckIn=false kèm lý do, không phải ca kết thúc', () => {
    const state = buildSessionState({
      slots: [slot({ id: 'SCH1' })],
      records: [],
      today: '2026-11-06',
      now: '18:00',
    });
    assert.equal(state.current, null);
    assert.equal(state.next?.id, 'SCH1');
    assert.equal(state.next?.canCheckIn, false);
    assert.match(state.next!.reason, /30 phút nữa/);
  });

  it('đã điểm danh thì không mở lại nút, badge giữ trạng thái thật', () => {
    const records: AttendanceRecord[] = [
      {
        id: 'ATT1',
        scheduleSlotId: 'SCH1',
        classId: 'CLS01',
        studentId: 'ST001',
        date: '2026-11-06',
        status: 'Đi muộn',
        checkinTime: '18:41',
        method: 'STUDENT_QUICK',
        updatedBy: 'ST001',
        updatedAt: '2026-11-06T11:41:00.000Z',
      },
    ];
    const state = buildSessionState({
      slots: [slot({ id: 'SCH1' })],
      records,
      today: '2026-11-06',
      now: '19:00',
    });
    assert.equal(state.current?.canCheckIn, false);
    assert.equal(state.current?.reason, 'Đã điểm danh');
    assert.equal(state.current?.checkedIn?.status, 'Đi muộn');
    assert.equal(state.checkedInToday.length, 1);
  });

  it('bỏ qua ca đã huỷ và ca của ngày khác', () => {
    const slots = [
      slot({ id: 'SCH_CANCELLED', status: 'Đã hủy' }),
      slot({ id: 'SCH_YESTERDAY', date: '2026-11-05' }),
    ];
    const state = buildSessionState({ slots, records: [], today: '2026-11-06', now: '19:00' });
    assert.equal(state.current, null);
    assert.equal(state.next, null);
  });

  it('trả tên lớp để client không phải ghép với /api/classes', () => {
    const state = buildSessionState({
      slots: [slot({ id: 'SCH1', className: 'Lý 11 - Ca 2' })],
      records: [],
      today: '2026-11-06',
      now: '19:00',
    });
    assert.equal(state.current?.className, 'Lý 11 - Ca 2');
  });
});
