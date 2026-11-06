import { AppNotification } from '@/types/notification';
import { User } from '@/types/auth';
import { Student } from '@/types/student';
import { Teacher } from '@/types/teacher';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { ScheduleSlot, ClassRequest, TimeShift, StudentSlotSwap } from '@/types/schedule';
import { AttendanceRecord } from '@/types/attendance';
import { TuitionInvoice, PayrollRecord } from '@/types/finance';
import { SessionPackage } from '@/types/package';
import { AuditLog } from '@/types/audit';
import { BankTransaction } from '@/types/bank';

/**
 * Bộ lọc cho truy vấn ca học. Dùng để đẩy điều kiện xuống tầng dữ liệu
 * (SQL) thay vì đọc toàn bộ bảng rồi lọc trong JS.
 */
export interface ScheduleSlotQuery {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  classId?: string;
  classIds?: string[];
  teacherId?: string;
  /** Chỉ lấy buổi thuộc các ca này (ca = lớp + khung giờ; học sinh học theo ca). */
  sectionIds?: string[];
  /**
   * Khi lọc theo `sectionIds`: vẫn lấy các buổi cũ chưa gán ca (`section_id IS NULL`)
   * của những lớp trong `classIds`, đúng như hành vi portal học sinh.
   */
  includeUnsectioned?: boolean;
  excludeCancelled?: boolean;
}

export interface ScheduleSlotWithClassName extends ScheduleSlot {
  className?: string;
}

export interface ClassMembership {
  classId: string;
  studentId: string;
}

export interface ClassMembershipQuery {
  studentId?: string;
}

export interface StudentPageQuery {
  search?: string;
  page?: number;
  limit?: number;
  /** Lấy toàn bộ danh sách (dùng cho ô chọn học sinh ở hoá đơn/đơn từ). */
  all?: boolean;
  /** Lọc theo trạng thái hồ sơ ('Đang học', 'Bảo lưu'...). */
  status?: string;
  /** Mã lọc mục tiêu trường + khối thi, xem `src/lib/studentFilters.ts`. */
  uni?: string;
}

export interface StudentPage {
  students: Student[];
  total: number;
}

export interface AuditLogPageQuery {
  search?: string;
  /** Lọc theo loại thao tác (CREATE, LOGIN...). */
  action?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogPage {
  logs: AuditLog[];
  total: number;
}

/**
 * Trần cứng cho `limit` của danh sách học viên.
 *
 * `limit=all` tiện cho ô chọn học sinh nhưng là cửa mở để một request kéo cả
 * bảng (và bỏ luôn `range()` ở PostgREST). 1000 dòng là dư cho một trung tâm;
 * vượt ngưỡng thì phải phân trang hoặc thêm endpoint chuyên dụng.
 */
export const MAX_STUDENT_PAGE_LIMIT = 1000;

export interface IRepository {
  // Time Shifts
  getAllTimeShifts(): Promise<TimeShift[]>;
  getTimeShiftById(id: number): Promise<TimeShift | null>;
  createTimeShift(shift: TimeShift): Promise<TimeShift>;
  updateTimeShift(shift: TimeShift): Promise<TimeShift>;
  deleteTimeShift(id: number): Promise<boolean>;

  // Users
  getUserById(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  updateUser(user: User): Promise<User>;
  createUser(user: User): Promise<User>;
  deleteUser(id: string): Promise<boolean>;

  // Students
  getStudentById(id: string): Promise<Student | null>;
  /**
   * Nhiều học sinh theo danh sách mã trong **một** query.
   * Dùng cho màn hình chỉ cần học sinh của các lớp đang hiển thị (lịch học,
   * điểm danh) thay vì đọc cả bảng `students` rồi lọc ở client.
   */
  getStudentsByIds(ids: string[]): Promise<Student[]>;
  getAllStudents(): Promise<Student[]>;
  updateStudent(student: Student): Promise<Student>;
  createStudent(student: Student): Promise<Student>;
  deleteStudent(id: string): Promise<boolean>;

  // Teachers
  getTeacherById(id: string): Promise<Teacher | null>;
  getAllTeachers(): Promise<Teacher[]>;
  updateTeacher(teacher: Teacher): Promise<Teacher>;
  createTeacher(teacher: Teacher): Promise<Teacher>;
  deleteTeacher(id: string): Promise<boolean>;

  // Classes
  getAllClasses(): Promise<ClassEntity[]>;
  getClassById(id: string): Promise<ClassEntity | null>;
  getClassesByTeacherId(teacherId: string): Promise<ClassEntity[]>;
  getClassesByStudentId(studentId: string): Promise<ClassEntity[]>;
  updateClass(classEntity: ClassEntity): Promise<ClassEntity>;
  createClass(classEntity: ClassEntity): Promise<ClassEntity>;
  deleteClass(id: string): Promise<boolean>;

  // Class Sections (một lớp có nhiều ca học)
  getClassSections(classId: string): Promise<ClassSection[]>;
  getSectionById(id: string): Promise<ClassSection | null>;
  getSectionsByStudentId(studentId: string): Promise<ClassSection[]>;
  getSectionsByTeacherId(teacherId: string): Promise<ClassSection[]>;
  getAllClassSections(): Promise<ClassSection[]>;
  createClassSection(section: ClassSection): Promise<ClassSection>;
  updateClassSection(section: ClassSection): Promise<ClassSection>;
  deleteClassSection(id: string): Promise<boolean>;
  addStudentToSection(sectionId: string, studentId: string, scheduleDays?: number[]): Promise<void>;
  removeStudentFromSection(sectionId: string, studentId: string): Promise<void>;
  /** Thứ riêng học sinh đã chọn trong từng ca: sectionId -> scheduleDays (rỗng = theo ca). */
  getSectionStudentScheduleDays(sectionId: string): Promise<Record<string, number[]>>;

  // Đổi ca nhanh trong ngày (student_slot_swaps)
  getSlotSwaps(filter: { studentId?: string; toSlotId?: string; fromSlotId?: string; date?: string; status?: 'ACTIVE' | 'CANCELLED' }): Promise<StudentSlotSwap[]>;
  createSlotSwap(swap: StudentSlotSwap): Promise<StudentSlotSwap>;

  // Schedule
  getAllScheduleSlots(): Promise<ScheduleSlot[]>;
  /** Số lớn nhất trong các mã `SCHxxxx` — để sinh mã mới mà không đọc cả bảng. */
  getMaxScheduleSlotNumber(): Promise<number>;
  getScheduleSlotById(id: string): Promise<ScheduleSlot | null>;
  getScheduleSlotsByTeacherId(teacherId: string): Promise<ScheduleSlot[]>;
  getScheduleSlotsByClassId(classId: string): Promise<ScheduleSlot[]>;
  getScheduleSlotsByStudentId(studentId: string): Promise<ScheduleSlot[]>;
  createScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot>;
  updateScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot>;
  createScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]>;
  updateScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]>;

