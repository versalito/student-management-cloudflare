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
  it('mở sớm 10 phút trước giờ vào ca, đóng đúng giờ kết thúc', () => {
    assert.equal(evaluateSessionWindow('18:30', '20:30', 18 * 60 + 19).open, false);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 18 * 60 + 20).open, true);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 18 * 60 + 29).open, true);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 18 * 60 + 30).open, true);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 20 * 60 + 30).open, true);
    assert.equal(evaluateSessionWindow('18:30', '20:30', 20 * 60 + 31).open, false);
  });

  it('lý do nói rõ giờ mở và số phút còn lại', () => {
    const early = evaluateSessionWindow('18:30', '20:30', 18 * 60);
    assert.equal(early.open, false);
    assert.match(early.reason, /20 phút nữa|Còn 20 phút/);
    assert.match(evaluateSessionWindow('18:30', '20:30', 21 * 60).reason, /Ca đã kết thúc/);
  });

  it('ca qua đêm mở ở cả hai phía nửa đêm', () => {
    // 22:00 → 01:00, mở điểm danh từ 21:50.
    assert.equal(evaluateSessionWindow('22:00', '01:00', 21 * 60 + 49).open, false);
    assert.equal(evaluateSessionWindow('22:00', '01:00', 21 * 60 + 50).open, true);
    assert.equal(evaluateSessionWindow('22:00', '01:00', 23 * 60).open, true);
    assert.equal(evaluateSessionWindow('22:00', '01:00', 30).open, true);
    assert.equal(evaluateSessionWindow('22:00', '01:00', 61).open, false);
  });

  it('ca sát nửa đêm: mở ngay từ 00:00 của ngày học', () => {
    // 00:05 → 02:00, cửa sổ mở từ 23:55 hôm trước nên 00:00 hôm sau đã mở.
    assert.equal(evaluateSessionWindow('00:05', '02:00', 0).open, true);
    assert.equal(evaluateSessionWindow('00:05', '02:00', 5).open, true);
    assert.equal(evaluateSessionWindow('00:05', '02:00', 2 * 60).open, true);
    assert.equal(evaluateSessionWindow('00:05', '02:00', 2 * 60 + 1).open, false);
  });

  it('status là cờ máy đọc, khớp với từng nhánh lý do', () => {
    assert.equal(evaluateSessionWindow('18:30', '20:30', 18 * 60).status, 'not_open');
    assert.equal(evaluateSessionWindow('18:30', '20:30', 19 * 60).status, 'open');
    assert.equal(evaluateSessionWindow('18:30', '20:30', 21 * 60).status, 'ended');
    assert.equal(evaluateSessionWindow('22:00', '01:00', 30).status, 'open');
    // 01:01 cùng ngày: ca tối nay chưa bắt đầu ⇒ not_open, chưa phải ended.
    assert.equal(evaluateSessionWindow('22:00', '01:00', 61).status, 'not_open');
  });

  it('ca phủ trọn ngày vẫn mở suốt, không bị coi là khoảng rỗng', () => {
    assert.equal(evaluateSessionWindow('00:00', '23:59', 0).open, true);
    assert.equal(evaluateSessionWindow('00:00', '23:59', 12 * 60).open, true);
    assert.equal(evaluateSessionWindow('00:00', '23:59', 23 * 60 + 59).open, true);
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
    assert.match(state.next!.reason, /20 phút nữa/);
  });

  it('buổi vừa mở sớm không hiện lặp ở cả current lẫn sắp tới', () => {
    // 18:25 nằm trong cửa sổ mở sớm của ca 18:30, nên ca đó là `current`;
    // nó không được xuất hiện thêm trong `next`/`upcoming` nữa.
    const state = buildSessionState({
      slots: [slot({ id: 'SCH1' }), slot({ id: 'SCH2', startTime: '21:00', endTime: '22:00' })],
      records: [],
      today: '2026-11-06',
      now: '18:25',
    });
    assert.equal(state.current?.id, 'SCH1');
    assert.equal(state.current?.window, 'open');
    assert.equal(state.next?.id, 'SCH2');
    assert.deepEqual(
      state.upcoming.map((s) => s.id),
      ['SCH2']
    );
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
