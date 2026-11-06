import { repo } from '@/repositories';
import type { ScheduleSlot } from '@/types/schedule';
import { resolveSlotTimeRange } from '@/utils/slotTime';

/**
 * Giờ thật của một buổi học, nạp ca học + lớp rồi áp thứ tự ưu tiên dùng chung
 * (ca học → slot → lớp). Mọi API quyết định mở/đóng điểm danh phải đi qua đây để
 * không lệch với nút bấm trên giao diện (vốn tính từ `ScheduleViewService`).
 */
export async function resolveScheduleSlotTimes(
  slot: Pick<ScheduleSlot, 'sectionId' | 'startTime' | 'endTime' | 'classId'>,
): Promise<{ startTime: string; endTime: string }> {
  const [section, cls] = await Promise.all([
    slot.sectionId ? repo.getSectionById(slot.sectionId) : Promise.resolve(null),
    repo.getClassById(slot.classId),
  ]);
  return resolveSlotTimeRange({
    sectionStartTime: section?.startTime,
    sectionEndTime: section?.endTime,
    slotStartTime: slot.startTime,
    slotEndTime: slot.endTime,
    classStartTime: cls?.startTime,
    classEndTime: cls?.endTime,
  });
}
