import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { timeToMinutes } from '@/utils/date';
import { TimeShift } from '@/types/schedule';
import { ClassEntity } from '@/types/classroom';
import { ShiftService } from '@/services/ShiftService';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const DAY_NAMES: Record<number, string> = {
  2: 'Thứ 2',
  3: 'Thứ 3',
  4: 'Thứ 4',
  5: 'Thứ 5',
  6: 'Thứ 6',
  7: 'Thứ 7',
  8: 'Chủ Nhật',
};

/**
 * Tính khoảng giờ [startMins, endMins] của một lớp.
 * Nếu lớp có startTime/endTime riêng (custom) thì dùng trực tiếp, ngược lại fallback theo shiftId -> ca học trong DB.
 * startMins có thể > endMins cho ca qua nửa đêm.
 */
function getClassTimeRange(
  cls: ClassEntity,
  shifts: TimeShift[],
): { startMins: number; endMins: number; startLabel: string; endLabel: string } | null {
  let startTime: string | undefined = cls.startTime;
  let endTime: string | undefined = cls.endTime;

  if (!startTime || !endTime) {
    const shift = shifts.find(s => s.id === Number(cls.shiftId));
    if (!shift) return null;
    startTime = shift.startTime;
    endTime = shift.endTime;
  }

  return {
    startMins: timeToMinutes(startTime),
    endMins: timeToMinutes(endTime),
    startLabel: startTime,
    endLabel: endTime,
  };
}

/**
 * Kiểm tra ca học target có trùng giờ với bất kỳ lớp nào student đã enrolled hay không.
 * Bỏ qua chính lớp đích và các lớp sẽ rời đi (excludeClassIds).
 * Trả về null nếu không trùng, hoặc đối tượng mô tả lớp bị trùng.
 */
async function findOverlappingEnrollment(
  studentId: string,
  targetClass: ClassEntity,
  shifts: TimeShift[],
  excludeClassIds: string[] = [],
): Promise<{ className: string; dayName: string; startLabel: string; endLabel: string } | null> {
  const targetRange = getClassTimeRange(targetClass, shifts);
  if (!targetRange) return null;

  const skipIds = new Set([targetClass.id, ...excludeClassIds]);
  const student = await repo.getStudentById(studentId);
  const enrolledIds = student?.enrolledClassIds || [];

  const targetDays = new Set(targetClass.scheduleDays || []);

  for (const enrolledId of enrolledIds) {
    if (skipIds.has(enrolledId)) continue;

    const enrolled = await repo.getClassById(enrolledId);
    if (!enrolled) continue;

    const commonDays = (enrolled.scheduleDays || []).filter(d => targetDays.has(d));
    if (commonDays.length === 0) continue;

    const enrolledRange = getClassTimeRange(enrolled, shifts);
    if (!enrolledRange) continue;

    const overlap = hasTimeOverlap(
      targetRange.startMins,
      targetRange.endMins,
      enrolledRange.startMins,
      enrolledRange.endMins,
    );

    if (overlap) {
      const firstCommonDay = commonDays[0];
      return {
        className: enrolled.name,
        dayName: DAY_NAMES[firstCommonDay] || `Thứ ${firstCommonDay}`,
        startLabel: enrolledRange.startLabel,
        endLabel: enrolledRange.endLabel,
      };
    }
  }

  return null;
}

/**
 * Xác định 2 khoảng thời gian có trùng nhau hay không, xử lý ca qua nửa đêm.
 */
function hasTimeOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  const aStart = startA;
  let aEnd = endA;
  const bStart = startB;
  let bEnd = endB;

  if (aStart > aEnd) aEnd += 1440;
  if (bStart > bEnd) bEnd += 1440;

  const maxStart = Math.max(aStart, bStart);
  const minEnd = Math.min(aEnd, bEnd);

  return maxStart < minEnd;
}

/** Dựng ClassEntity tạm từ ClassSection để kiểm tra trùng giờ/ca. */
function sectionAsClass(
  section: { classId: string; name: string; shiftId?: number; startTime?: string; endTime?: string; scheduleDays: number[]; teacherId?: string },
  cls: ClassEntity | null,
): ClassEntity {
  return {
    id: cls?.id || section.classId,
    name: cls?.name || section.name,
    subject: cls?.subject || '',
    teacherId: section.teacherId || cls?.teacherId || '',
    studentIds: cls?.studentIds || [],
    tuitionFee: cls?.tuitionFee || 0,
    scheduleDays: section.scheduleDays.length > 0 ? section.scheduleDays : (cls?.scheduleDays || []),
    shiftId: section.shiftId ?? cls?.shiftId,
    startTime: section.startTime ?? cls?.startTime,
    endTime: section.endTime ?? cls?.endTime,
    status: cls?.status || 'Đang mở',
  };
}

