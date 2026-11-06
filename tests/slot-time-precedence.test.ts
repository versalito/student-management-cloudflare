import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSlotTimeRange, DEFAULT_SLOT_START_TIME, DEFAULT_SLOT_END_TIME } from '../src/utils/slotTime';

/**
 * Hồi quy: slot cũ không lưu giờ, giờ thật nằm ở ca học/lớp. Nếu nơi nào đọc
 * thẳng `slot.startTime` thì nút điểm danh và API sẽ bất đồng (UI mở, API chặn).
 */
describe('giờ thật của buổi học: ca → slot → lớp', () => {
  it('ca học thắng slot và lớp', () => {
    assert.deepEqual(
      resolveSlotTimeRange({
        sectionStartTime: '08:00:00',
        sectionEndTime: '10:00:00',
        slotStartTime: '18:30',
        slotEndTime: '20:30',
        classStartTime: '13:30',
        classEndTime: '15:30',
      }),
      { startTime: '08:00', endTime: '10:00' },
    );
  });

  it('slot trống thì lấy giờ ca, không rơi về giờ mặc định', () => {
    assert.deepEqual(
      resolveSlotTimeRange({
        sectionStartTime: '10:15',
        sectionEndTime: '12:15',
        slotStartTime: '',
        slotEndTime: null,
      }),
      { startTime: '10:15', endTime: '12:15' },
    );
  });

  it('không có ca thì lấy giờ slot, rồi tới lớp', () => {
    assert.deepEqual(
      resolveSlotTimeRange({ slotStartTime: '15:45', slotEndTime: '17:45', classStartTime: '18:30' }),
      { startTime: '15:45', endTime: '17:45' },
    );
    assert.deepEqual(
      resolveSlotTimeRange({ classStartTime: '18:30', classEndTime: '20:30' }),
      { startTime: '18:30', endTime: '20:30' },
    );
  });

  it('mù hoàn toàn thì dùng mặc định thay vì undefined', () => {
    assert.deepEqual(resolveSlotTimeRange({}), {
      startTime: DEFAULT_SLOT_START_TIME,
      endTime: DEFAULT_SLOT_END_TIME,
    });
  });
});
