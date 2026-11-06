import { IRepository } from '@/repositories/IRepository';
import type { ScheduleSlotWithClassName } from '@/repositories/IRepository';
import type { StudentSessionBooking } from '@/types/booking';
import type { ClassEntity, ClassSection } from '@/types/classroom';
import { loadScheduleView } from '@/services/ScheduleViewService';
import { getNowTimeStr, getTodayDateStr, timeToMinutes } from '@/utils/date';
import { resolveSlotTimeRange } from '@/utils/slotTime';

/**
 * Đăng ký buổi lẻ ("học buổi", không mua gói theo ca).
 *
 * Quy tắc nghiệp vụ (một nguồn duy nhất, dùng cho cả GET lẫn POST):
 * - Chỉ lớp `Đang mở`, buổi chưa huỷ, và buổi chưa bắt đầu.
 * - Không trùng giờ với bất kỳ buổi nào khác trong thời khoá biểu của học sinh
 *   (ca đang theo + buổi lẻ đã đặt).
 * - Không đăng ký lại buổi đã có sẵn trong thời khoá biểu.
 * - Huỷ được đến trước giờ bắt đầu; dòng dữ liệu giữ lại với `status = 'Đã hủy'`.
 */

export interface BookableSlot {
  id: string;
  classId: string;
  className: string;
  subject: string;
  sectionId?: string;
  teacherName?: string;
  date: string;
  startTime: string;
  endTime: string;
  meetingLink?: string;
  /** Buổi này đang trùng giờ với một buổi khác của học sinh. */
  conflict?: { slotId: string; className: string; startTime: string; endTime: string };
}

export type BookingErrorCode =
  | 'SLOT_NOT_FOUND'
  | 'SLOT_CANCELLED'
  | 'CLASS_NOT_OPEN'
  | 'SLOT_STARTED'
  | 'ALREADY_IN_SCHEDULE'
  | 'TIME_CONFLICT'
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_COMPLETED';

export class BookingError extends Error {
  constructor(public code: BookingErrorCode, message: string, public status = 400) {
    super(message);
  }
}

