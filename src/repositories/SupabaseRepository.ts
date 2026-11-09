import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';
import type {
  AuditLogPage,
  AuditLogPageQuery,
  ClassMembership,
  ClassMembershipQuery,
  IRepository,
  ScheduleSlotQuery,
  ScheduleSlotWithClassName,
  StudentPage,
  StudentPageQuery,
} from './IRepository';
import type { User } from '@/types/auth';
import type { Student } from '@/types/student';
import type { Teacher } from '@/types/teacher';
import type { ClassEntity, ClassSection } from '@/types/classroom';
import type { ScheduleSlot, ClassRequest, TimeShift, StudentSlotSwap } from '@/types/schedule';
import type { AttendanceRecord } from '@/types/attendance';
import type { TuitionInvoice, PayrollRecord } from '@/types/finance';
import type { SessionPackage } from '@/types/package';
import type { AuditLog } from '@/types/audit';
import type { SessionBookingFilter, StudentSessionBooking } from '@/types/booking';
import type { AppNotification } from '@/types/notification';

import {
  SupabaseUserRepo,
  SupabaseStudentRepo,
  SupabaseTeacherRepo,
  SupabaseClassRepo,
  SupabaseScheduleRepo,
  SupabaseAttendanceRepo,
  SupabaseFinanceRepo,
  SupabaseAuditRepo,
} from './supabase';

export { quotePgValue, isMissingBookingsTable } from './supabase/mappers';
export * from './supabase';

/**
 * Repository Supabase chính — điều phối các domain repository con:
 * - User: `SupabaseUserRepo`
 * - Student: `SupabaseStudentRepo`
 * - Teacher: `SupabaseTeacherRepo`
 * - Class & Section: `SupabaseClassRepo`
 * - Schedule & Booking: `SupabaseScheduleRepo`
 * - Attendance: `SupabaseAttendanceRepo`
 * - Finance & Payroll: `SupabaseFinanceRepo`
 * - Audit, Notification & Requests: `SupabaseAuditRepo`
 */
export class SupabaseRepository implements IRepository {
  private static instance: SupabaseRepository;
  private client: SupabaseClient | null = null;

  public readonly users: SupabaseUserRepo;
  public readonly students: SupabaseStudentRepo;
  public readonly teachers: SupabaseTeacherRepo;
  public readonly classes: SupabaseClassRepo;
  public readonly schedules: SupabaseScheduleRepo;
  public readonly attendances: SupabaseAttendanceRepo;
  public readonly finances: SupabaseFinanceRepo;
  public readonly audits: SupabaseAuditRepo;

  private constructor() {
    this.client = getSupabaseAdminClient();
    const getCl = () => this.getClient();

    this.users = new SupabaseUserRepo(getCl);
    this.students = new SupabaseStudentRepo(getCl);
    this.teachers = new SupabaseTeacherRepo(getCl);
    this.classes = new SupabaseClassRepo(getCl);
    this.schedules = new SupabaseScheduleRepo(getCl, (stId) => this.classes.getSectionsByStudentId(stId));
    this.attendances = new SupabaseAttendanceRepo(getCl);
    this.finances = new SupabaseFinanceRepo(getCl);
    this.audits = new SupabaseAuditRepo(getCl, (tId) => this.classes.getClassesByTeacherId(tId));
  }

  public static getInstance(): SupabaseRepository {
    if (!SupabaseRepository.instance) {
      SupabaseRepository.instance = new SupabaseRepository();
    }
    return SupabaseRepository.instance;
  }

  public getClient(): SupabaseClient | null {
    if (!this.client) {
      this.client = getSupabaseAdminClient();
    }
    return this.client;
  }

  // --------------------------------------------------------------------------
  // USERS
  // --------------------------------------------------------------------------
  public getUserById(id: string): Promise<User | null> {
    return this.users.getUserById(id);
  }
  public getUserByUsername(username: string): Promise<User | null> {
    return this.users.getUserByUsername(username);
  }
  public getAllUsers(): Promise<User[]> {
    return this.users.getAllUsers();
  }
  public updateUser(user: User): Promise<User> {
    return this.users.updateUser(user);
  }
  public createUser(user: User): Promise<User> {
    return this.users.createUser(user);
  }
  public deleteUser(id: string): Promise<boolean> {
    return this.users.deleteUser(id);
  }

