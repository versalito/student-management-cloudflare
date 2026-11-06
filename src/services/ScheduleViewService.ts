import { repo } from '@/repositories';
import type { ScheduleSlotQuery, ScheduleSlotWithClassName } from '@/repositories/IRepository';
import type { ClassSection } from '@/types/classroom';
import type { StudentSessionBooking } from '@/types/booking';
import { dateToDayOfWeek } from '@/utils/date';
import { resolveSlotTimeRange } from '@/utils/slotTime';

/**
 * Dựng danh sách buổi học kèm dữ liệu hiển thị (giờ thật theo ca, tên giáo viên,
 * tên lớp) — dùng chung cho `GET /api/schedule` và `GET /api/bootstrap`.
 *
 * Tách ra khỏi route để bootstrap không phải gọi lại handler HTTP của chính nó
 * (1 hop mạng thừa) mà vẫn giữ đúng một nguồn logic.
 */
export interface ScheduleViewQuery {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  classId?: string;
  teacherId?: string;
  studentId?: string;
}

export interface ScheduleViewDeps {
  /** Dữ liệu tham chiếu đã nạp sẵn (bootstrap gộp request) — bỏ qua thì tự đọc. */
  classes?: Awaited<ReturnType<typeof repo.getAllClasses>>;
  sections?: ClassSection[];
  teachers?: Awaited<ReturnType<typeof repo.getAllTeachers>>;
}

export interface ScheduleView {
  slots: ScheduleSlotWithClassName[];
  /** Rỗng khi không có `studentId` (không lọc theo ca của học sinh). */
  studentSections: ClassSection[] | null;
}

/** Trạng thái booking còn hiệu lực trong thời khoá biểu (huỷ thì không hiện). */
const ACTIVE_BOOKING_STATUSES = ['Đã đăng ký', 'Đã học'] as const;

