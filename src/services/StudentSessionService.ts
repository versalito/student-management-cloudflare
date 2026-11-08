import { repo } from '@/repositories';
import { loadScheduleView } from '@/services/ScheduleViewService';
import { getNowTimeStr, getTodayDateStr, getTodayDateStrByDate, timeToMinutes } from '@/utils/date';
import type { AttendanceRecord } from '@/types/attendance';
import type { ScheduleSlotWithClassName } from '@/repositories/IRepository';
import type { SessionStateSlot, SessionWindowStatus, StudentSessionState } from '@/types/session';

/** Kết quả tính cửa sổ điểm danh: `status` để code so sánh, `reason` để hiển thị. */
export interface SessionWindowVerdict {
  open: boolean;
  status: SessionWindowStatus;
  reason: string;
}

/** Số ngày nhìn về trước để tìm buổi kế tiếp. */
const LOOKAHEAD_DAYS = 7;

/**
 * Học sinh được điểm danh sớm tối đa chừng này phút so với giờ vào ca.
 * Đây là nguồn duy nhất của cửa sổ: `POST /api/attendance` (STUDENT_CHECKIN)
 * gọi lại chính hàm dưới đây nên nút trên giao diện và API không thể lệch nhau.
 */
export const EARLY_CHECKIN_MINUTES = 10;

/**
 * Cửa sổ điểm danh = `[start − EARLY_CHECKIN_MINUTES, end]`.
 *
 * `nowMins` là phút tính từ nửa đêm của ngày đang xét. Ca qua đêm (22:00 → 01:00)
 * mở ở cả hai phía nửa đêm; ca phủ trọn ngày (00:00 → 23:59) mở suốt vì điểm mở
 * chỉ lùi 10 phút, không quấn vòng qua nửa đêm.
 */
export function evaluateSessionWindow(
  startTime: string,
  endTime: string,
  nowMins: number,
  earlyMinutes: number = EARLY_CHECKIN_MINUTES
): SessionWindowVerdict {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const opens = start - earlyMinutes;
  const overnight = end < start;

  const open = overnight ? nowMins >= opens || nowMins <= end : nowMins >= opens && nowMins <= end;
  if (open) return { open: true, status: 'open', reason: 'Đang trong ca' };

  const beforeOpen = overnight ? nowMins > end && nowMins < opens : nowMins < opens;
  if (beforeOpen) {
    const suffix = earlyMinutes > 0 ? ` (mở sớm ${earlyMinutes} phút)` : '';
    return {
      open: false,
      status: 'not_open',
      reason: `Còn ${opens - nowMins} phút nữa mới mở điểm danh${suffix}`,
    };
  }
  return { open: false, status: 'ended', reason: 'Ca đã kết thúc' };
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
    const win: SessionWindowVerdict =
      slot.date === today
        ? evaluateSessionWindow(slot.startTime, slot.endTime, nowMins)
        : {
            open: false,
            status: slot.date > today ? 'not_open' : 'ended',
            reason: slot.date > today ? 'Chưa tới ngày học' : 'Ca đã kết thúc',
          };

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
      window: win.status,
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

  // Cửa sổ mở sớm 10 phút nên buổi hôm nay vừa vào `current` vẫn thoả "startTime > now".
  // Loại nó ra để dashboard không hiện cùng một buổi ở cả "đang diễn ra" lẫn "sắp tới".
  const upcoming = ordered.filter((e) => {
    if (current && e.state.id === current.id) return false;
    return e.state.date > today || (e.state.date === today && timeToMinutes(e.state.startTime) > nowMins);
  });
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
