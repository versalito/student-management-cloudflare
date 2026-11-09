import { User } from '@/types/auth';
import { Student } from '@/types/student';
import { Teacher } from '@/types/teacher';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { ScheduleSlot, ClassRequest } from '@/types/schedule';
import { AttendanceRecord } from '@/types/attendance';
import { TuitionInvoice, PayrollRecord } from '@/types/finance';
import { SessionPackage } from '@/types/package';
import { AuditLog } from '@/types/audit';
import { StudentSessionBooking } from '@/types/booking';
import { AppNotification } from '@/types/notification';


// ============================================================================
// DATA MAPPERS (Database snake_case <-> Application camelCase)
// ============================================================================

export function mapUserFromDb(row: any): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    name: row.name,
    avatar: row.avatar || undefined,
    isActive: Boolean(row.is_active),
  };
}

export function mapUserToDb(user: User): any {
  return {
    id: user.id,
    username: user.username,
    password_hash: user.passwordHash,
    role: user.role,
    name: user.name,
    avatar: user.avatar || null,
    is_active: user.isActive,
    updated_at: new Date().toISOString(),
  };
}

export function mapTeacherFromDb(row: any): Teacher {
  const assignedClassIds = Array.isArray(row.classes)
    ? row.classes.map((c: any) => c.id)
    : (row.assignedClassIds || []);

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    specialty: row.specialty,
    hourlyRate: Number(row.hourly_rate),
    // Đơn giá mỗi ca dạy (dùng để tính lương). Trước đây bị bỏ sót khi đọc
    // nên mọi thay đổi đơn giá trong trang nhân sự đều không lưu được.
    ratePerSession: row.rate_per_session !== null && row.rate_per_session !== undefined
      ? Number(row.rate_per_session)
      : undefined,
    status: row.status,
    bio: row.bio || undefined,
    assignedClassIds,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

export function mapTeacherToDb(teacher: Teacher): any {
  return {
    id: teacher.id,
    name: teacher.name,
    phone: teacher.phone,
    specialty: teacher.specialty,
    hourly_rate: teacher.hourlyRate,
    rate_per_session: teacher.ratePerSession ?? teacher.hourlyRate ?? null,
    status: teacher.status,
    bio: teacher.bio || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapStudentFromDb(row: any): Student {
  const enrolledClassIds = Array.isArray(row.class_students)
    ? row.class_students.map((cs: any) => cs.class_id)
    : (row.enrolledClassIds || []);

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    dateOfBirth: typeof row.date_of_birth === 'string' ? row.date_of_birth.split('T')[0] : row.date_of_birth,
    gender: row.gender,
    address: row.address,
    status: row.status,
    enrolledClassIds,
    avatarUrl: row.avatar_url || undefined,
    parentPhone: row.parent_phone || undefined,
    assignmentUrl: row.assignment_url || undefined,
    createdAt: row.created_at || new Date().toISOString(),

    homeTown: row.home_town || undefined,
    gradeLevel: row.grade_level || undefined,
    targetUniversity: row.target_university || undefined,
    customUniversity: row.custom_university || undefined,
    examBlock: row.exam_block || undefined,
    studyGoal: row.study_goal || undefined,
    facebookUrl: row.facebook_url || undefined,
    otherNotes: row.other_notes || undefined,
    registeredDate: row.registered_date ? (typeof row.registered_date === 'string' ? row.registered_date.split('T')[0] : row.registered_date) : undefined,
    totalSessionsInMonth: row.total_sessions_in_month !== undefined ? Number(row.total_sessions_in_month) : 12,
    attendedSessionsInMonth: row.attended_sessions_in_month !== undefined ? Number(row.attended_sessions_in_month) : 0,
    absentSessionsInMonth: row.absent_sessions_in_month !== undefined ? Number(row.absent_sessions_in_month) : 0,
    remainingSessions: row.remaining_sessions !== undefined ? Number(row.remaining_sessions) : 12,
  };
}

export function mapStudentToDb(student: Student): any {
  return {
    id: student.id,
    name: student.name,
    phone: student.phone,
    date_of_birth: student.dateOfBirth || null,
    gender: student.gender || 'Nam',
    address: student.address || null,
    status: student.status,
    avatar_url: student.avatarUrl || null,
    parent_phone: student.parentPhone || null,
    assignment_url: student.assignmentUrl || null,

    home_town: student.homeTown || null,
    grade_level: student.gradeLevel || null,
    target_university: student.targetUniversity || null,
    custom_university: student.customUniversity || null,
    exam_block: student.examBlock || null,
    study_goal: student.studyGoal || null,
    facebook_url: student.facebookUrl || null,
    other_notes: student.otherNotes || null,
    registered_date: student.registeredDate || null,
    total_sessions_in_month: student.totalSessionsInMonth ?? 12,
    attended_sessions_in_month: student.attendedSessionsInMonth ?? 0,
    absent_sessions_in_month: student.absentSessionsInMonth ?? 0,
    remaining_sessions: student.remainingSessions ?? 12,

    updated_at: new Date().toISOString(),
  };
}

export function mapClassFromDb(row: any): ClassEntity {
  const studentIds = Array.isArray(row.class_students)
    ? row.class_students.map((cs: any) => cs.student_id)
    : (row.studentIds || []);

  return {
    id: row.id,
    // Cột classes.code đã bị xoá khỏi DB (update_2026-10-07) nên không đọc/ghi nữa.
    name: row.name,
    subject: row.subject,
    teacherId: row.teacher_id,
    studentIds,
    tuitionFee: Number(row.tuition_fee),
    scheduleDays: row.schedule_days || [],
    shiftId: row.shift_id ? Number(row.shift_id) : 1,
    // Không tự gán giờ mặc định: lớp không có giờ riêng thì để trống,
    // giao diện sẽ lấy giờ thật theo ca (shift_id) trong bảng time_shifts.
    startTime: row.start_time ? String(row.start_time).substring(0, 5) : undefined,
    endTime: row.end_time ? String(row.end_time).substring(0, 5) : undefined,
    isRecurring: row.is_recurring !== undefined ? Boolean(row.is_recurring) : true,
    meetingLink: row.meeting_link || undefined,
    status: row.status,
  };
}

export function mapClassToDb(cls: ClassEntity): any {
  return {
    id: cls.id,
    name: cls.name,
    subject: cls.subject,
    teacher_id: cls.teacherId,
    tuition_fee: cls.tuitionFee,
    schedule_days: cls.scheduleDays,
    shift_id: cls.shiftId || 1,
    start_time: cls.startTime || null,
    end_time: cls.endTime || null,
    is_recurring: cls.isRecurring !== undefined ? cls.isRecurring : true,
    meeting_link: cls.meetingLink || null,
    status: cls.status,
    updated_at: new Date().toISOString(),
  };
}

export function mapClassSectionFromDb(row: any): ClassSection {
  const studentIds = Array.isArray(row.class_section_students)
    ? row.class_section_students.map((css: any) => css.student_id)
    : (row.studentIds || []);

  // Thứ riêng của từng học sinh trong ca (class_section_students.schedule_days).
  const studentScheduleDays: Record<string, number[]> = {};
  if (Array.isArray(row.class_section_students)) {
    for (const css of row.class_section_students) {
      if (css.student_id === undefined || css.student_id === null) continue;
      const days = Array.isArray(css.schedule_days)
        ? css.schedule_days.map(Number).filter((d: number) => Number.isInteger(d))
        : [];
      studentScheduleDays[css.student_id] = days;
    }
  }

  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    shiftId: row.shift_id ? Number(row.shift_id) : undefined,
    startTime: row.start_time ? String(row.start_time).substring(0, 5) : undefined,
    endTime: row.end_time ? String(row.end_time).substring(0, 5) : undefined,
    scheduleDays: row.schedule_days || [],
    teacherId: row.teacher_id || undefined,
    isActive: row.is_active !== undefined ? Boolean(row.is_active) : true,
    studentIds,
    studentScheduleDays,
    createdAt: row.created_at || undefined,
    updatedAt: row.updated_at || undefined,
  };
}

export function mapClassSectionToDb(section: ClassSection): any {
  return {
    id: section.id,
    class_id: section.classId,
    name: section.name,
    shift_id: section.shiftId || null,
    start_time: section.startTime || null,
    end_time: section.endTime || null,
    schedule_days: section.scheduleDays || [],
    teacher_id: section.teacherId || null,
    is_active: section.isActive,
    updated_at: new Date().toISOString(),
  };
}

export function mapScheduleSlotFromDb(row: any): ScheduleSlot {
  return {
    id: row.id,
    classId: row.class_id,
    sectionId: row.section_id || undefined,
    teacherId: row.teacher_id,
    date: typeof row.date === 'string' ? row.date.split('T')[0] : row.date,
    shiftId: Number(row.shift_id),
    // Postgres trả 'HH:mm:ss'; giao diện chỉ cần 'HH:mm'.
    startTime: row.start_time ? String(row.start_time).substring(0, 5) : row.start_time,
    endTime: row.end_time ? String(row.end_time).substring(0, 5) : row.end_time,
    subject: row.subject,
    topic: row.topic || undefined,
    meetingLink: row.meeting_link || undefined,
    status: row.status,
    checkinTime: row.checkin_time || undefined,
    checkoutTime: row.checkout_time || undefined,
    checkinStatus: row.checkin_status || undefined,
    checkinMethod: row.checkin_method || undefined,
    checkinNote: row.checkin_note || undefined,
  };
}

export function mapScheduleSlotToDb(slot: ScheduleSlot): any {
  return {
    id: slot.id,
    class_id: slot.classId,
    section_id: slot.sectionId || null,
    teacher_id: slot.teacherId,
    date: slot.date,
    shift_id: slot.shiftId,
    start_time: slot.startTime,
    end_time: slot.endTime,
    subject: slot.subject,
    topic: slot.topic || null,
    meeting_link: slot.meetingLink || null,
    status: slot.status,
    checkin_time: slot.checkinTime || null,
    checkout_time: slot.checkoutTime || null,
    checkin_status: slot.checkinStatus || null,
    checkin_method: slot.checkinMethod || null,
    checkin_note: slot.checkinNote || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapAttendanceRecordFromDb(row: any): AttendanceRecord {
  return {
    id: row.id,
    scheduleSlotId: row.schedule_slot_id,
    classId: row.class_id,
    studentId: row.student_id,
    date: typeof row.date === 'string' ? row.date.split('T')[0] : row.date,
    status: row.status,
    checkinTime: row.checkin_time || undefined,
    note: row.note || undefined,
    originalSlotId: row.original_slot_id || undefined,
    makeupReason: row.makeup_reason || undefined,
    method: row.method || 'MANUAL',
    updatedBy: row.updated_by,
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

/**
 * Bọc một giá trị thành literal an toàn cho cú pháp `or(...)`/`eq.` của PostgREST.
 *
 * Không quote thì `,` và `)` trong giá trị bị hiểu là cú pháp, tức là người gọi
 * `?id=x,role.eq.ADMIN` chèn thêm được điều kiện lọc. Bọc nháy kép biến chúng
 * thành dữ liệu; nháy kép bên trong được escape để không đóng chuỗi sớm.
 */
export function quotePgValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function mapAttendanceRecordToDb(rec: AttendanceRecord): any {
  return {
    id: rec.id,
    schedule_slot_id: rec.scheduleSlotId,
    class_id: rec.classId,
    student_id: rec.studentId,
    date: rec.date,
    status: rec.status,
    checkin_time: rec.checkinTime || null,
    note: rec.note || null,
    original_slot_id: rec.originalSlotId || null,
    makeup_reason: rec.makeupReason || null,
    method: rec.method || 'MANUAL',
    updated_by: rec.updatedBy,
    updated_at: rec.updatedAt || new Date().toISOString(),
  };
}

export function mapClassRequestFromDb(row: any): ClassRequest {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    scheduleSlotId: row.schedule_slot_id,
    type: row.type,
    reason: row.reason,
    targetScheduleSlotId: row.target_schedule_slot_id || undefined,
    status: row.status,
    reviewedBy: row.reviewed_by || undefined,
    reviewNote: row.review_note || undefined,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

export function mapClassRequestToDb(req: ClassRequest): any {
  return {
    id: req.id,
    student_id: req.studentId,
    class_id: req.classId,
    schedule_slot_id: req.scheduleSlotId,
    type: req.type,
    reason: req.reason,
    target_schedule_slot_id: req.targetScheduleSlotId || null,
    status: req.status,
    reviewed_by: req.reviewedBy || null,
    review_note: req.reviewNote || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapTuitionInvoiceFromDb(row: any): TuitionInvoice {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    packageId: row.package_id || undefined,
    packageName: row.package_name || undefined,
    packagePrice: row.package_price !== undefined && row.package_price !== null ? Number(row.package_price) : undefined,
    sessionCount: row.session_count !== undefined && row.session_count !== null ? Number(row.session_count) : undefined,
    usedSessions: row.used_sessions !== undefined && row.used_sessions !== null ? Number(row.used_sessions) : undefined,
    title: row.title,
    amount: Number(row.amount),
    paidAmount: Number(row.paid_amount),
    remainingAmount: Number(row.remaining_amount),
    dueDate: typeof row.due_date === 'string' ? row.due_date.split('T')[0] : row.due_date,
    status: row.status,
    paidDate: row.paid_date ? (typeof row.paid_date === 'string' ? row.paid_date.split('T')[0] : row.paid_date) : undefined,
    paymentMethod: row.payment_method || undefined,
    transactionCode: row.transaction_code || undefined,
    note: row.note || undefined,
  };
}

export function mapTuitionInvoiceToDb(inv: TuitionInvoice): any {
  return {
    id: inv.id,
    student_id: inv.studentId,
    class_id: inv.classId,
    package_id: inv.packageId || null,
    package_name: inv.packageName || null,
    package_price: inv.packagePrice ?? null,
    session_count: inv.sessionCount ?? 0,
    used_sessions: inv.usedSessions ?? 0,
    title: inv.title,
    amount: inv.amount,
    paid_amount: inv.paidAmount,
    remaining_amount: inv.remainingAmount,
    due_date: inv.dueDate,
    status: inv.status,
    paid_date: inv.paidDate || null,
    payment_method: inv.paymentMethod || null,
    transaction_code: inv.transactionCode || null,
    note: inv.note || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapPayrollRecordFromDb(row: any): PayrollRecord {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    month: row.month,
    totalSlots: Number(row.total_slots),
    totalHours: Number(row.total_hours),
    hourlyRate: Number(row.hourly_rate),
    grossSalary: Number(row.gross_salary),
    bonus: Number(row.bonus),
    deduction: Number(row.deduction),
    netSalary: Number(row.net_salary),
    status: row.status,
    paidDate: row.paid_date ? (typeof row.paid_date === 'string' ? row.paid_date.split('T')[0] : row.paid_date) : undefined,
  };
}

export function mapPayrollRecordToDb(rec: PayrollRecord): any {
  return {
    id: rec.id,
    teacher_id: rec.teacherId,
    month: rec.month,
    total_slots: rec.totalSlots,
    total_hours: rec.totalHours,
    hourly_rate: rec.hourlyRate,
    gross_salary: rec.grossSalary,
    bonus: rec.bonus,
    deduction: rec.deduction,
    net_salary: rec.netSalary,
    status: rec.status,
    paid_date: rec.paidDate || null,
    updated_at: new Date().toISOString(),
  };
}

export function mapAuditLogFromDb(row: any): AuditLog {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userRole: row.user_role,
    action: row.action,
    targetResource: row.target_resource,
    targetId: row.target_id,
    details: row.details,
    oldValue: row.old_value || undefined,
    newValue: row.new_value || undefined,
    ipAddress: row.ip_address || undefined,
    timestamp: row.timestamp || new Date().toISOString(),
  };
}

export function mapAuditLogToDb(log: Omit<AuditLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): any {
  return {
    id: log.id,
    user_id: log.userId,
    user_name: log.userName,
    user_role: log.userRole,
    action: log.action,
    target_resource: log.targetResource,
    target_id: log.targetId,
    details: log.details,
    old_value: log.oldValue || null,
    new_value: log.newValue || null,
    ip_address: log.ipAddress || null,
    timestamp: log.timestamp || new Date().toISOString(),
  };
}

export function mapNotificationFromDb(row: any): AppNotification {
  return {
    id: row.id,
    recipientRole: row.recipient_role || undefined,
    recipientUserId: row.recipient_user_id || undefined,
    title: row.title,
    message: row.message,
    type: row.type,
    link: row.link || undefined,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at || new Date().toISOString(),
  };
}

export function mapNotificationToDb(notif: Omit<AppNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): any {
  return {
    id: notif.id,
    recipient_role: notif.recipientRole || null,
    recipient_user_id: notif.recipientUserId || null,
    title: notif.title,
    message: notif.message,
    type: notif.type,
    link: notif.link || null,
    is_read: notif.isRead,
    created_at: notif.createdAt || new Date().toISOString(),
  };
}

export function mapSessionPackageFromDb(row: any): SessionPackage {
  return {
    id: row.id,
    name: row.name,
    sessionCount: Number(row.session_count) || 0,
    price: Number(row.price) || 0,
    isActive: row.is_active !== undefined ? Boolean(row.is_active) : true,
    description: row.description || undefined,
    createdAt: row.created_at || undefined,
    updatedAt: row.updated_at || undefined,
  };
}

export function mapSessionPackageToDb(pkg: SessionPackage): any {
  return {
    id: pkg.id,
    name: pkg.name,
    session_count: pkg.sessionCount,
    price: pkg.price,
    description: pkg.description || null,
    is_active: pkg.isActive,
    updated_at: new Date().toISOString(),
  };
}

export function mapSessionBookingFromDb(row: any): StudentSessionBooking {
  return {
    id: row.id,
    studentId: row.student_id,
    slotId: row.slot_id,
    status: row.status,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

export function mapSessionBookingToDb(booking: StudentSessionBooking): any {
  return {
    student_id: booking.studentId,
    slot_id: booking.slotId,
    status: booking.status,
    updated_at: new Date().toISOString(),
  };
}

/**
 * PostgREST báo `PGRST205` khi bảng chưa có trong schema cache — tức migration
 * `update_2026-11-06-student-session-bookings.sql` chưa chạy trên DB đó.
 *
 * Bảng này chỉ phục vụ tính năng buổi lẻ; thiếu nó không được phép làm sập thời
 * khoá biểu và điểm danh (những đường đọc gọi `getSessionBookings` chung một
 * request). Đọc thì coi như chưa có booking nào; ghi thì báo lỗi rõ ràng.
 */
export function isMissingBookingsTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  return /Could not find the table 'public\.student_session_bookings'/.test(error.message || '');
}

export const BOOKINGS_TABLE_MISSING_MESSAGE =
  'Chưa chạy migration buổi lẻ trên database: chạy supabase/update_2026-11-06-student-session-bookings.sql trong SQL Editor của Supabase.';

// ============================================================================
// SUPABASE REPOSITORY IMPLEMENTATION
// ============================================================================

