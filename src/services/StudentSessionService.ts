import { repo } from '@/repositories';
import { loadScheduleView } from '@/services/ScheduleViewService';
import { daysBetween, getNowTimeStr, getTodayDateStr, getTodayDateStrByDate, timeToMinutes } from '@/utils/date';
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
  earlyMinutes: number = EARLY_CHECKIN_MINUTES,
  dayOffset?: number
): SessionWindowVerdict {
  const start = timeToMinutes(startTime);
  const endRaw = timeToMinutes(endTime);
  const isOvernight = endRaw < start;

  // Khi có thông tin ngày (dayOffset): tính chính xác theo mốc phút từ 00:00 ngày bắt đầu ca.
  // dayOffset = daysBetween(slot.date, today):
  //   0: cùng ngày bắt đầu; 1: hôm sau (qua nửa đêm); < 0: ngày tương lai
  if (dayOffset !== undefined) {
    const end = isOvernight ? 1440 + endRaw : endRaw;
    const opens = start - earlyMinutes;
    const currentMins = dayOffset * 1440 + nowMins;

    if (currentMins >= opens && currentMins <= end) {
      return { open: true, status: 'open', reason: 'Đang trong ca' };
    }

    if (currentMins < opens) {
      if (dayOffset < 0) {
        return { open: false, status: 'not_open', reason: 'Chưa tới ngày học' };
      }
      const diff = opens - currentMins;
      const suffix = earlyMinutes > 0 ? ` (mở sớm ${earlyMinutes} phút)` : '';
      return {
        open: false,
        status: 'not_open',
        reason: `Còn ${diff} phút nữa mới mở điểm danh${suffix}`,
      };
    }

    return { open: false, status: 'ended', reason: 'Ca đã kết thúc' };
  }

  // Fallback khi không truyền dayOffset: giữ logic cũ (cho unit test hoặc caller không có ngày)
  const opens = start - earlyMinutes;
  const open = isOvernight ? nowMins >= opens || nowMins <= endRaw : nowMins >= opens && nowMins <= endRaw;
  if (open) return { open: true, status: 'open', reason: 'Đang trong ca' };

  const beforeOpen = isOvernight ? nowMins > endRaw && nowMins < opens : nowMins < opens;
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
    const dayOffset = daysBetween(slot.date, today);
    const win: SessionWindowVerdict = evaluateSessionWindow(
      slot.startTime,
      slot.endTime,
      nowMins,
      EARLY_CHECKIN_MINUTES,
      dayOffset
    );
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

  // Ca hôm nay gồm ca có ngày bắt đầu là `today`, hoặc ca qua đêm từ hôm qua vẫn đang diễn ra hôm nay.
  const todaySessions = ordered.filter(
    (e) => e.state.date === today || (e.inWindow && daysBetween(e.state.date, today) === 1)
  );
  // Buổi đang diễn ra vẫn là `current` kể cả khi đã điểm danh (để hiện badge).
  const current = ordered.find((e) => e.inWindow)?.state ?? null;

  // Cửa sổ mở sớm 10 phút nên buổi hôm nay vừa vào `current` vẫn thoả "startTime > now".
  // Loại nó ra để dashboard không hiện cùng một buổi ở cả "đang diễn ra" lẫn "sắp tới".
  const upcoming = ordered.filter((e) => {
    if (current && e.state.id === current.id) return false;
    if (e.inWindow) return false;
    const diff = daysBetween(e.state.date, today);
    if (diff < 0) return true; // ngày tương lai (slot.date > today)
    if (diff === 0) return timeToMinutes(e.state.startTime) > nowMins;
    return false;
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

  // Nạp từ hôm qua (-1 ngày) để bắt ca qua đêm bắt đầu tối hôm trước
  // và kéo dài sang rạng sáng hôm nay.
  const yesterdayDate = new Date(`${today}T00:00:00+07:00`);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getTodayDateStrByDate(yesterdayDate);

  const horizonDate = new Date(`${today}T00:00:00+07:00`);
  horizonDate.setDate(horizonDate.getDate() + LOOKAHEAD_DAYS);
  const horizon = getTodayDateStrByDate(horizonDate);

  const [{ slots }, records] = await Promise.all([
    loadScheduleView({ studentId, dateFrom: yesterday, dateTo: horizon }),
    repo.getAttendanceByStudentId(studentId),
  ]);

  return buildSessionState({ slots, records, today, now });
}