  // --------------------------------------------------------------------------
  // STUDENTS
  // --------------------------------------------------------------------------
  public getStudentById(id: string): Promise<Student | null> {
    return this.students.getStudentById(id);
  }
  public getStudentsByIds(ids: string[]): Promise<Student[]> {
    return this.students.getStudentsByIds(ids);
  }
  public getAllStudents(): Promise<Student[]> {
    return this.students.getAllStudents();
  }
  public getStudentsPage(query?: StudentPageQuery): Promise<StudentPage> {
    return this.students.getStudentsPage(query);
  }
  public getClassMemberships(query?: ClassMembershipQuery): Promise<ClassMembership[]> {
    return this.students.getClassMemberships(query);
  }
  public updateStudent(student: Student): Promise<Student> {
    return this.students.updateStudent(student);
  }
  public createStudent(student: Student): Promise<Student> {
    return this.students.createStudent(student);
  }
  public deleteStudent(id: string): Promise<boolean> {
    return this.students.deleteStudent(id);
  }

  // --------------------------------------------------------------------------
  // TEACHERS
  // --------------------------------------------------------------------------
  public getTeacherById(id: string): Promise<Teacher | null> {
    return this.teachers.getTeacherById(id);
  }
  public getAllTeachers(): Promise<Teacher[]> {
    return this.teachers.getAllTeachers();
  }
  public updateTeacher(teacher: Teacher): Promise<Teacher> {
    return this.teachers.updateTeacher(teacher);
  }
  public createTeacher(teacher: Teacher): Promise<Teacher> {
    return this.teachers.createTeacher(teacher);
  }
  public deleteTeacher(id: string): Promise<boolean> {
    return this.teachers.deleteTeacher(id);
  }

  // --------------------------------------------------------------------------
  // CLASSES & SECTIONS
  // --------------------------------------------------------------------------
  public getAllClasses(): Promise<ClassEntity[]> {
    return this.classes.getAllClasses();
  }
  public getClassById(id: string): Promise<ClassEntity | null> {
    return this.classes.getClassById(id);
  }
  public getClassesByTeacherId(teacherId: string): Promise<ClassEntity[]> {
    return this.classes.getClassesByTeacherId(teacherId);
  }
  public getClassesByStudentId(studentId: string): Promise<ClassEntity[]> {
    return this.classes.getClassesByStudentId(studentId);
  }
  public updateClass(classEntity: ClassEntity): Promise<ClassEntity> {
    return this.classes.updateClass(classEntity);
  }
  public deleteClass(id: string): Promise<boolean> {
    return this.classes.deleteClass(id);
  }
  public createClass(classEntity: ClassEntity): Promise<ClassEntity> {
    return this.classes.createClass(classEntity);
  }
  public getClassSections(classId: string): Promise<ClassSection[]> {
    return this.classes.getClassSections(classId);
  }
  public getSectionById(id: string): Promise<ClassSection | null> {
    return this.classes.getSectionById(id);
  }
  public getSectionsByStudentId(studentId: string): Promise<ClassSection[]> {
    return this.classes.getSectionsByStudentId(studentId);
  }
  public getSectionsByTeacherId(teacherId: string): Promise<ClassSection[]> {
    return this.classes.getSectionsByTeacherId(teacherId);
  }
  public getAllClassSections(): Promise<ClassSection[]> {
    return this.classes.getAllClassSections();
  }
  public createClassSection(section: ClassSection): Promise<ClassSection> {
    return this.classes.createClassSection(section);
  }
  public updateClassSection(section: ClassSection): Promise<ClassSection> {
    return this.classes.updateClassSection(section);
  }
  public deleteClassSection(id: string): Promise<boolean> {
    return this.classes.deleteClassSection(id);
  }
  public addStudentToSection(sectionId: string, studentId: string, scheduleDays?: number[]): Promise<void> {
    return this.classes.addStudentToSection(sectionId, studentId, scheduleDays);
  }
  public removeStudentFromSection(sectionId: string, studentId: string): Promise<void> {
    return this.classes.removeStudentFromSection(sectionId, studentId);
  }
  public getSectionStudentScheduleDays(sectionId: string): Promise<Record<string, number[]>> {
    return this.classes.getSectionStudentScheduleDays(sectionId);
  }
  public getSlotSwaps(filter: { studentId?: string; toSlotId?: string; fromSlotId?: string; date?: string; status?: 'ACTIVE' | 'CANCELLED' }): Promise<StudentSlotSwap[]> {
    return this.classes.getSlotSwaps(filter);
  }
  public createSlotSwap(swap: StudentSlotSwap): Promise<StudentSlotSwap> {
    return this.classes.createSlotSwap(swap);
  }

