import { repo } from '@/repositories';
import type { ScheduleSlotQuery } from '@/repositories/IRepository';
import type { ClassSection } from '@/types/classroom';
import type { ScheduleSlot } from '@/types/schedule';
import { dateToDayOfWeek } from '@/utils/date';

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
  slots: ScheduleSlot[];
  /** Rỗng khi không có `studentId` (không lọc theo ca của học sinh). */
  studentSections: ClassSection[] | null;
}

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

  // Học sinh chỉ thấy buổi thuộc ca mình tham gia (và đúng thứ đã chọn trong ca).
  // 1 query lấy ca + thứ riêng, 1 query lấy slot đã lọc ở SQL — không đọc toàn bảng.
  let studentSections: ClassSection[] | null = null;
  const studentDaysBySection = new Map<string, number[]>();
  if (query.studentId) {
    studentSections = deps.sections ?? (await repo.getSectionsByStudentId(query.studentId));
    if (studentSections.length === 0) return { slots: [], studentSections };

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

  // Bảng slots là bảng lớn nên lọc ngay ở tầng dữ liệu; classes/sections/teachers
  // chỉ vài chục dòng nên đọc full để bổ sung dữ liệu hiển thị.
  const [rawSlots, allClasses, allSections, allTeachers] = await Promise.all([
    repo.getScheduleSlotsQuery(slotQuery),
    deps.classes ? Promise.resolve(deps.classes) : repo.getAllClasses(),
    studentSections
      ? Promise.resolve(studentSections)
      : deps.sections
        ? Promise.resolve(deps.sections)
        : repo.getAllClassSections(),
    deps.teachers ? Promise.resolve(deps.teachers) : repo.getAllTeachers(),
  ]);

  const classMap = new Map(allClasses.map((cls) => [cls.id, cls]));
  // Giờ thật phải theo ca (class_sections). Slot cũ có thể lưu giờ lệch, nên
  // ưu tiên giờ của ca để nút điểm danh / đổi ca tính đúng trạng thái.
  const sectionTimeMap = new Map(
    allSections.filter((s) => s.isActive !== false).map((s) => [s.id, s])
  );
  const teacherMap = new Map(allTeachers.map((t) => [t.id, t]));

  // Lọc bỏ triệt để các slot mồ côi nếu lớp học đã bị xóa khỏi hệ thống.
  const enriched: ScheduleSlot[] = rawSlots
    .filter((slot) => classMap.has(slot.classId))
    .map((slot) => {
      const cls = classMap.get(slot.classId);
      const sec = slot.sectionId ? sectionTimeMap.get(slot.sectionId) : undefined;
      const teacher = teacherMap.get(slot.teacherId);
      return {
        ...slot,
        startTime: (sec && sec.startTime) || slot.startTime || cls?.startTime || '18:30',
        endTime: (sec && sec.endTime) || slot.endTime || cls?.endTime || '20:30',
        subject: slot.subject || cls?.subject || cls?.name || '',
        meetingLink: slot.meetingLink || cls?.meetingLink || '',
        teacherName: teacher?.name || '',
      };
    });

  // Thứ riêng của từng học sinh trong ca: chỉ thấy buổi thuộc thứ mình đã chọn.
  const slots =
    query.studentId && studentSections
      ? enriched.filter((slot) => {
          if (!slot.sectionId) return true;
          const days = studentDaysBySection.get(slot.sectionId) || [];
          if (days.length === 0) return true;
          const dow = dateToDayOfWeek(slot.date);
          return dow !== null && days.includes(dow);
        })
      : enriched;

  return { slots, studentSections };
}