export async function loadScheduleView(
  query: ScheduleViewQuery,
  deps: ScheduleViewDeps = {}
): Promise<ScheduleView> {
  const slotQuery: ScheduleSlotQuery = {
    date: query.date || undefined,
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
    classId: query.classId || undefined,
    teacherId: query.teacherId || undefined,
  };

  // Học sinh chỉ thấy buổi thuộc ca mình tham gia (và đúng thứ đã chọn trong ca),
  // cộng thêm các buổi lẻ mình đã đặt. 2 query lấy ca + booking, 1 query lấy slot
  // đã lọc ở SQL — không đọc toàn bảng.
  let studentSections: ClassSection[] | null = null;
  const studentDaysBySection = new Map<string, number[]>();
  let bookings: StudentSessionBooking[] = [];
  let bookingBySlotId = new Map<string, StudentSessionBooking>();
  if (query.studentId) {
    studentSections = deps.sections ?? (await repo.getSectionsByStudentId(query.studentId));
    bookings = await repo.getSessionBookings({
      studentId: query.studentId,
      statuses: [...ACTIVE_BOOKING_STATUSES],
    });
    bookingBySlotId = new Map(bookings.map((b) => [b.slotId, b]));

    if (studentSections.length === 0 && bookings.length === 0) {
      return { slots: [], studentSections };
    }

    if (studentSections.length > 0) {
      slotQuery.sectionIds = Array.from(new Set(studentSections.map((s) => s.id)));
      slotQuery.classIds = Array.from(new Set(studentSections.map((s) => s.classId)));
      slotQuery.includeUnsectioned = true;
      slotQuery.excludeCancelled = true;
      for (const sec of studentSections) {
        // Thứ riêng của học sinh trong ca; nếu chưa chọn thì dùng thứ của ca.
        const chosen = sec.studentScheduleDays?.[query.studentId] || [];
        studentDaysBySection.set(sec.id, chosen.length > 0 ? chosen : sec.scheduleDays || []);
      }
    }
  }

  // Buổi lẻ nằm ngoài ca của học sinh nên phải truy vấn riêng theo id.
  const bookedSlotIds = bookings.map((b) => b.slotId);

  // Bảng slots là bảng lớn nên lọc ngay ở tầng dữ liệu; classes/sections/teachers
  // chỉ vài chục dòng nên đọc full để bổ sung dữ liệu hiển thị.
  const [rawSlots, bookedRawSlots, allClasses, allSections, allTeachers] = await Promise.all([
    // Có `studentId` mà không thuộc ca nào thì không cần query slot; còn lại
    // (admin/giáo viên, hoặc học sinh có ca) luôn query, kể cả khi chỉ lọc theo ngày.
    query.studentId && !slotQuery.sectionIds
      ? Promise.resolve([] as ScheduleSlotWithClassName[])
      : repo.getScheduleSlotsQuery(slotQuery),
    bookedSlotIds.length > 0
      ? repo.getScheduleSlotsQuery({
          ids: bookedSlotIds,
          date: query.date || undefined,
          dateFrom: query.dateFrom || undefined,
          dateTo: query.dateTo || undefined,
          excludeCancelled: true,
        })
      : Promise.resolve([] as ScheduleSlotWithClassName[]),
    deps.classes ? Promise.resolve(deps.classes) : repo.getAllClasses(),
    // Cần giờ thật của ca cho cả buổi lẻ (có thể thuộc lớp khác) nên nạp toàn bộ
    // ca khi học sinh có booking; trường hợp còn lại chỉ cần ca của chính họ.
    studentSections === null || bookings.length > 0
      ? repo.getAllClassSections()
      : Promise.resolve(studentSections),
    deps.teachers ? Promise.resolve(deps.teachers) : repo.getAllTeachers(),
  ]);

  const classMap = new Map(allClasses.map((cls) => [cls.id, cls]));
  // Giờ thật phải theo ca (class_sections). Slot cũ có thể lưu giờ lệch, nên
  // ưu tiên giờ của ca để nút điểm danh / đổi ca tính đúng trạng thái.
  const sectionTimeMap = new Map(
    allSections.filter((s) => s.isActive !== false).map((s) => [s.id, s])
  );
  const teacherMap = new Map(allTeachers.map((t) => [t.id, t]));

  const enrich = (raw: ScheduleSlotWithClassName[]): ScheduleSlotWithClassName[] =>
    raw
      // Lọc bỏ triệt để các slot mồ côi nếu lớp học đã bị xóa khỏi hệ thống.
      .filter((slot) => classMap.has(slot.classId))
      // Học sinh không còn thấy buổi của lớp đã kết thúc (khớp bất biến ở
      // STUDENT_PORTAL_FIX_SPEC §2: slotsInTimetable chỉ gồm lớp còn hiệu lực).
      .filter((slot) => !query.studentId || classMap.get(slot.classId)?.status !== 'Đã kết thúc')
      .map((slot) => {
        const cls = classMap.get(slot.classId);
        const sec = slot.sectionId ? sectionTimeMap.get(slot.sectionId) : undefined;
        const teacher = teacherMap.get(slot.teacherId);
        const times = resolveSlotTimeRange({
          sectionStartTime: sec?.startTime,
          sectionEndTime: sec?.endTime,
          slotStartTime: slot.startTime,
          slotEndTime: slot.endTime,
          classStartTime: cls?.startTime,
          classEndTime: cls?.endTime,
        });
        const booking = bookingBySlotId.get(slot.id);
        return {
          ...slot,
          startTime: times.startTime,
          endTime: times.endTime,
          subject: slot.subject || cls?.subject || cls?.name || '',
          className: slot.className || cls?.name || '',
          meetingLink: slot.meetingLink || cls?.meetingLink || '',
          teacherName: teacher?.name || '',
          source: booking ? ('booking' as const) : ('class' as const),
          bookingId: booking?.id,
        };
      });

  const enriched = enrich(rawSlots);

  // Thứ riêng của từng học sinh trong ca: chỉ thấy buổi thuộc thứ mình đã chọn.
  // Buổi lẻ học sinh tự chọn thì luôn hiện, không lọc theo thứ của ca.
  const classSlots =
    query.studentId && studentSections
      ? enriched.filter((slot) => {
          if (!slot.sectionId) return true;
          const days = studentDaysBySection.get(slot.sectionId) || [];
          if (days.length === 0) return true;
          const dow = dateToDayOfWeek(slot.date);
          return dow !== null && days.includes(dow);
        })
      : enriched;

  // Gộp buổi lẻ, bỏ trùng (một buổi vừa thuộc ca vừa được đặt lẻ thì chỉ hiện 1 lần
  // và ưu tiên nhãn ca học để không lệch với danh sách lớp).
  const seen = new Set(classSlots.map((s) => s.id));
  const bookedSlots = enrich(bookedRawSlots).filter((slot) => !seen.has(slot.id));

  const slots = [...classSlots, ...bookedSlots].sort((a, b) =>
    a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)
  );

  return { slots, studentSections };
}