/** Khoảng phút tuyệt đối của một buổi; ca qua nửa đêm được cộng thêm 1 ngày. */
function absoluteRange(date: string, startTime: string, endTime: string): [number, number] {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

export function slotRangesOverlap(
  a: { date: string; startTime: string; endTime: string },
  b: { date: string; startTime: string; endTime: string },
): boolean {
  if (a.date !== b.date) return false;
  const [aStart, aEnd] = absoluteRange(a.date, a.startTime, a.endTime);
  const [bStart, bEnd] = absoluteRange(b.date, b.startTime, b.endTime);
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

/** Buổi đã bắt đầu (hoặc đã qua) so với đồng hồ Asia/Saigon. */
export function slotHasStarted(
  slot: { date: string; startTime: string },
  today = getTodayDateStr(),
  nowTime = getNowTimeStr(),
): boolean {
  if (slot.date < today) return true;
  if (slot.date > today) return false;
  return timeToMinutes(nowTime) >= timeToMinutes(slot.startTime);
}

const ACTIVE_STATUSES = ['Đã đăng ký', 'Đã học'] as const;

export class BookingService {
  constructor(private repo: IRepository) {}

  /**
   * Danh sách buổi có thể đăng ký trong khoảng ngày.
   * Bỏ các buổi đã có trong thời khoá biểu của học sinh (kể cả buổi lẻ đã đặt),
   * nhưng vẫn đánh dấu `conflict` để giao diện khoá nút bấm.
   */
  public async listBookableSlots(params: {
    studentId: string;
    from: string;
    to: string;
    subject?: string;
  }): Promise<BookableSlot[]> {
    const { studentId, from, to } = params;

    const [classes, sections, teachers, view, bookings] = await Promise.all([
      this.repo.getAllClasses(),
      this.repo.getAllClassSections(),
      this.repo.getAllTeachers(),
      loadScheduleView({ studentId, dateFrom: from, dateTo: to }),
      this.repo.getSessionBookings({ studentId, statuses: [...ACTIVE_STATUSES] }),
    ]);

    const openClassIds = classes.filter((c) => c.status === 'Đang mở').map((c) => c.id);
    if (openClassIds.length === 0) return [];

    const rawSlots = await this.repo.getScheduleSlotsQuery({
      classIds: openClassIds,
      dateFrom: from,
      dateTo: to,
      excludeCancelled: true,
    });

    const classMap = new Map(classes.map((c) => [c.id, c]));
    const sectionMap = new Map(sections.map((s) => [s.id, s]));
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));
    const inSchedule = new Set(view.slots.map((s) => s.id));
    const bookedIds = new Set(bookings.map((b) => b.slotId));
    const occupied = view.slots.map((s) => ({
      id: s.id,
      className: s.className || s.classId,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    const today = getTodayDateStr();
    const nowTime = getNowTimeStr();

    return rawSlots
      .filter((slot) => !inSchedule.has(slot.id) && !bookedIds.has(slot.id))
      .map((slot) => this.enrich(slot, classMap, sectionMap, teacherMap))
      .filter((slot) => !!slot)
      .map((slot) => slot as BookableSlot)
      .filter((slot) => !slotHasStarted(slot, today, nowTime))
      .filter((slot) => !params.subject || slot.subject === params.subject)
      .map((slot) => {
        const clash = occupied.find((other) => slotRangesOverlap(slot, other));
        return clash
          ? { ...slot, conflict: { slotId: clash.id, className: clash.className, startTime: clash.startTime, endTime: clash.endTime } }
          : slot;
      })
      .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  }

  /** Buổi lẻ học sinh đã đặt (kèm dữ liệu hiển thị), mới nhất trước. */
  public async listMyBookings(studentId: string, params: { from?: string; to?: string } = {}) {
    const bookings = await this.repo.getSessionBookings({
      studentId,
      statuses: [...ACTIVE_STATUSES],
    });
    if (bookings.length === 0) return [];

    const [slots, classes, sections, teachers] = await Promise.all([
      this.repo.getScheduleSlotsQuery({
        ids: bookings.map((b) => b.slotId),
        dateFrom: params.from,
        dateTo: params.to,
      }),
      this.repo.getAllClasses(),
      this.repo.getAllClassSections(),
      this.repo.getAllTeachers(),
    ]);

    const classMap = new Map(classes.map((c) => [c.id, c]));
    const sectionMap = new Map(sections.map((s) => [s.id, s]));
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));
    const slotMap = new Map(slots.map((s) => [s.id, s]));

    return bookings
      .map((booking) => {
        const raw = slotMap.get(booking.slotId);
        if (!raw) return null;
        const slot = this.enrich(raw, classMap, sectionMap, teacherMap);
        if (!slot) return null;
        return {
          booking,
          slot,
          cancellable: booking.status === 'Đã đăng ký' && !slotHasStarted(slot),
        };
      })
      .filter((row): row is { booking: StudentSessionBooking; slot: BookableSlot; cancellable: boolean } => !!row)
      .sort((a, b) =>
        a.slot.date === b.slot.date
          ? a.slot.startTime.localeCompare(b.slot.startTime)
          : a.slot.date.localeCompare(b.slot.date),
      );
  }

  /** Đặt buổi. Gọi lại trên cùng buổi là no-op (idempotent). */
  public async book(studentId: string, slotId: string): Promise<{ booking: StudentSessionBooking; alreadyBooked: boolean }> {
    const slot = await this.repo.getScheduleSlotById(slotId);
    if (!slot) throw new BookingError('SLOT_NOT_FOUND', 'Buổi học không tồn tại', 404);
    if (slot.status === 'Đã hủy') throw new BookingError('SLOT_CANCELLED', 'Buổi học này đã bị huỷ', 400);

    const cls = await this.repo.getClassById(slot.classId);
    if (!cls) throw new BookingError('SLOT_NOT_FOUND', 'Lớp của buổi học không tồn tại', 404);
    if (cls.status !== 'Đang mở') {
      throw new BookingError('CLASS_NOT_OPEN', `Lớp ${cls.name} không mở đăng ký (trạng thái: ${cls.status})`, 400);
    }

    const section = slot.sectionId ? await this.repo.getSectionById(slot.sectionId) : null;
    const times = resolveSlotTimeRange({
      sectionStartTime: section?.startTime,
      sectionEndTime: section?.endTime,
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      classStartTime: cls.startTime,
      classEndTime: cls.endTime,
    });
    const target = { date: slot.date, startTime: times.startTime, endTime: times.endTime };

    if (slotHasStarted(target)) {
      throw new BookingError('SLOT_STARTED', 'Buổi học này đã bắt đầu, không thể đăng ký nữa', 400);
    }

    const existing = await this.repo.getSessionBookings({ studentId, slotId });
    const active = existing.find((b) => b.status !== 'Đã hủy');
    if (active) return { booking: active, alreadyBooked: true };

    // Thời khoá biểu hiện tại = ca đang theo + buổi lẻ còn hiệu lực.
    const view = await loadScheduleView({ studentId, date: slot.date });
    const inSchedule = view.slots.find((s) => s.id === slotId);
    if (inSchedule) {
      throw new BookingError(
        'ALREADY_IN_SCHEDULE',
        'Buổi này đã có trong thời khoá biểu của bạn, không cần đăng ký',
        400,
      );
    }
    const clash = view.slots.find((s) => slotRangesOverlap(target, s));
    if (clash) {
      throw new BookingError(
        'TIME_CONFLICT',
        `Trùng giờ với buổi ${clash.className || clash.classId} (${clash.startTime} - ${clash.endTime}). Huỷ buổi đó trước hoặc chọn buổi khác.`,
        409,
      );
    }

    const now = new Date().toISOString();
    const cancelled = existing.find((b) => b.status === 'Đã hủy');
    if (cancelled) {
      const revived: StudentSessionBooking = { ...cancelled, status: 'Đã đăng ký', updatedAt: now };
      return { booking: await this.repo.updateSessionBooking(revived), alreadyBooked: false };
    }

    const created = await this.repo.createSessionBooking({
      id: `BKG_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      studentId,
      slotId,
      status: 'Đã đăng ký',
      createdAt: now,
      updatedAt: now,
    });
    return { booking: created, alreadyBooked: false };
  }

  /** Huỷ buổi lẻ. Chỉ trước giờ bắt đầu và khi chưa điểm danh. */
  public async cancel(studentId: string, slotId: string): Promise<StudentSessionBooking> {
    const existing = await this.repo.getSessionBookings({ studentId, slotId });
    const booking = existing.find((b) => b.status === 'Đã đăng ký');
    if (!booking) {
      const completed = existing.find((b) => b.status === 'Đã học');
      if (completed) throw new BookingError('BOOKING_COMPLETED', 'Buổi này đã học, không thể huỷ', 400);
      throw new BookingError('BOOKING_NOT_FOUND', 'Bạn chưa đăng ký buổi này', 404);
    }

    const slot = await this.repo.getScheduleSlotById(slotId);
    if (!slot) throw new BookingError('SLOT_NOT_FOUND', 'Buổi học không tồn tại', 404);
    const cls = await this.repo.getClassById(slot.classId);
    const section = slot.sectionId ? await this.repo.getSectionById(slot.sectionId) : null;
    const times = resolveSlotTimeRange({
      sectionStartTime: section?.startTime,
      sectionEndTime: section?.endTime,
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      classStartTime: cls?.startTime,
      classEndTime: cls?.endTime,
    });
    if (slotHasStarted({ date: slot.date, startTime: times.startTime })) {
      throw new BookingError('SLOT_STARTED', 'Buổi học đã bắt đầu, không thể huỷ', 400);
    }

    return this.repo.updateSessionBooking({
      ...booking,
      status: 'Đã hủy',
      updatedAt: new Date().toISOString(),
    });
  }

  private enrich(
    slot: ScheduleSlotWithClassName,
    classMap: Map<string, ClassEntity>,
    sectionMap: Map<string, ClassSection>,
    teacherMap: Map<string, { name: string }>,
  ): BookableSlot | null {
    const cls = classMap.get(slot.classId);
    if (!cls || cls.status !== 'Đang mở') return null;
    const section = slot.sectionId ? sectionMap.get(slot.sectionId) : undefined;
    const times = resolveSlotTimeRange({
      sectionStartTime: section?.startTime,
      sectionEndTime: section?.endTime,
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      classStartTime: cls.startTime,
      classEndTime: cls.endTime,
    });
    return {
      id: slot.id,
      classId: slot.classId,
      className: slot.className || cls.name,
      subject: slot.subject || cls.subject,
      sectionId: slot.sectionId,
      teacherName: teacherMap.get(slot.teacherId)?.name,
      date: slot.date,
      startTime: times.startTime,
      endTime: times.endTime,
      meetingLink: slot.meetingLink || cls.meetingLink,
    };
  }
}

/**
 * Sau khi ghi điểm danh, chốt các buổi lẻ tương ứng thành `Đã học` để học sinh
 * không huỷ được buổi đã học và bảng "buổi đã đặt" phản ánh đúng.
 */
export async function settleBookingsAttended(
  repo: IRepository,
  records: Array<{ scheduleSlotId: string; studentId: string; status: string }>,
): Promise<void> {
  const attended = records.filter((r) => r.status === 'Có mặt' || r.status === 'Đi muộn' || r.status === 'Điểm danh bù');
  if (attended.length === 0) return;

  const slotIds = Array.from(new Set(attended.map((r) => r.scheduleSlotId)));
  const bookings = await repo.getSessionBookings({ slotIds, statuses: ['Đã đăng ký'] });
  if (bookings.length === 0) return;

  const key = (slotId: string, studentId: string) => `${slotId}::${studentId}`;
  const attendedKeys = new Set(attended.map((r) => key(r.scheduleSlotId, r.studentId)));
  await Promise.all(
    bookings
      .filter((b) => attendedKeys.has(key(b.slotId, b.studentId)))
      .map((b) =>
        repo.updateSessionBooking({ ...b, status: 'Đã học', updatedAt: new Date().toISOString() }),
      ),
  );
}
