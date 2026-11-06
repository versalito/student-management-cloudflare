'use client';

import React from 'react';
import { ScheduleSlot } from '@/types/schedule';
import { timeToMinutes } from '@/utils/date';
import { cn } from '@/lib/cn';

/** Khung giờ cố định của trục timeline: 06:00 -> 23:00, bước 30 phút => 35 cột tick.
 * Bao trùm mọi ca học (Ca 1: 08:00 -> Ca 5: 20:30) không bị clipping. */
export const TIMELINE_START_MINUTES = 6 * 60; // 360
export const TIMELINE_END_MINUTES = 23 * 60; // 1380
export const TIMELINE_STEP_MINUTES = 30;
export const TIMELINE_TOTAL_MINUTES = TIMELINE_END_MINUTES - TIMELINE_START_MINUTES; // 1020

/** Số cột tick = (23h - 6h) / 30p + 1 = 35. */
export const TIMELINE_TICK_COUNT = TIMELINE_TOTAL_MINUTES / TIMELINE_STEP_MINUTES + 1;

/** Danh sách nhãn giờ trên trục (06:00, 06:30, ..., 23:00). Có thể dùng cho cả trục dọc lẫn trục ngang. */
export function buildTimelineTicks(): { minutes: number; label: string }[] {
  const ticks: { minutes: number; label: string }[] = [];
  for (let m = TIMELINE_START_MINUTES; m <= TIMELINE_END_MINUTES; m += TIMELINE_STEP_MINUTES) {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    ticks.push({ minutes: m, label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` });
  }
  return ticks;
}

/**
 * Clamp thời điểm bắt đầu/kết thúc của slot vào khung cố định 06:00 -> 23:00.
 * - Bắt đầu sớm hơn 06:00 => coi như 06:00.
 * - Kết thúc sau 23:00 (hoặc qua nửa đêm) => kéo tới 23:00 và đánh dấu "qua đêm".
 */
export function clampSlotToTimeline(slot: ScheduleSlot): {
  startMin: number;
  endMin: number;
  isOvernight: boolean;
} {
  const rawStart = timeToMinutes(slot.startTime || '00:00');
  const rawEnd = timeToMinutes(slot.endTime || '23:59');

  const isOvernight = rawEnd < rawStart || rawEnd > TIMELINE_END_MINUTES;

  const startMin = Math.max(TIMELINE_START_MINUTES, Math.min(rawStart, TIMELINE_END_MINUTES));
  const endMin = Math.max(TIMELINE_START_MINUTES, Math.min(rawEnd, TIMELINE_END_MINUTES));

  return { startMin, endMin, isOvernight };
}

/**
 * Bộ hiển thị giờ cột (dùng cho trục ngang 06:00->23:00).
 * Trả về % vị trí so với chiều rộng tổng của timeline.
 */
export function minuteToPercent(minutes: number): number {
  return (Math.min(Math.max(minutes, TIMELINE_START_MINUTES), TIMELINE_END_MINUTES) - TIMELINE_START_MINUTES) / TIMELINE_TOTAL_MINUTES * 100;
}

/** Slot render props truyền xuống cho block con (để từng trang tùy chỉnh nội dung). */
export interface TimelineSlotRenderProps {
  slot: ScheduleSlot;
  startMin: number;
  endMin: number;
  isOvernight: boolean;
}

/**
 * Trục giờ ngang (06:00 -> 23:00). Dùng trong admin + teacher (timeline 1 ngày).
 */
export function HorizontalTimelineAxis({ className = '' }: { className?: string }) {
  const ticks = buildTimelineTicks();
  return (
    <div className={cn('relative', className)}>
      {ticks.map(t => (
        <div
          key={t.minutes}
          className="absolute top-0 bottom-0 -translate-x-1/2"
          style={{ left: `${minuteToPercent(t.minutes)}%` }}
        >
          <div className="h-1.5 w-px bg-line-strong" />
          <span className="text-[9px] font-mono font-semibold text-muted-foreground whitespace-nowrap -ml-2 tabular">
            {t.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Đường lưới giờ (vạch dọc) cho block chứa các slot. */
export function TimelineGridLines() {
  const ticks = buildTimelineTicks();
  return (
    <div className="absolute inset-0 pointer-events-none">
      {ticks.map(t => (
        <div
          key={t.minutes}
          className="absolute top-0 bottom-0 w-px bg-line/40"
          style={{ left: `${minuteToPercent(t.minutes)}%` }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trục giờ co giãn theo dữ liệu thật
// ---------------------------------------------------------------------------

/** Khung giờ mặc định khi ngày không có ca học nào. */
export const DEFAULT_TIMELINE_START_MINUTES = 8 * 60; // 08:00
export const DEFAULT_TIMELINE_END_MINUTES = 21 * 60; // 21:00

export interface TimelineBounds {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Tính khung giờ hiển thị vừa đủ cho các ca học của một ngày.
 * Chỉ lấy từ ca sớm nhất đến ca muộn nhất rồi nới thêm 30 phút mỗi đầu,
 * nhờ vậy lịch không còn trải dài 06:00 – 23:00 với phần lớn là ô trống.
 */
export function computeTimelineBounds(slots: ScheduleSlot[]): TimelineBounds {
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;

  for (const slot of slots) {
    const start = timeToMinutes(slot.startTime || '');
    let end = timeToMinutes(slot.endTime || '');
    if (!start && !end) continue;
    // Ca qua đêm (kết thúc nhỏ hơn bắt đầu) được kéo sang ngày kế tiếp.
    if (end <= start) end = Math.min(start + 60, 24 * 60);
    minStart = Math.min(minStart, start);
    maxEnd = Math.max(maxEnd, end);
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) {
    return { startMinutes: DEFAULT_TIMELINE_START_MINUTES, endMinutes: DEFAULT_TIMELINE_END_MINUTES };
  }

  const startMinutes = Math.max(0, Math.floor((minStart - 30) / 30) * 30);
  const endMinutes = Math.min(24 * 60, Math.ceil((maxEnd + 30) / 30) * 30);
  return { startMinutes, endMinutes };
}

/** Danh sách vạch giờ giữa hai mốc, bước mặc định 30 phút. */
export function buildTicksBetween(
  startMinutes: number,
  endMinutes: number,
  stepMinutes: number = TIMELINE_STEP_MINUTES
): { minutes: number; label: string }[] {
  const ticks: { minutes: number; label: string }[] = [];
  const step = Math.max(15, stepMinutes);
  for (let m = startMinutes; m <= endMinutes; m += step) {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    ticks.push({ minutes: m, label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` });
  }
  return ticks;
}