/** Đồng bộ danh sách học viên lớp (class_students) = hợp tất cả học viên của các ca trong lớp. */
async function syncClassFromSections(classId: string): Promise<void> {
  const sections = await repo.getClassSections(classId);
  const unionIds = new Set<string>();
  for (const sec of sections) {
    for (const sid of sec.studentIds || []) unionIds.add(sid);
  }
  const cls = await repo.getClassById(classId);
  if (!cls) return;
  cls.studentIds = Array.from(unionIds);
  await repo.updateClass(cls);
}

/** Lấy ca mặc định của lớp (ca đầu tiên), tạo mới một ca kế thừa thông tin lớp nếu lớp chưa có ca. */
async function resolveSection(classId: string, sectionId?: string | null) {
  if (sectionId) {
    const sec = await repo.getSectionById(sectionId);
    if (sec) return sec;
  }

  const sections = await repo.getClassSections(classId);
  if (sections.length > 0) return sections[0];

  // Lớp cũ chưa có ca -> tạo ca mặc định kế thừa thông tin lớp.
  const cls = await repo.getClassById(classId);
  if (!cls) return null;
  const section = {
    id: 'SEC_' + classId,
    classId,
    name: cls.name,
    shiftId: cls.shiftId,
    startTime: cls.startTime,
    endTime: cls.endTime,
    scheduleDays: cls.scheduleDays || [],
    teacherId: cls.teacherId,
    isActive: true,
    studentIds: cls.studentIds || [],
  };
  await repo.createClassSection(section);
  return section;
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
   const {
     classId,
     sectionId,
     studentId,
     action,
     targetSectionId,
     targetShiftId,
      scheduleDays,
   } = body;

    // Học viên chỉ được tự ghi danh/huỷ/đổi ca cho chính mình và không tự đặt vai trò.
    const isStudent = auth.user.role === 'STUDENT';
    if (isStudent && !isSelfOrStaff(auth.user, studentId)) {
      return NextResponse.json({ error: 'Không có quyền thao tác đăng ký lớp cho học viên khác' }, { status: 403 });
    }

    if (!classId || !studentId || !action) {
      return NextResponse.json({ error: 'Thiếu thông tin classId, studentId hoặc action' }, { status: 400 });
    }

    const cls = await repo.getClassById(classId);
    if (!cls) {
      return NextResponse.json({ error: 'Không tìm thấy lớp học' }, { status: 404 });
    }

    const student = await repo.getStudentById(studentId);
    if (!student) {
      return NextResponse.json({ error: 'Không tìm thấy học viên' }, { status: 404 });
    }

    const section = await resolveSection(classId, sectionId);
    if (!section) {
      return NextResponse.json({ error: 'Không tìm thấy ca học của lớp' }, { status: 404 });
    }

   const shifts = await ShiftService.getAllShifts();

    // Chuẩn hoá thứ riêng của học sinh (2..7, 8 = Chủ Nhật). Rỗng/bỏ trống = theo đúng lịch ca.
    const normalizedDays = Array.isArray(scheduleDays)
      ? scheduleDays.map(Number).filter(d => Number.isInteger(d) && d >= 2 && d <= 8)
      : [];

   // Học sinh tự đăng ký/đổi ca thì không bị chặn vì trùng giờ; chỉ quản trị viên mới bị chặn
    // để tránh xếp lớp chồng lấn ngoài ý muốn.
    // Danh tính lấy từ phiên đăng nhập, không tin body.
    const actorId = auth.user.id;
    const actorRoleResolved: string = auth.user.role;
    const isStudentSelfService = auth.user.role === 'STUDENT';

    if (action === 'ENROLL') {
      if (!isStudentSelfService) {
        const enrollOverlap = await findOverlappingEnrollment(studentId, sectionAsClass(section, cls), shifts);
        if (enrollOverlap) {
          return NextResponse.json({
            error: `Ca học này trùng giờ với lớp ${enrollOverlap.className} bạn đã đăng ký (${enrollOverlap.dayName}, ${enrollOverlap.startLabel}-${enrollOverlap.endLabel}). Vui lòng chọn ca khác.`,
          }, { status: 409 });
        }
      }

      await repo.addStudentToSection(section.id, studentId, normalizedDays);
      await syncClassFromSections(classId);

      if (!student.enrolledClassIds.includes(classId)) {
        student.enrolledClassIds.push(classId);
        await repo.updateStudent(student);
      }

      await repo.addAuditLog({
        action: 'UPDATE',
        userId: actorId,
        userName: auth.user.name,
        userRole: actorRoleResolved || 'ADMIN',
        targetResource: 'CLASS_ENROLLMENT',
        targetId: classId,
        details: `Thêm học viên ${studentId} (${student.name}) vào lớp ${classId} (${cls.name}) - ca ${section.id}`,
      });
      return NextResponse.json({ success: true, message: `Đã thêm học viên ${student.name} vào ca ${section.name || section.id} của lớp ${cls.name}` });
    }

    if (action === 'UNENROLL') {
      await repo.removeStudentFromSection(section.id, studentId);
      await syncClassFromSections(classId);

      // Re-fetch de lay danh sach hoc vien moi sau khi dong bo (dung cho ca local & supabase).
      const clsAfterUnenroll = await repo.getClassById(classId);
      if (!(clsAfterUnenroll?.studentIds || []).includes(studentId)) {
        student.enrolledClassIds = student.enrolledClassIds.filter(id => id !== classId);
        await repo.updateStudent(student);
      }

      await repo.addAuditLog({
        action: 'UPDATE',
        userId: actorId,
        userName: auth.user.name,
        userRole: actorRoleResolved || 'ADMIN',
        targetResource: 'CLASS_ENROLLMENT',
        targetId: classId,
        details: `Xoá học viên ${studentId} (${student.name}) khỏi lớp ${classId} (${cls.name}) - ca ${section.id}`,
      });
      return NextResponse.json({ success: true, message: `Đã xoá học viên ${student.name} khỏi ca ${section.name || section.id} của lớp ${cls.name}` });
    }

    if (action === 'CHANGE_SHIFT') {
      // Đổi ca trong cùng một lớp: chuyển học viên từ ca hiện tại sang ca mục tiêu.
      const targetSectionIdResolved = targetSectionId || null;
      let targetSection = targetSectionIdResolved
        ? await repo.getSectionById(targetSectionIdResolved)
        : null;

      if (!targetSection && targetShiftId !== undefined && targetShiftId !== null) {
        const targetSections = await repo.getClassSections(classId);
        targetSection = targetSections.find(s => s.shiftId === Number(targetShiftId)) || null;
      }

      if (!targetSection) {
        return NextResponse.json({ error: 'Thiếu thông tin ca mới (targetSectionId hoặc targetShiftId)' }, { status: 400 });
      }

      if (targetSection.id === section.id) {
        return NextResponse.json({ error: 'Bạn đang học đúng ca này rồi. Chọn ca khác nhé.' }, { status: 400 });
      }

      // Phải thuộc từng ca: ca hiện tại của học viên phải là ca đang rời đi.
      if (!(section.studentIds || []).includes(studentId)) {
        return NextResponse.json({ error: 'Học sinh không thuộc ca hiện tại của lớp này' }, { status: 400 });
      }

      if (!isStudentSelfService) {
        const changeOverlap = await findOverlappingEnrollment(
          studentId,
          sectionAsClass(targetSection, cls),
          shifts,
          [classId],
        );
        if (changeOverlap) {
          return NextResponse.json({
            error: `Ca học này trùng giờ với lớp ${changeOverlap.className} bạn đã đăng ký (${changeOverlap.dayName}, ${changeOverlap.startLabel}-${changeOverlap.endLabel}). Vui lòng chọn ca khác.`,
          }, { status: 409 });
        }
      }

      // Chuyển học viên giữa 2 ca của cùng lớp.
     await repo.removeStudentFromSection(section.id, studentId);
      await repo.addStudentToSection(targetSection.id, studentId, normalizedDays);
     await syncClassFromSections(classId);

      // Lớp giữ nguyên nên enrolledClassIds không đổi; đảm bảo vẫn tồn tại.
      if (!student.enrolledClassIds.includes(classId)) {
        student.enrolledClassIds.push(classId);
        await repo.updateStudent(student);
      }

      await repo.addAuditLog({
        action: 'SCHEDULE_CHANGE',
        userId: actorId,
        userName: auth.user.name,
        userRole: auth.user.role,
        targetResource: 'CLASS_ENROLLMENT',
        targetId: classId,
        details: `Học viên ${studentId} (${student.name}) đổi ca từ ${section.id} sang ${targetSection.id} trong lớp ${classId} (${cls.name})`,
      });

      return NextResponse.json({
        success: true,
        message: `Đổi ca thành công sang ${targetSection.name || targetSection.id}`,
        targetSectionId: targetSection.id,
        targetShiftId: (targetSection.shiftId ?? Number(targetShiftId)) || undefined,
      });
    }

    return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi xử lý gán lớp' }, { status: 500 });
  }
}
