import { SupabaseClient } from '@supabase/supabase-js';
import { IRepository } from './IRepository';
import type {
  AuditLogPage,
  AuditLogPageQuery,
  ClassMembership,
  ClassMembershipQuery,
  ScheduleSlotQuery,
  ScheduleSlotWithClassName,
  StudentPage,
  StudentPageQuery,
} from './IRepository';
import { User } from '@/types/auth';
import { uniFilterToSql } from '@/lib/studentFilters';
import { Student } from '@/types/student';
import { Teacher } from '@/types/teacher';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { ScheduleSlot, ClassRequest, TimeShift, StudentSlotSwap } from '@/types/schedule';
import { AttendanceRecord } from '@/types/attendance';
import { TuitionInvoice, PayrollRecord } from '@/types/finance';
import { SessionPackage } from '@/types/package';
import { AuditLog } from '@/types/audit';
import { AppNotification } from '@/types/notification';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { dateToDayOfWeek } from '@/utils/date';

// ============================================================================
// DATA MAPPERS (Database snake_case <-> Application camelCase)
// ============================================================================

function mapUserFromDb(row: any): User {
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

function mapUserToDb(user: User): any {
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

function mapTeacherFromDb(row: any): Teacher {
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

function mapTeacherToDb(teacher: Teacher): any {
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

function mapStudentFromDb(row: any): Student {
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

function mapStudentToDb(student: Student): any {
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

function mapClassFromDb(row: any): ClassEntity {
  const studentIds = Array.isArray(row.class_students)
    ? row.class_students.map((cs: any) => cs.student_id)
    : (row.studentIds || []);

  return {
    id: row.id,
    code: row.code || undefined,
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

function mapClassToDb(cls: ClassEntity): any {
  return {
    id: cls.id,
    code: cls.code || null,
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

function mapClassSectionFromDb(row: any): ClassSection {
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

function mapClassSectionToDb(section: ClassSection): any {
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

function mapScheduleSlotFromDb(row: any): ScheduleSlot {
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

function mapScheduleSlotToDb(slot: ScheduleSlot): any {
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

function mapAttendanceRecordFromDb(row: any): AttendanceRecord {
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

function mapAttendanceRecordToDb(rec: AttendanceRecord): any {
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

function mapClassRequestFromDb(row: any): ClassRequest {
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

function mapClassRequestToDb(req: ClassRequest): any {
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

function mapTuitionInvoiceFromDb(row: any): TuitionInvoice {
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

function mapTuitionInvoiceToDb(inv: TuitionInvoice): any {
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

function mapPayrollRecordFromDb(row: any): PayrollRecord {
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

function mapPayrollRecordToDb(rec: PayrollRecord): any {
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

function mapAuditLogFromDb(row: any): AuditLog {
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

function mapAuditLogToDb(log: Omit<AuditLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): any {
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

function mapNotificationFromDb(row: any): AppNotification {
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

function mapNotificationToDb(notif: Omit<AppNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): any {
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

function mapSessionPackageFromDb(row: any): SessionPackage {
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

function mapSessionPackageToDb(pkg: SessionPackage): any {
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

// ============================================================================
// SUPABASE REPOSITORY IMPLEMENTATION
// ============================================================================


export class SupabaseRepository implements IRepository {
  private static instance: SupabaseRepository;
  private client: SupabaseClient | null = null;
  private constructor() {
    this.client = getSupabaseAdminClient();
  }

  public static getInstance(): SupabaseRepository {
    if (!SupabaseRepository.instance) {
      SupabaseRepository.instance = new SupabaseRepository();
    }
    return SupabaseRepository.instance;
  }

  /**
   * Trả về Supabase Client hoặc null nếu chưa có cấu hình.
   */
  public getClient(): SupabaseClient | null {
    if (!this.client) {
      this.client = getSupabaseAdminClient();
    }
    return this.client;
  }

  // --------------------------------------------------------------------------
  // USERS
  // --------------------------------------------------------------------------

  public async getUserById(id: string): Promise<User | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getUserById(id);

    try {
      const clean = id.trim();
      const { data, error } = await client
        .from('users')
        .select('*')
        .or(`id.ilike.${clean},username.ilike.${clean}`)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      return data ? mapUserFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getUserByUsername(username: string): Promise<User | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getUserByUsername(username);

    try {
      const clean = username.trim();
      const { data, error } = await client
        .from('users')
        .select('*')
        .or(`username.ilike.${clean},id.ilike.${clean}`)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      return data ? mapUserFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getAllUsers(): Promise<User[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllUsers();

    try {
      const { data, error } = await client.from('users').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapUserFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async updateUser(user: User): Promise<User> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateUser(user);

    try {
      const row = mapUserToDb(user);
      const { error } = await client.from('users').update(row).eq('id', user.id);
      if (error) {
        throw new Error(error.message);
      }
      return user;
    } catch (err) {
      throw err;
    }
  }

  public async createUser(user: User): Promise<User> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createUser(user);

    try {
      const row = mapUserToDb(user);
      const { error } = await client.from('users').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return user;
    } catch (err) {
      throw err;
    }
  }

  public async deleteUser(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteUser(id);

    try {
      const { error } = await client.from('users').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // STUDENTS
  // --------------------------------------------------------------------------

  public async getStudentById(id: string): Promise<Student | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getStudentById(id);

    try {
      const { data: student, error } = await client
        .from('students')
        .select('*, class_students(class_id)')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (!student) return null;

      return mapStudentFromDb(student);
    } catch (err) {
      throw err;
    }
  }

  public async getAllStudents(): Promise<Student[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllStudents();

    try {
      const { data: students, error } = await client
        .from('students')
        .select('*, class_students(class_id)');
      if (error) {
        throw new Error(error.message);
      }

      return (students || []).map(mapStudentFromDb);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Trang học viên: lọc `search` + `limit`/offset ở SQL, kèm tổng số dòng
   * (`count: 'exact'`) và danh sách lớp ghi danh embed trong cùng round trip.
   */
  public async getStudentsPage(query: StudentPageQuery = {}): Promise<StudentPage> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getStudentsPage(query);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(1000, Math.max(1, query.limit || 50));
    const search = (query.search || '').trim();
    const uniFilter = query.uni && query.uni !== 'ALL' ? uniFilterToSql(query.uni) : null;

    try {
      let q = client
        .from('students')
        .select('*, class_students(class_id)', { count: 'exact' });

      if (search) {
        // Bỏ ký tự phá cú pháp `or(...)` của PostgREST; `%` giữ nguyên làm wildcard.
        const safe = search.replace(/[,()]/g, ' ').trim();
        const pattern = `%${safe}%`;
        // `students` trên Supabase production không có cột `email` (schema drift);
        // thêm `email.ilike` vào `or()` sẽ làm cả request 400. UI chỉ tìm mã/tên/SĐT.
        q = q.or(`id.ilike.${pattern},name.ilike.${pattern},phone.ilike.${pattern}`);
      }

      if (query.status && query.status !== 'ALL') {
        q = q.eq('status', query.status);
      }

      if (query.uni === 'KHAC') {
        // "Khác" = chọn trường KHAC hoặc có nhập tên trường tự do.
        q = q.or('target_university.eq.KHAC,custom_university.not.is.null');
      } else if (uniFilter?.university) {
        q = q.eq('target_university', uniFilter.university);
        if (uniFilter.block) q = q.eq('exam_block', uniFilter.block);
      }

      q = q.order('id', { ascending: true });

      // `limit=all`: bỏ range để lấy đủ danh sách cho ô chọn học sinh.
      if (!query.all) {
        const from = (page - 1) * limit;
        q = q.range(from, from + limit - 1);
      }

      const { data, error, count } = await q;

      if (error) {
        throw new Error(error.message);
      }

      return {
        students: (data || []).map(mapStudentFromDb),
        total: count ?? 0,
      };
    } catch (err) {
      throw err;
    }
  }

  public async getClassMemberships(query: ClassMembershipQuery = {}): Promise<ClassMembership[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassMemberships(query);

    try {
      let q = client.from('class_students').select('class_id, student_id');
      if (query.studentId) q = q.eq('student_id', query.studentId);

      const { data, error } = await q;
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map((row) => ({ classId: row.class_id, studentId: row.student_id }));
    } catch (err) {
      throw err;
    }
  }

  public async updateStudent(student: Student): Promise<Student> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateStudent(student);

    try {
      let row = mapStudentToDb(student);
      let { error: updateErr } = await client.from('students').update(row).eq('id', student.id);
      if (updateErr && updateErr.code === 'PGRST204') {
        const { home_town, grade_level, target_university, custom_university, exam_block, study_goal, facebook_url, other_notes, registered_date, total_sessions_in_month, attended_sessions_in_month, absent_sessions_in_month, remaining_sessions, ...legacyRow } = row;
        const retry = await client.from('students').update(legacyRow).eq('id', student.id);
        updateErr = retry.error;
      }
      if (updateErr) {
        throw new Error(updateErr.message);
      }

      await client.from('class_students').delete().eq('student_id', student.id);
      if (student.enrolledClassIds && student.enrolledClassIds.length > 0) {
        const relationRows = student.enrolledClassIds.map(cId => ({
          class_id: cId,
          student_id: student.id,
        }));
        await client.from('class_students').insert(relationRows);
      }

      return student;
    } catch (err) {
      throw err;
    }
  }

  public async createStudent(student: Student): Promise<Student> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createStudent(student);

    try {
      let row = mapStudentToDb(student);
      let { error: insertErr } = await client.from('students').insert(row);
      if (insertErr && insertErr.code === 'PGRST204') {
        const { home_town, grade_level, target_university, custom_university, exam_block, study_goal, facebook_url, other_notes, registered_date, total_sessions_in_month, attended_sessions_in_month, absent_sessions_in_month, remaining_sessions, ...legacyRow } = row;
        const retry = await client.from('students').insert(legacyRow);
        insertErr = retry.error;
      }
      if (insertErr) {
        throw new Error(insertErr.message);
      }

      if (student.enrolledClassIds && student.enrolledClassIds.length > 0) {
        const relationRows = student.enrolledClassIds.map(cId => ({
          class_id: cId,
          student_id: student.id,
        }));
        await client.from('class_students').insert(relationRows);
      }

      return student;
    } catch (err) {
      throw err;
    }
  }

  public async deleteStudent(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteStudent(id);

    try {
      const { error } = await client.from('students').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // TEACHERS
  // --------------------------------------------------------------------------

  public async getTeacherById(id: string): Promise<Teacher | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getTeacherById(id);

    try {
      const { data: teacher, error } = await client
        .from('teachers')
        .select('*, classes(id)')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (!teacher) return null;

      const assignedClassIds = (teacher.classes || []).map((c: { id: string }) => c.id);
      return mapTeacherFromDb({ ...teacher, assignedClassIds });
    } catch (err) {
      throw err;
    }
  }

  public async getAllTeachers(): Promise<Teacher[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllTeachers();

    try {
      const { data: teachers, error } = await client
        .from('teachers')
        .select('*, classes(id)');
      if (error) {
        throw new Error(error.message);
      }

      return (teachers || []).map((t: { classes?: { id: string }[] }) =>
        mapTeacherFromDb({ ...t, assignedClassIds: (t.classes || []).map(c => c.id) })
      );
    } catch (err) {
      throw err;
    }
  }

  public async updateTeacher(teacher: Teacher): Promise<Teacher> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateTeacher(teacher);

    try {
      const row = mapTeacherToDb(teacher);
      const { error } = await client.from('teachers').update(row).eq('id', teacher.id);
      if (error) {
        throw new Error(error.message);
      }
      return teacher;
    } catch (err) {
      throw err;
    }
  }

  public async createTeacher(teacher: Teacher): Promise<Teacher> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createTeacher(teacher);

    try {
      const row = mapTeacherToDb(teacher);
      const { error } = await client.from('teachers').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return teacher;
    } catch (err) {
      throw err;
    }
  }

  public async deleteTeacher(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteTeacher(id);

    try {
      // 1. Tháo gỡ ràng buộc trong classes và schedule_slots trước khi xóa
      await client.from('classes').update({ teacher_id: null }).eq('teacher_id', id);
      await client.from('schedule_slots').update({ teacher_id: null }).eq('teacher_id', id);

      // 2. Xóa trong bảng teachers
      const { error } = await client.from('teachers').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }

      // 3. Xóa user tương ứng
      await client.from('users').delete().eq('id', id);
      return true;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // CLASSES
  // --------------------------------------------------------------------------

  public async getAllClasses(): Promise<ClassEntity[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllClasses();

    try {
      // Một round trip: PostgREST embed bảng ghi danh vào lớp (FK class_students.class_id).
      const { data: classes, error } = await client
        .from('classes')
        .select('*, class_students(student_id)');
      if (error) {
        throw new Error(error.message);
      }

      return (classes || []).map(mapClassFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getClassById(id: string): Promise<ClassEntity | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassById(id);

    try {
      const { data: cls, error } = await client
        .from('classes')
        .select('*, class_students(student_id)')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (!cls) return null;

      return mapClassFromDb(cls);
    } catch (err) {
      throw err;
    }
  }

  public async getClassesByTeacherId(teacherId: string): Promise<ClassEntity[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassesByTeacherId(teacherId);

    try {
      const { data: classes, error } = await client
        .from('classes')
        .select('*, class_students(student_id)')
        .eq('teacher_id', teacherId);

      if (error) {
        throw new Error(error.message);
      }

      return (classes || []).map(mapClassFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getClassesByStudentId(studentId: string): Promise<ClassEntity[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassesByStudentId(studentId);

    try {
      const { data: classStudents, error: csErr } = await client
        .from('class_students')
        .select('class_id')
        .eq('student_id', studentId);

      if (csErr) {
        throw new Error(csErr.message);
      }

      if (!classStudents || classStudents.length === 0) return [];
      const classIds = classStudents.map((cs: any) => cs.class_id);

      const { data: classes, error: clsErr } = await client
        .from('classes')
        .select('*, class_students(student_id)')
        .in('id', classIds);

      if (clsErr) {
        throw new Error(clsErr.message);
      }

      return (classes || []).map(mapClassFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async updateClass(classEntity: ClassEntity): Promise<ClassEntity> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateClass(classEntity);

    try {
      const row = mapClassToDb(classEntity);
      const { error: updateErr } = await client.from('classes').update(row).eq('id', classEntity.id);
      if (updateErr) {
        throw new Error(updateErr.message);
      }

      await client.from('class_students').delete().eq('class_id', classEntity.id);
      if (classEntity.studentIds && classEntity.studentIds.length > 0) {
        const relationRows = classEntity.studentIds.map(stId => ({
          class_id: classEntity.id,
          student_id: stId,
        }));
        await client.from('class_students').insert(relationRows);
      }

      return classEntity;
    } catch (err) {
      throw err;
    }
  }

  public async deleteClass(id: string): Promise<boolean> {
    const client = getSupabaseAdminClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('classes').delete().eq('id', id);
    if (error) {
      console.error('Lỗi khi xóa lớp học trên Supabase:', error);
      throw new Error(error.message);
    }
    return true;
  }

  public async createClass(classEntity: ClassEntity): Promise<ClassEntity> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createClass(classEntity);

    try {
      const row = mapClassToDb(classEntity);
      const { error: insertErr } = await client.from('classes').insert(row);
      if (insertErr) {
        throw new Error(insertErr.message);
      }

      if (classEntity.studentIds && classEntity.studentIds.length > 0) {
        const relationRows = classEntity.studentIds.map(stId => ({
          class_id: classEntity.id,
          student_id: stId,
        }));
        await client.from('class_students').insert(relationRows);
      }

      return classEntity;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // CLASS SECTIONS
  // --------------------------------------------------------------------------

  public async getClassSections(classId: string): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .eq('class_id', classId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async getSectionById(id: string): Promise<ClassSection | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapClassSectionFromDb(data) : null;
  }

  public async getSectionsByStudentId(studentId: string): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    // Một round trip: inner join lọc thẳng ca mà học sinh tham gia, kèm thứ riêng
    // của học sinh đó trong ca (class_section_students.schedule_days).
    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students!inner(student_id, schedule_days)')
      .eq('class_section_students.student_id', studentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async getSectionsByTeacherId(teacherId: string): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async getAllClassSections(): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async createClassSection(section: ClassSection): Promise<ClassSection> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    await client.from('class_sections').insert(mapClassSectionToDb(section));
    await this.replaceSectionStudents(section.id, section.studentIds || []);
    return section;
  }

  public async updateClassSection(section: ClassSection): Promise<ClassSection> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { error } = await client.from('class_sections').update(mapClassSectionToDb(section)).eq('id', section.id);
    if (error) throw new Error(error.message);

    if (section.studentIds !== undefined) {
      await this.replaceSectionStudents(section.id, section.studentIds);
    }
    return section;
  }

  public async deleteClassSection(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { error } = await client.from('class_sections').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  public async addStudentToSection(sectionId: string, studentId: string, scheduleDays?: number[]): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    // Upsert giu nguyen schedule_days cu neu khong truyen tham so moi.
    const payload: any = { section_id: sectionId, student_id: studentId };
    if (scheduleDays !== undefined) payload.schedule_days = scheduleDays;
    const { error } = await client.from('class_section_students').upsert(payload, { onConflict: 'section_id,student_id' });
    if (error) throw new Error(error.message);
  }

  public async removeStudentFromSection(sectionId: string, studentId: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { error } = await client.from('class_section_students').delete().eq('section_id', sectionId).eq('student_id', studentId);
    if (error) throw new Error(error.message);
  }

  public async getSectionStudentScheduleDays(sectionId: string): Promise<Record<string, number[]>> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { data, error } = await client
      .from('class_section_students')
      .select('student_id, schedule_days')
      .eq('section_id', sectionId);
    if (error) throw new Error(error.message);
    const result: Record<string, number[]> = {};
    for (const row of data || []) {
      result[row.student_id] = Array.isArray(row.schedule_days) ? row.schedule_days : [];
    }
    return result;
  }

  public async getSlotSwaps(filter: { studentId?: string; toSlotId?: string; fromSlotId?: string; date?: string; status?: 'ACTIVE' | 'CANCELLED' }): Promise<StudentSlotSwap[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    let query = client.from('student_slot_swaps').select('*');
    if (filter.studentId) query = query.eq('student_id', filter.studentId);
    if (filter.toSlotId) query = query.eq('to_slot_id', filter.toSlotId);
    if (filter.fromSlotId) query = query.eq('from_slot_id', filter.fromSlotId);
    if (filter.date) query = query.eq('swap_date', filter.date);
    if (filter.status) query = query.eq('status', filter.status);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map((row: any) => ({
      id: row.id,
      studentId: row.student_id,
      fromSlotId: row.from_slot_id,
      toSlotId: row.to_slot_id,
      date: row.swap_date,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  public async createSlotSwap(swap: StudentSlotSwap): Promise<StudentSlotSwap> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { data, error } = await client.from('student_slot_swaps').insert({
      student_id: swap.studentId,
      from_slot_id: swap.fromSlotId,
      to_slot_id: swap.toSlotId,
      swap_date: swap.date,
      status: swap.status || 'ACTIVE',
    }).select().single();
    if (error) throw new Error(error.message);
    return {
      id: data.id,
      studentId: data.student_id,
      fromSlotId: data.from_slot_id,
      toSlotId: data.to_slot_id,
      date: data.swap_date,
      status: data.status,
      createdAt: data.created_at,
    };
  }

  private async replaceSectionStudents(sectionId: string, studentIds: string[]): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    await client.from('class_section_students').delete().eq('section_id', sectionId);
    if (studentIds.length > 0) {
      const rows = studentIds.map(stId => ({ section_id: sectionId, student_id: stId }));
      const { error } = await client.from('class_section_students').insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  // --------------------------------------------------------------------------
  // APP SETTINGS
  // --------------------------------------------------------------------------

  public async getAppSetting<T = any>(key: string): Promise<T | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { data, error } = await client.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? (data.value as T) : null;
  }

  public async setAppSetting(key: string, value: any): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { error } = await client
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }

  // --------------------------------------------------------------------------
  // SCHEDULE
  // --------------------------------------------------------------------------

  public async getAllScheduleSlots(): Promise<ScheduleSlot[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllScheduleSlots();

    try {
      const { data, error } = await client.from('schedule_slots').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapScheduleSlotFromDb);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Truy vấn ca học có lọc/giới hạn cột. Chỉ đọc các dòng khớp điều kiện
   * (index `idx_schedule_slots_date`, `(class_id, date)`) thay vì cả bảng.
   */
  public async getScheduleSlotsQuery(query: ScheduleSlotQuery = {}): Promise<ScheduleSlotWithClassName[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsQuery(query);

    try {
      let q = client
        .from('schedule_slots')
        .select('id, class_id, section_id, teacher_id, date, shift_id, start_time, end_time, subject, topic, meeting_link, status, classes(name, subject, meeting_link, start_time, end_time)');

      if (query.date) q = q.eq('date', query.date);
      if (query.dateFrom) q = q.gte('date', query.dateFrom);
      if (query.dateTo) q = q.lte('date', query.dateTo);
      if (query.classId) q = q.eq('class_id', query.classId);
      if (query.classIds) q = q.in('class_id', query.classIds);
      if (query.teacherId) q = q.eq('teacher_id', query.teacherId);
      if (query.sectionIds && query.sectionIds.length > 0) {
        const sectionFilter = `section_id.in.(${query.sectionIds.map(encodeURIComponent).join(',')})`;
        if (query.includeUnsectioned && query.classIds && query.classIds.length > 0) {
          // Buổi cũ chưa gán ca vẫn phải hiện cho học sinh của lớp đó.
          const legacyFilter = `and(section_id.is.null,class_id.in.(${query.classIds.map(encodeURIComponent).join(',')}))`;
          q = q.or(`${sectionFilter},${legacyFilter}`);
        } else {
          q = q.in('section_id', query.sectionIds);
        }
      }
      if (query.excludeCancelled) q = q.neq('status', 'Đã hủy');

      const { data, error } = await q;
      if (error) {
        throw new Error(error.message);
      }

      return (data || []).map((row) => {
        const slot = mapScheduleSlotFromDb(row);
        const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
        return {
          ...slot,
          subject: slot.subject || cls?.subject || cls?.name || '',
          meetingLink: slot.meetingLink || cls?.meeting_link || '',
          className: cls?.name || undefined,
        };
      });
    } catch (err) {
      throw err;
    }
  }

  
  // Time Shifts
  public async getAllTimeShifts(): Promise<TimeShift[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllTimeShifts();

    try {
      const { data, error } = await client.from('time_shifts').select('*').order('id', { ascending: true });
      if (error) {
        throw new Error(error.message);
      }
      // Bảng rỗng là trạng thái hợp lệ (chưa cấu hình ca) — trả mảng rỗng, không
      // thay bằng seed của LocalRepository.
      return (data || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        startTime: String(r.start_time).substring(0, 5),
        endTime: String(r.end_time).substring(0, 5),
        durationHours: Number(r.duration_hours) || 2.0,
        isActive: r.is_active ?? true
      }));
    } catch (err) {
      throw err;
    }
  }

  public async getTimeShiftById(id: number): Promise<TimeShift | null> {
    const all = await this.getAllTimeShifts();
    return all.find(s => s.id === id) || null;
  }

  public async createTimeShift(shift: TimeShift): Promise<TimeShift> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createTimeShift(shift);

    try {
      const { error } = await client.from('time_shifts').upsert({
        id: shift.id,
        name: shift.name,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_hours: shift.durationHours || 2.0,
        is_active: shift.isActive ?? true,
      });
      if (error) {
        throw new Error(error.message);
      }
      return shift;
    } catch (err) {
      throw err;
    }
  }

  public async updateTimeShift(shift: TimeShift): Promise<TimeShift> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateTimeShift(shift);

    try {
      const { error } = await client.from('time_shifts').update({
        name: shift.name,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_hours: shift.durationHours || 2.0,
        is_active: shift.isActive ?? true,
      }).eq('id', shift.id);
      if (error) {
        throw new Error(error.message);
      }
      return shift;
    } catch (err) {
      throw err;
    }
  }

  public async deleteTimeShift(id: number): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteTimeShift(id);

    try {
      const { error } = await client.from('time_shifts').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  public async getScheduleSlotById(id: string): Promise<ScheduleSlot | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotById(id);

    try {
      const { data, error } = await client
        .from('schedule_slots')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return data ? mapScheduleSlotFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getScheduleSlotsByTeacherId(teacherId: string): Promise<ScheduleSlot[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsByTeacherId(teacherId);

    try {
      const { data, error } = await client
        .from('schedule_slots')
        .select('*')
        .eq('teacher_id', teacherId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapScheduleSlotFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getScheduleSlotsByClassId(classId: string): Promise<ScheduleSlot[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsByClassId(classId);

    try {
      const { data, error } = await client
        .from('schedule_slots')
        .select('*')
        .eq('class_id', classId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapScheduleSlotFromDb);
    } catch (err) {
      throw err;
    }
  }

 public async getScheduleSlotsByStudentId(studentId: string): Promise<ScheduleSlot[]> {
   // Học sinh chỉ thấy các buổi thuộc ca mà mình tham gia.
   const studentSections = await this.getSectionsByStudentId(studentId);
   const classIds = [...new Set(studentSections.map(s => s.classId))];
   const sectionIds = [...new Set(studentSections.map(s => s.id))];
   if (classIds.length === 0) return [];

   const client = this.getClient();
   if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsByStudentId(studentId);

   try {
     const { data, error } = await client
       .from('schedule_slots')
       .select('*')
       .in('class_id', classIds);

     if (error) {
       throw new Error(error.message);
     }
    const sectionSet = new Set(sectionIds);
    // Thứ riêng của từng học sinh trong từng ca: chỉ thấy buổi thuộc thứ mình đã chọn.
    // Dữ liệu đã được nạp sẵn trong getSectionsByStudentId (studentScheduleDays),
    // nên không cần gọi thêm query cho từng ca (tránh N+1).
    const studentDaysBySection = new Map<string, number[]>();
    for (const sec of studentSections) {
      studentDaysBySection.set(sec.id, sec.studentScheduleDays?.[studentId] || []);
    }
    return (data || [])
      .map(mapScheduleSlotFromDb)
      .filter(s => {
        // Nếu buổi đã gán ca, học sinh chỉ thấy ca mình tham gia; buổi cũ chưa gán ca vẫn thấy được.
        if (s.sectionId) return sectionSet.has(s.sectionId);
        return true;
      })
      .filter(s => {
        if (!s.sectionId) return true;
        const days = studentDaysBySection.get(s.sectionId) || [];
        // Mảng rỗng = theo đúng lịch ca (không lọc thêm).
        if (days.length === 0) return true;
        const dow = dateToDayOfWeek(s.date);
        return dow !== null && days.includes(dow);
      });
  } catch (err) {
     throw err;
   }
 }

  public async createScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createScheduleSlot(slot);

    try {
      const row = mapScheduleSlotToDb(slot);
      const { error } = await client.from('schedule_slots').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return slot;
    } catch (err) {
      throw err;
    }
  }

  public async updateScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateScheduleSlot(slot);

    try {
      const row = mapScheduleSlotToDb(slot);
      const { error } = await client
        .from('schedule_slots')
        .update(row)
        .eq('id', slot.id);

      if (error) {
        throw new Error(error.message);
      }
      return slot;
    } catch (err) {
      throw err;
    }
  }

  public async createScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    if (!slots || slots.length === 0) return [];
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const rows = slots.map(mapScheduleSlotToDb);
    const { error } = await client.from('schedule_slots').insert(rows);
    if (error) {
      throw new Error(error.message);
    }
    return slots;
  }

  public async updateScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    if (!slots || slots.length === 0) return [];
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const rows = slots.map(mapScheduleSlotToDb);
    const { error } = await client.from('schedule_slots').upsert(rows, { onConflict: 'id' });
    if (error) {
      throw new Error(error.message);
    }
    return slots;
  }

  // --------------------------------------------------------------------------
  // ATTENDANCE
  // --------------------------------------------------------------------------

  public async getAttendanceBySlotId(slotId: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceBySlotId(slotId);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('schedule_slot_id', slotId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getAttendanceByStudentId(studentId: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceByStudentId(studentId);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('student_id', studentId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getAttendanceByClassId(classId: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceByClassId(classId);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('class_id', classId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceByDate(date);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('date', date);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // saveAttendanceRecord(record);

    try {
      let row = mapAttendanceRecordToDb(record);
      let res = await client
        .from('attendance_records')
        .upsert(row, { onConflict: 'schedule_slot_id,student_id' });

      if (res.error && res.error.message && res.error.message.includes('schema cache')) {
        // Fallback tương thích nếu bảng Supabase chưa chạy migration các cột mới
        const compatRow = { ...row };
        delete compatRow.original_slot_id;
        delete compatRow.makeup_reason;
        delete compatRow.method;
        res = await client.from('attendance_records').upsert(compatRow, { onConflict: 'schedule_slot_id,student_id' });
      }

      if (res.error) {
        throw new Error(res.error.message);
      }
      return record;
    } catch (err) {
      throw err;
    }
  }

  public async saveAttendanceBatch(records: AttendanceRecord[]): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // saveAttendanceBatch(records);

    try {
      const rows = records.map(mapAttendanceRecordToDb);
      const { error } = await client
        .from('attendance_records')
        .upsert(rows, { onConflict: 'schedule_slot_id,student_id' });

      if (error) {
        throw new Error(error.message);
      }
      return records;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // REQUESTS
  // --------------------------------------------------------------------------

  public async getAllRequests(): Promise<ClassRequest[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllRequests();

    try {
      const { data, error } = await client.from('class_requests').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapClassRequestFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getRequestById(id: string): Promise<ClassRequest | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getRequestById(id);

    try {
      const { data, error } = await client
        .from('class_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return data ? mapClassRequestFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getRequestsByStudentId(studentId: string): Promise<ClassRequest[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getRequestsByStudentId(studentId);

    try {
      const { data, error } = await client
        .from('class_requests')
        .select('*')
        .eq('student_id', studentId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapClassRequestFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getRequestsByTeacherId(teacherId: string): Promise<ClassRequest[]> {
    const teacherClasses = await this.getClassesByTeacherId(teacherId);
    if (!teacherClasses || teacherClasses.length === 0) return [];
    const classIds = teacherClasses.map(c => c.id);

    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getRequestsByTeacherId(teacherId);

    try {
      const { data, error } = await client
        .from('class_requests')
        .select('*')
        .in('class_id', classIds);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapClassRequestFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async createRequest(request: ClassRequest): Promise<ClassRequest> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createRequest(request);

    try {
      const row = mapClassRequestToDb(request);
      const { error } = await client.from('class_requests').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return request;
    } catch (err) {
      throw err;
    }
  }

  public async updateRequest(request: ClassRequest): Promise<ClassRequest> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateRequest(request);

    try {
      const row = mapClassRequestToDb(request);
      const { error } = await client
        .from('class_requests')
        .update(row)
        .eq('id', request.id);

      if (error) {
        throw new Error(error.message);
      }
      return request;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // FINANCE
  // --------------------------------------------------------------------------

  // Session Packages
  public async getAllSessionPackages(): Promise<SessionPackage[]> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { data, error } = await client
      .from('session_packages')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      throw new Error(error.message);
    }
    return (data || []).map(mapSessionPackageFromDb);
  }

  public async getSessionPackageById(id: string): Promise<SessionPackage | null> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { data, error } = await client.from('session_packages').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return data ? mapSessionPackageFromDb(data) : null;
  }

  public async createSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('session_packages').insert(mapSessionPackageToDb(pkg));
    if (error) {
      throw new Error(error.message);
    }
    return pkg;
  }

  public async updateSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('session_packages').update(mapSessionPackageToDb(pkg)).eq('id', pkg.id);
    if (error) {
      throw new Error(error.message);
    }
    return pkg;
  }

  public async deleteSessionPackage(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('session_packages').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
    return true;
  }

  public async getAllTuitionInvoices(): Promise<TuitionInvoice[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllTuitionInvoices();

    try {
      const { data, error } = await client.from('tuition_invoices').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapTuitionInvoiceFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getTuitionInvoicesByStudentId(studentId: string): Promise<TuitionInvoice[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getTuitionInvoicesByStudentId(studentId);

    try {
      const { data, error } = await client
        .from('tuition_invoices')
        .select('*')
        .eq('student_id', studentId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapTuitionInvoiceFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getTuitionInvoiceById(id: string): Promise<TuitionInvoice | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getTuitionInvoiceById(id);

    try {
      const { data, error } = await client
        .from('tuition_invoices')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return data ? mapTuitionInvoiceFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async createTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    const client = this.getClient();
    if (!client) {
      throw new Error("Supabase Cloud client is not configured.");
    }
    try {
      const dbRow = mapTuitionInvoiceToDb(invoice);
      const { data, error } = await client.from("tuition_invoices").insert([dbRow]).select().single();
      if (error) {
        throw new Error(error.message);
      }
      return data ? mapTuitionInvoiceFromDb(data) : invoice;
    } catch (err) {
      throw err;
    }
  }

  public async updateTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateTuitionInvoice(invoice);

    try {
      const row = mapTuitionInvoiceToDb(invoice);
      const { error } = await client
        .from('tuition_invoices')
        .update(row)
        .eq('id', invoice.id);

      if (error) {
        throw new Error(error.message);
      }
      return invoice;
    } catch (err) {
      throw err;
    }
  }

  public async getAllPayrollRecords(month?: string): Promise<PayrollRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllPayrollRecords(month);

    try {
      let query = client.from('teacher_payroll_periods').select('*');
      if (month) {
        query = query.eq('month', month);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapPayrollRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getPayrollByTeacherId(teacherId: string, month?: string): Promise<PayrollRecord | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getPayrollByTeacherId(teacherId, month);

    try {
      let query = client.from('teacher_payroll_periods').select('*').eq('teacher_id', teacherId);
      if (month) {
        query = query.eq('month', month);
      }
      const { data, error } = await query.maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      return data ? mapPayrollRecordFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async updatePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updatePayrollRecord(record);

    try {
      const row = mapPayrollRecordToDb(record);
      const { error } = await client
        .from('teacher_payroll_periods')
        .update(row)
        .eq('id', record.id);

      if (error) {
        throw new Error(error.message);
      }
      return record;
    } catch (err) {
      throw err;
    }
  }

  public async savePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // savePayrollRecord(record);

    try {
      const row = mapPayrollRecordToDb(record);
      const { error } = await client
        .from('teacher_payroll_periods')
        .upsert(row, { onConflict: 'teacher_id,month' });

      if (error) {
        throw new Error(error.message);
      }
      return record;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // AUDIT LOGS
  // --------------------------------------------------------------------------

  public async getAllAuditLogs(): Promise<AuditLog[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllAuditLogs();

    try {
      const { data, error } = await client
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAuditLogFromDb);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Trang nhật ký: chỉ các cột UI dùng, lọc + phân trang ở SQL.
   */
  public async getAuditLogsPage(query: AuditLogPageQuery = {}): Promise<AuditLogPage> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAuditLogsPage(query);

    const limit = Math.min(500, Math.max(1, query.limit || 50));
    const offset = Math.max(0, query.offset || 0);
    const search = (query.search || '').trim();

    try {
      let q = client
        .from('audit_logs')
        .select('id, user_id, user_name, user_role, action, target_resource, target_id, details, timestamp', { count: 'exact' });

      if (search) {
        const safe = search.replace(/[,()]/g, ' ').trim();
        const pattern = `%${safe}%`;
        q = q.or(`user_name.ilike.${pattern},user_id.ilike.${pattern},action.ilike.${pattern},details.ilike.${pattern}`);
      }

      if (query.action && query.action !== 'ALL') {
        q = q.eq('action', query.action);
      }

      const { data, error, count } = await q
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        throw new Error(error.message);
      }

      return {
        logs: (data || []).map(mapAuditLogFromDb),
        total: count ?? 0,
      };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Đếm số bản ghi theo từng loại thao tác. Dùng HEAD + count nên chỉ trả về số,
   * không kéo nội dung nhật ký.
   */
  public async getAuditActionCounts(actions: string[]): Promise<Record<string, number>> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    try {
      const entries = await Promise.all(
        actions.map(async (action) => {
          const { count, error } = await client
            .from('audit_logs')
            .select('id', { count: 'exact', head: true })
            .eq('action', action);
          if (error) throw new Error(error.message);
          return [action, count ?? 0] as const;
        })
      );

      const { count: totalCount, error: totalError } = await client
        .from('audit_logs')
        .select('id', { count: 'exact', head: true });
      if (totalError) throw new Error(totalError.message);

      return { ...Object.fromEntries(entries), ALL: totalCount ?? 0 };
    } catch (err) {
      throw err;
    }
  }

  public async addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // addAuditLog(log);

    try {
      const id = `AUD${Date.now().toString().slice(-6)}`;
      const timestamp = new Date().toISOString();
      const fullLog: AuditLog = { ...log, id, timestamp };
      const row = mapAuditLogToDb(fullLog);
      const { error } = await client.from('audit_logs').insert(row);

      if (error) {
        throw new Error(error.message);
      }
      return fullLog;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // NOTIFICATIONS
  // --------------------------------------------------------------------------

  public async getNotifications(userId?: string, role?: string): Promise<AppNotification[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getNotifications(userId, role);

    try {
      let query = client.from('notifications').select('*');
      if (userId && role) {
        query = query.or(`recipient_role.eq.ALL,recipient_role.eq.${role},recipient_user_id.eq.${userId}`);
      } else if (role) {
        query = query.or(`recipient_role.eq.ALL,recipient_role.eq.${role}`);
      } else if (userId) {
        query = query.or(`recipient_role.eq.ALL,recipient_user_id.eq.${userId}`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapNotificationFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async addNotification(notification: Omit<AppNotification, 'id' | 'createdAt'>): Promise<AppNotification> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // addNotification(notification);

    try {
      const id = `NOTIF_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const createdAt = new Date().toISOString();
      const fullNotif: AppNotification = { ...notification, id, createdAt };
      const row = mapNotificationToDb(fullNotif);

      const { error } = await client.from('notifications').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return fullNotif;
    } catch (err) {
      throw err;
    }
  }

  public async markNotificationAsRead(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // markNotificationAsRead(id);

    try {
      const { error } = await client
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  public async markAllNotificationsAsRead(userId?: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // markAllNotificationsAsRead(userId);

    try {
      let query = client.from('notifications').update({ is_read: true });
      if (userId) {
        query = query.or(`recipient_user_id.eq.${userId},recipient_role.eq.ALL`);
      } else {
        query = query.neq('id', '');
      }

      const { error } = await query;
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // XOA DU LIEU (khong chen lai du lieu mau)
  // --------------------------------------------------------------------------

  public async resetData(): Promise<void> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }

    const tables = [
      'audit_logs',
      'notifications',
      'attendance_records',
      'class_requests',
      'tuition_invoices',
      'teacher_payroll_periods',
      'schedule_slots',
      'class_students',
      'classes',
      'students',
      'teachers',
      'users',
    ];

    for (const table of tables) {
      const { error } = await client.from(table).delete().neq('id', '___PLACEHOLDER___');
      if (error) {
        throw new Error(`Khong the xoa du lieu bang ${table}: ${error.message}`);
      }
    }
  }

}

export const supabaseRepo = SupabaseRepository.getInstance();