/** Vị trí phần trăm của một mốc phút trong khung giờ đang hiển thị. */
export function minutesToPercentInRange(
  minutes: number,
  startMinutes: number,
  endMinutes: number
): number {
  const span = Math.max(1, endMinutes - startMinutes);
  const clamped = Math.min(Math.max(minutes, startMinutes), endMinutes);
  return ((clamped - startMinutes) / span) * 100;
}

/** Vị trí pixel (trục dọc) của một mốc phút, dùng cho lưới tuần. */
export function minutesToOffsetPx(
  minutes: number,
  startMinutes: number,
  pixelsPerMinute: number
): number {
  return (minutes - startMinutes) * pixelsPerMinute;
}

/** Số phút hiện tại theo giờ Việt Nam, dùng để vẽ vạch "bây giờ". */
export function nowMinutesInSaigon(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Saigon',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [hh, mm] = parts.split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

export interface LaidOutSlot<T extends ScheduleSlot = ScheduleSlot> {
  slot: T;
  startMin: number;
  endMin: number;
  isOvernight: boolean;
  /** Cột thứ mấy trong nhóm ca chồng lấn (bắt đầu từ 0). */
  column: number;
  /** Tổng số cột của nhóm ca chồng lấn chứa ca này. */
  columnCount: number;
  /**
   * Mức độ chồng lấn:
   * - 'conflict': cùng một lớp bị xếp hai ca chồng giờ => cần xử lý.
   * - 'parallel': hai lớp khác nhau chạy song song => bình thường với trung tâm dạy online,
   *   giáo viên có thể kèm nhiều nhóm cùng lúc nên không tính là lỗi.
   */
  overlap: 'none' | 'conflict' | 'parallel';
}

/**
 * Xếp các ca học của một ngày thành các cột khi chúng trùng giờ.
 * Ca không trùng nhau thì chiếm trọn chiều ngang; ca trùng giờ được chia đôi,
 * chia ba... để nhìn là thấy ngay chỗ bị trùng lịch.
 */
export function layoutDaySlots<T extends ScheduleSlot>(slots: T[]): LaidOutSlot<T>[] {
  const items = slots
    .map((slot) => {
      const { startMin, endMin, isOvernight } = clampSlotToTimeline(slot);
      return {
        slot,
        startMin,
        endMin: Math.max(endMin, startMin + 1),
        isOvernight,
      };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const laidOut: LaidOutSlot<T>[] = [];
  let group: typeof items = [];
  let groupEnd = -1;

  const flushGroup = () => {
    if (group.length === 0) return;
    const columnEnds: number[] = [];
    const placed = group.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMin);
      if (column === -1) {
        columnEnds.push(item.endMin);
        column = columnEnds.length - 1;
      } else {
        columnEnds[column] = item.endMin;
      }
      return { ...item, column };
    });
    const columnCount = Math.max(1, columnEnds.length);
    for (const item of placed) {
      // Trung tâm chạy online nên hai lớp khác nhau học song song là bình thường,
      // giáo viên cũng có thể kèm nhiều nhóm cùng lúc. Chỉ tính là trùng lịch khi cùng một lớp.
      let overlap: LaidOutSlot<T>['overlap'] = columnCount > 1 ? 'parallel' : 'none';
      if (columnCount > 1) {
        const clash = placed.some(
          (other) =>
            other !== item &&
            Math.max(item.startMin, other.startMin) < Math.min(item.endMin, other.endMin) &&
            other.slot.classId === item.slot.classId
        );
        if (clash) overlap = 'conflict';
      }
      laidOut.push({ ...item, columnCount, overlap });
    }
    group = [];
    groupEnd = -1;
  };

  for (const item of items) {
    if (group.length > 0 && item.startMin >= groupEnd) flushGroup();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  flushGroup();

  return laidOut.sort((a, b) => a.startMin - b.startMin || a.column - b.column);
}

/** Vạch đỏ "bây giờ" cho cột ngày hôm nay. */
export function TimelineNowMarker({
  startMinutes,
  endMinutes,
  pixelsPerMinute,
  label = 'Bây giờ',
}: {
  startMinutes: number;
  endMinutes: number;
  pixelsPerMinute: number;
  label?: string;
}) {
  const now = nowMinutesInSaigon();
  if (now < startMinutes || now > endMinutes) return null;
  const top = minutesToOffsetPx(now, startMinutes, pixelsPerMinute);
  return (
    <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: `${top}px` }}>
      <div className="flex items-center">
        <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
        <span className="flex-1 h-px bg-danger" />
      </div>
      <span className="absolute -top-2 right-1 text-[9px] font-bold text-danger bg-card px-1 rounded-pill border border-danger/30">
        {label}
      </span>
    </div>
  );
}
