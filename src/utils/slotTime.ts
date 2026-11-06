import { toHHMM } from '@/utils/schedule';

/** Thứ tự ưu tiên giờ học: ca học (class_sections) → slot → lớp → giờ mặc định. */
export interface SlotTimeSources {
  sectionStartTime?: string | null;
  sectionEndTime?: string | null;
  slotStartTime?: string | null;
  slotEndTime?: string | null;
  classStartTime?: string | null;
  classEndTime?: string | null;
}

export const DEFAULT_SLOT_START_TIME = '18:30';
export const DEFAULT_SLOT_END_TIME = '20:30';

/**
 * Giờ thật của một buổi học. Slot cũ có thể không lưu giờ (hoặc lưu giờ lệch), nên
 * mọi nơi tính trạng thái điểm danh phải dùng cùng một thứ tự ưu tiên này —
 * nếu không, nút trên giao diện và API sẽ bất đồng.
 */
export function resolveSlotTimeRange(sources: SlotTimeSources): {
  startTime: string;
  endTime: string;
} {
  return {
    startTime:
      toHHMM(sources.sectionStartTime) ||
      toHHMM(sources.slotStartTime) ||
      toHHMM(sources.classStartTime) ||
      DEFAULT_SLOT_START_TIME,
    endTime:
      toHHMM(sources.sectionEndTime) ||
      toHHMM(sources.slotEndTime) ||
      toHHMM(sources.classEndTime) ||
      DEFAULT_SLOT_END_TIME,
  };
}
