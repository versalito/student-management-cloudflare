import { repo } from '@/repositories';
import { loadScheduleView } from '@/services/ScheduleViewService';
import { getNowTimeStr, getTodayDateStr, getTodayDateStrByDate, timeToMinutes } from '@/utils/date';
import type { AttendanceRecord } from '@/types/attendance';
import type { ScheduleSlotWithClassName } from '@/repositories/IRepository';
import type { SessionStateSlot, StudentSessionState } from '@/types/session';

/** Số ngày nhìn về trước để tìm buổi kế tiếp. */
const LOOKAHEAD_DAYS = 7;

/** Cửa sổ điểm danh = đúng ca học, khớp kiểm tra ở POST /api/attendance (STUDENT_CHECKIN). */
export function evaluateSessionWindow(
  startTime: string,
  endTime: string,
  nowMins: number
): { open: boolean; reason: string } {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const overnight = start > end;
  const open = overnight ? nowMins >= start || nowMins <= end : nowMins >= start && nowMins <= end;

  if (open) return { open: true, reason: 'Đang trong ca' };
  if (!overnight && nowMins < start) {
    return { open: false, reason: `Còn ${start - nowMins} phút nữa mới tới giờ` };
  }
  return { open: false, reason: 'Ca đã kết thúc' };
}

export interface SessionSnapshotInput {
  slots: ScheduleSlotWithClassName[];
  records: AttendanceRecord[];
  /** Ngày hôm nay theo Asia/Saigon, dạng YYYY-MM-DD. */
  today: string;
  /** Giờ hiện tại theo Asia/Saigon, dạng HH:mm. */
  now: string;
}

/**
 * Phần thuần (không I/O): từ slot + bản ghi điểm danh suy ra current/next.
 * Tách ra để test được biên giờ, ca qua đêm và thứ tự sắp xếp mà không cần đồng hồ thật.
 */
export function buildSessionState({
  slots,
  records,
  today,
  now,
}: SessionSnapshotInput): StudentSessionState {
  const nowMins = timeToMinutes(now);
  const recordMap = new Map<string, AttendanceRecord>(records.map((r) => [r.scheduleSlotId, r]));

  const evaluate = (slot: ScheduleSlotWithClassName) => {
    const rec = recordMap.get(slot.id);
    const win =
      slot.date === today
        ? evaluateSessionWindow(slot.startTime, slot.endTime, nowMins)
        : { open: false, reason: slot.date > today ? 'Chưa tới ngày học' : 'Ca đã kết thúc' };

    const state: SessionStateSlot = {
      id: slot.id,
      classId: slot.classId,
      className: slot.className,
      sectionId: slot.sectionId,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      meetingLink: slot.meetingLink,
      canCheckIn: win.open && !rec,
      reason: rec ? 'Đã điểm danh' : win.reason,
      checkedIn: rec ? { status: rec.status, checkinTime: rec.checkinTime } : undefined,
    };
    return { state, inWindow: win.open };
  };

  const ordered = slots
    .filter((s) => s.status !== 'Đã hủy')
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    .map(evaluate);

  const todaySessions = ordered.filter((e) => e.state.date === today);
  // Buổi đang diễn ra vẫn là `current` kể cả khi đã điểm danh (để hiện badge).
  const current = todaySessions.find((e) => e.inWindow)?.state ?? null;

  const upcoming = ordered.filter(
    (e) => e.state.date > today || (e.state.date === today && timeToMinutes(e.state.startTime) > nowMins)
  );
  const next = upcoming[0]?.state ?? null;

  return {
    today,
    now,
    current,
    next,
    upcoming: upcoming.slice(0, 5).map((e) => e.state),
    todaySessions: todaySessions.map((e) => e.state),
    checkedInToday: todaySessions.filter((e) => !!e.state.checkedIn).map((e) => e.state),
  };
}

/**
 * Ảnh chụp trạng thái buổi học của một học sinh, tính bằng giờ server (Asia/Saigon).
 * Là nguồn duy nhất cho dashboard/TKB: client không tự so đồng hồ máy.
 */
export async function buildStudentSessionState(studentId: string): Promise<StudentSessionState> {
  const today = getTodayDateStr();
  const now = getNowTimeStr();

  const horizonDate = new Date(`${today}T00:00:00+07:00`);
  horizonDate.setDate(horizonDate.getDate() + LOOKAHEAD_DAYS);
  const horizon = getTodayDateStrByDate(horizonDate);

  const [{ slots }, records] = await Promise.all([
    loadScheduleView({ studentId, dateFrom: today, dateTo: horizon }),
    repo.getAttendanceByStudentId(studentId),
  ]);

  return buildSessionState({ slots, records, today, now });
}