  // Attendance
  getAttendanceBySlotId(slotId: string): Promise<AttendanceRecord[]>;
  getAttendanceByStudentId(studentId: string): Promise<AttendanceRecord[]>;
  getAttendanceByClassId(classId: string): Promise<AttendanceRecord[]>;
  saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord>;
  saveAttendanceBatch(records: AttendanceRecord[]): Promise<AttendanceRecord[]>;

  // Requests
  getAllRequests(): Promise<ClassRequest[]>;
  getRequestById(id: string): Promise<ClassRequest | null>;
  getRequestsByStudentId(studentId: string): Promise<ClassRequest[]>;
  getRequestsByTeacherId(teacherId: string): Promise<ClassRequest[]>;
  createRequest(request: ClassRequest): Promise<ClassRequest>;
  updateRequest(request: ClassRequest): Promise<ClassRequest>;

  // Session Packages
  getAllSessionPackages(): Promise<SessionPackage[]>;
  getSessionPackageById(id: string): Promise<SessionPackage | null>;
  createSessionPackage(pkg: SessionPackage): Promise<SessionPackage>;
  updateSessionPackage(pkg: SessionPackage): Promise<SessionPackage>;
  deleteSessionPackage(id: string): Promise<boolean>;

  // Finance
  getAllTuitionInvoices(): Promise<TuitionInvoice[]>;
  getTuitionInvoicesByStudentId(studentId: string): Promise<TuitionInvoice[]>;
  getTuitionInvoiceById(id: string): Promise<TuitionInvoice | null>;
  updateTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice>;
  createTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice>;

  getAllPayrollRecords(month?: string): Promise<PayrollRecord[]>;
  getPayrollByTeacherId(teacherId: string, month?: string): Promise<PayrollRecord | null>;
  updatePayrollRecord(record: PayrollRecord): Promise<PayrollRecord>;
  savePayrollRecord(record: PayrollRecord): Promise<PayrollRecord>;

  // Audit Logs
  getAllAuditLogs(): Promise<AuditLog[]>;
  addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog>;

  // Notifications
  getNotifications(userId?: string, role?: string): Promise<AppNotification[]>;
  addNotification(notification: Omit<AppNotification, 'id' | 'createdAt'>): Promise<AppNotification>;
  markNotificationAsRead(id: string): Promise<boolean>;
  markAllNotificationsAsRead(userId?: string): Promise<boolean>;

  // Truy vấn tối ưu: lọc/phân trang ở tầng dữ liệu
  getScheduleSlotsQuery(query?: ScheduleSlotQuery): Promise<ScheduleSlotWithClassName[]>;
  getAttendanceByDate(date: string): Promise<AttendanceRecord[]>;
  /** Sổ điểm danh trong một tháng (`YYYY-MM`), 1 query thay cho vòng lặp theo lớp. */
  getAttendanceByMonth(month: string): Promise<AttendanceRecord[]>;
  getClassMemberships(query?: ClassMembershipQuery): Promise<ClassMembership[]>;
  getStudentsPage(query?: StudentPageQuery): Promise<StudentPage>;
  getAuditLogsPage(query?: AuditLogPageQuery): Promise<AuditLogPage>;
  /** Đếm số bản ghi nhật ký theo từng loại thao tác (dùng cho tab + thẻ thống kê). */
  getAuditActionCounts(actions: string[]): Promise<Record<string, number>>;

  // Reset/Re-seed
  resetData(): Promise<void>;

  // App Settings (key -> jsonb), dùng lưu cấu hình ngân hàng nhận học phí
  getAppSetting<T = any>(key: string): Promise<T | null>;
  setAppSetting(key: string, value: any): Promise<void>;

  // Sổ giao dịch ngân hàng — chống xử lý trùng webhook
  /**
   * Ghi nhận một giao dịch vào sổ. Trả về `null` nếu `referenceCode` đã tồn tại
   * (giao dịch trùng) — bên gọi phải dừng, không được cộng tiền lần hai.
   */
  claimBankTransaction(tx: BankTransaction): Promise<BankTransaction | null>;
  getBankTransaction(referenceCode: string): Promise<BankTransaction | null>;
  /** Cập nhật kết quả cuối cùng sau khi đã gạch nợ xong. */
  finishBankTransaction(referenceCode: string, patch: Partial<BankTransaction>): Promise<void>;
}