  // --------------------------------------------------------------------------
  // SCHEDULE & BOOKINGS
  // --------------------------------------------------------------------------
  public getAllScheduleSlots(): Promise<ScheduleSlot[]> {
    return this.schedules.getAllScheduleSlots();
  }
  public getMaxScheduleSlotNumber(): Promise<number> {
    return this.schedules.getMaxScheduleSlotNumber();
  }
  public getScheduleSlotsQuery(query?: ScheduleSlotQuery): Promise<ScheduleSlotWithClassName[]> {
    return this.schedules.getScheduleSlotsQuery(query);
  }
  public getAllTimeShifts(): Promise<TimeShift[]> {
    return this.schedules.getAllTimeShifts();
  }
  public getTimeShiftById(id: number): Promise<TimeShift | null> {
    return this.schedules.getTimeShiftById(id);
  }
  public createTimeShift(shift: TimeShift): Promise<TimeShift> {
    return this.schedules.createTimeShift(shift);
  }
  public updateTimeShift(shift: TimeShift): Promise<TimeShift> {
    return this.schedules.updateTimeShift(shift);
  }
  public deleteTimeShift(id: number): Promise<boolean> {
    return this.schedules.deleteTimeShift(id);
  }
  public getScheduleSlotById(id: string): Promise<ScheduleSlot | null> {
    return this.schedules.getScheduleSlotById(id);
  }
  public getScheduleSlotsByTeacherId(teacherId: string): Promise<ScheduleSlot[]> {
    return this.schedules.getScheduleSlotsByTeacherId(teacherId);
  }
  public getScheduleSlotsByClassId(classId: string): Promise<ScheduleSlot[]> {
    return this.schedules.getScheduleSlotsByClassId(classId);
  }
  public getScheduleSlotsByStudentId(studentId: string): Promise<ScheduleSlot[]> {
    return this.schedules.getScheduleSlotsByStudentId(studentId);
  }
  public createScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    return this.schedules.createScheduleSlot(slot);
  }
  public updateScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    return this.schedules.updateScheduleSlot(slot);
  }
  public createScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    return this.schedules.createScheduleSlotsBatch(slots);
  }
  public updateScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    return this.schedules.updateScheduleSlotsBatch(slots);
  }
  public getSessionBookings(filter?: SessionBookingFilter): Promise<StudentSessionBooking[]> {
    return this.schedules.getSessionBookings(filter);
  }
  public createSessionBooking(booking: StudentSessionBooking): Promise<StudentSessionBooking> {
    return this.schedules.createSessionBooking(booking);
  }
  public updateSessionBooking(booking: StudentSessionBooking): Promise<StudentSessionBooking> {
    return this.schedules.updateSessionBooking(booking);
  }

  // --------------------------------------------------------------------------
  // ATTENDANCE
  // --------------------------------------------------------------------------
  public getAttendanceBySlotId(slotId: string): Promise<AttendanceRecord[]> {
    return this.attendances.getAttendanceBySlotId(slotId);
  }
  public getAttendanceByStudentId(studentId: string): Promise<AttendanceRecord[]> {
    return this.attendances.getAttendanceByStudentId(studentId);
  }
  public getAttendanceByClassId(classId: string): Promise<AttendanceRecord[]> {
    return this.attendances.getAttendanceByClassId(classId);
  }
  public getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
    return this.attendances.getAttendanceByDate(date);
  }
  public getAttendanceByMonth(month: string): Promise<AttendanceRecord[]> {
    return this.attendances.getAttendanceByMonth(month);
  }
  public saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    return this.attendances.saveAttendanceRecord(record);
  }
  public saveAttendanceBatch(records: AttendanceRecord[]): Promise<AttendanceRecord[]> {
    return this.attendances.saveAttendanceBatch(records);
  }

  // --------------------------------------------------------------------------
  // FINANCE & PAYROLL
  // --------------------------------------------------------------------------
  public getAllSessionPackages(): Promise<SessionPackage[]> {
    return this.finances.getAllSessionPackages();
  }
  public getSessionPackageById(id: string): Promise<SessionPackage | null> {
    return this.finances.getSessionPackageById(id);
  }
  public createSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    return this.finances.createSessionPackage(pkg);
  }
  public updateSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    return this.finances.updateSessionPackage(pkg);
  }
  public deleteSessionPackage(id: string): Promise<boolean> {
    return this.finances.deleteSessionPackage(id);
  }
  public getAllTuitionInvoices(): Promise<TuitionInvoice[]> {
    return this.finances.getAllTuitionInvoices();
  }
  public getTuitionInvoicesByStudentId(studentId: string): Promise<TuitionInvoice[]> {
    return this.finances.getTuitionInvoicesByStudentId(studentId);
  }
  public getTuitionInvoiceById(id: string): Promise<TuitionInvoice | null> {
    return this.finances.getTuitionInvoiceById(id);
  }
  public createTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    return this.finances.createTuitionInvoice(invoice);
  }
  public updateTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    return this.finances.updateTuitionInvoice(invoice);
  }
  public getAllPayrollRecords(month?: string): Promise<PayrollRecord[]> {
    return this.finances.getAllPayrollRecords(month);
  }
  public getPayrollByTeacherId(teacherId: string, month?: string): Promise<PayrollRecord | null> {
    return this.finances.getPayrollByTeacherId(teacherId, month);
  }
  public updatePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    return this.finances.updatePayrollRecord(record);
  }
  public savePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    return this.finances.savePayrollRecord(record);
  }

  // --------------------------------------------------------------------------
  // AUDIT, NOTIFICATIONS & REQUESTS
  // --------------------------------------------------------------------------
  public getAppSetting<T = any>(key: string): Promise<T | null> {
    return this.audits.getAppSetting<T>(key);
  }
  public setAppSetting(key: string, value: any): Promise<void> {
    return this.audits.setAppSetting(key, value);
  }
  public getAllRequests(): Promise<ClassRequest[]> {
    return this.audits.getAllRequests();
  }
  public getRequestById(id: string): Promise<ClassRequest | null> {
    return this.audits.getRequestById(id);
  }
  public getRequestsByStudentId(studentId: string): Promise<ClassRequest[]> {
    return this.audits.getRequestsByStudentId(studentId);
  }
  public getRequestsByTeacherId(teacherId: string): Promise<ClassRequest[]> {
    return this.audits.getRequestsByTeacherId(teacherId);
  }
  public createRequest(request: ClassRequest): Promise<ClassRequest> {
    return this.audits.createRequest(request);
  }
  public updateRequest(request: ClassRequest): Promise<ClassRequest> {
    return this.audits.updateRequest(request);
  }
  public deleteRequest(id: string): Promise<boolean> {
    return this.audits.deleteRequest(id);
  }
  public getAllAuditLogs(): Promise<AuditLog[]> {
    return this.audits.getAllAuditLogs();
  }
  public getAuditLogsPage(query?: AuditLogPageQuery): Promise<AuditLogPage> {
    return this.audits.getAuditLogsPage(query);
  }
  public getAuditActionCounts(actions: string[]): Promise<Record<string, number>> {
    return this.audits.getAuditActionCounts(actions);
  }
  public addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    return this.audits.addAuditLog(log);
  }
  public getNotifications(userId?: string, role?: string): Promise<AppNotification[]> {
    return this.audits.getNotifications(userId, role);
  }
  public addNotification(notification: Omit<AppNotification, 'id' | 'createdAt'>): Promise<AppNotification> {
    return this.audits.addNotification(notification);
  }
  public deleteNotification(id: string): Promise<boolean> {
    return this.audits.deleteNotification(id);
  }
  public markNotificationAsRead(id: string): Promise<boolean> {
    return this.audits.markNotificationAsRead(id);
  }
  public markAllNotificationsAsRead(userId?: string): Promise<boolean> {
    return this.audits.markAllNotificationsAsRead(userId);
  }
  public resetData(): Promise<void> {
    return this.audits.resetData();
  }
}

export const supabaseRepo = SupabaseRepository.getInstance();
