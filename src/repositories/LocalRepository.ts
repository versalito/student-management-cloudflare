import { AppNotification } from '@/types/notification';
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
import { Student } from '@/types/student';
import { Teacher } from '@/types/teacher';
import { Classroom, ClassEntity } from '@/types/classroom';
import { TimeShift, TIME_SHIFTS } from '@/types/schedule';
import { ScheduleSlot, ClassRequest } from '@/types/schedule';
import { AttendanceRecord } from '@/types/attendance';
import { TuitionInvoice, PayrollRecord } from '@/types/finance';
import { SessionPackage } from '@/types/package';
import { DEFAULT_PACKAGES } from './seeds/seedPackages';
import { AuditLog } from '@/types/audit';
import { generateSeedData } from './seeds/seedData';

export class LocalRepository implements IRepository {
  private static instance: LocalRepository;

  private users: Map<string, User> = new Map();
  private students: Map<string, Student> = new Map();
  private teachers: Map<string, Teacher> = new Map();
  private classrooms: Map<string, Classroom> = new Map();
  private classes: Map<string, ClassEntity> = new Map();
  private scheduleSlots: Map<string, ScheduleSlot> = new Map();
  
  private timeShifts: Map<number, TimeShift> = new Map();
  private attendanceRecords: Map<string, AttendanceRecord> = new Map();
  private classRequests: Map<string, ClassRequest> = new Map();
  private sessionPackages: Map<string, SessionPackage> = new Map();
  private tuitionInvoices: Map<string, TuitionInvoice> = new Map();
  private payrollRecords: Map<string, PayrollRecord> = new Map();
  private auditLogs: AuditLog[] = [];
  private notifications: Map<string, AppNotification> = new Map();

  private isInitialized = false;

  private constructor() {
    this.init();
  }

  public static getInstance(): LocalRepository {
    if (!LocalRepository.instance) {
      LocalRepository.instance = new LocalRepository();
    }
    return LocalRepository.instance;
  }

  private init() {
    if (this.isInitialized) return;
    const seed = generateSeedData();

    seed.users.forEach(u => this.users.set(u.id, u));
    seed.students.forEach(s => this.students.set(s.id, s));
    seed.teachers.forEach(t => this.teachers.set(t.id, t));
    seed.classrooms.forEach(c => this.classrooms.set(c.id, c));
    seed.classes.forEach(cl => this.classes.set(cl.id, cl));
    seed.scheduleSlots.forEach(ss => this.scheduleSlots.set(ss.id, ss));
    seed.attendanceRecords.forEach(ar => this.attendanceRecords.set(ar.id, ar));
    seed.classRequests.forEach(cr => this.classRequests.set(cr.id, cr));
    DEFAULT_PACKAGES.forEach(pkg => this.sessionPackages.set(pkg.id, { ...pkg }));
    seed.tuitionInvoices.forEach(ti => this.tuitionInvoices.set(ti.id, ti));
    seed.payrollRecords.forEach(pr => this.payrollRecords.set(pr.id, pr));
    this.auditLogs = [...seed.auditLogs];
    this.isInitialized = true;
  }

  public async resetData(): Promise<void> {
    this.users.clear();
    this.students.clear();
    this.teachers.clear();
    this.classrooms.clear();
    this.classes.clear();
    this.scheduleSlots.clear();
    this.attendanceRecords.clear();
    this.classRequests.clear();
    this.sessionPackages.clear();
    this.tuitionInvoices.clear();
    this.payrollRecords.clear();
    this.auditLogs = [];
    this.isInitialized = false;
    this.init();
  }

  // Users
  public async getUserById(id: string): Promise<User | null> {
    const clean = id.trim().toUpperCase();
    if (this.users.has(clean)) return this.users.get(clean) || null;
    for (const u of this.users.values()) {
      if (u.id.toUpperCase() === clean || u.username.toUpperCase() === clean) {
        return u;
      }
    }
    return null;
  }

  public async getUserByUsername(username: string): Promise<User | null> {
    const clean = username.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === clean || u.id.toLowerCase() === clean) {
        return u;
      }
    }
    return null;
  }

  public async authenticate(username: string, passwordHash: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user || !user.isActive) return null;
    if (user.passwordHash === passwordHash) {
      return user;
    }
    return null;
  }

  public async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  public async updateUser(user: User): Promise<User> {
    this.users.set(user.id, { ...user });
    return user;
  }

  public async createUser(user: User): Promise<User> {
    this.users.set(user.id, { ...user });
    return user;
  }

  public async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  // Students
  public async getStudentById(id: string): Promise<Student | null> {
    return this.students.get(id) || null;
  }

  public async getAllStudents(): Promise<Student[]> {
    return Array.from(this.students.values());
  }

  public async updateStudent(student: Student): Promise<Student> {
    this.students.set(student.id, { ...student });
    return student;
  }

  public async createStudent(student: Student): Promise<Student> {
    this.students.set(student.id, { ...student });
    return student;
  }

  public async deleteStudent(id: string): Promise<boolean> {
    return this.students.delete(id);
  }

  // Teachers
  public async getTeacherById(id: string): Promise<Teacher | null> {
    return this.teachers.get(id) || null;
  }

  public async getAllTeachers(): Promise<Teacher[]> {
    return Array.from(this.teachers.values());
  }

  public async updateTeacher(teacher: Teacher): Promise<Teacher> {
    this.teachers.set(teacher.id, { ...teacher });
    return teacher;
  }

  public async createTeacher(teacher: Teacher): Promise<Teacher> {
    this.teachers.set(teacher.id, { ...teacher });
    return teacher;
  }

  public async deleteTeacher(id: string): Promise<boolean> {
    return this.teachers.delete(id);
  }

  // Classrooms & Classes
  public async getAllClassrooms(): Promise<Classroom[]> {
    return Array.from(this.classrooms.values());
  }

  public async getClassroomById(id: string): Promise<Classroom | null> {
    return this.classrooms.get(id) || null;
  }

  public async getAllClasses(): Promise<ClassEntity[]> {
    return Array.from(this.classes.values());
  }

  public async getClassById(id: string): Promise<ClassEntity | null> {
    return this.classes.get(id) || null;
  }

  public async getClassesByTeacherId(teacherId: string): Promise<ClassEntity[]> {
    return Array.from(this.classes.values()).filter(c => c.teacherId === teacherId);
  }

  public async getClassMemberships(query: ClassMembershipQuery = {}): Promise<ClassMembership[]> {
    const rows: ClassMembership[] = [];
    for (const cls of this.classes.values()) {
      for (const studentId of cls.studentIds || []) {
        if (query.studentId && studentId !== query.studentId) continue;
        rows.push({ classId: cls.id, studentId });
      }
    }
    return rows;
  }

  public async getStudentsPage(query: StudentPageQuery = {}): Promise<StudentPage> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(1000, Math.max(1, query.limit || 50));
    const search = (query.search || '').trim().toLowerCase();

    const classIdsByStudent = new Map<string, string[]>();
    for (const membership of await this.getClassMemberships()) {
      const ids = classIdsByStudent.get(membership.studentId) || [];
      ids.push(membership.classId);
      classIdsByStudent.set(membership.studentId, ids);
    }

    let students = await this.getAllStudents();
    students = students.map(student => ({
      ...student,
      enrolledClassIds: classIdsByStudent.get(student.id) || [],
    }));

    if (search) {
      students = students.filter(student =>
        student.id.toLowerCase().includes(search) ||
        student.name.toLowerCase().includes(search) ||
        (student.phone || '').includes(search) ||
        (student.email || '').toLowerCase().includes(search)
      );
    }

    const from = (page - 1) * limit;
    return { students: students.slice(from, from + limit), total: students.length };
  }

  public async getClassesByStudentId(studentId: string): Promise<ClassEntity[]> {
    return Array.from(this.classes.values()).filter(c => c.studentIds.includes(studentId));
  }

  public async updateClass(classEntity: ClassEntity): Promise<ClassEntity> {
    this.classes.set(classEntity.id, { ...classEntity });
    return classEntity;
  }

  public async deleteClass(id: string): Promise<boolean> {
    const existed = this.classes.delete(id);
    return existed;
  }

  public async createClass(classEntity: ClassEntity): Promise<ClassEntity> {
    this.classes.set(classEntity.id, { ...classEntity });
    return classEntity;
  }

  // Schedule
  public async getAllScheduleSlots(): Promise<ScheduleSlot[]> {
    return Array.from(this.scheduleSlots.values());
  }

  public async getScheduleSlotsQuery(query: ScheduleSlotQuery = {}): Promise<ScheduleSlotWithClassName[]> {
    const slots = Array.from(this.scheduleSlots.values()).filter(slot => {
      if (query.date && slot.date !== query.date) return false;
      if (query.dateFrom && slot.date < query.dateFrom) return false;
      if (query.dateTo && slot.date > query.dateTo) return false;
      if (query.classId && slot.classId !== query.classId) return false;
      if (query.classIds && !query.classIds.includes(slot.classId)) return false;
      if (query.teacherId && slot.teacherId !== query.teacherId) return false;
      if (query.excludeCancelled && slot.status === 'Đã hủy') return false;
      return true;
    });

    return slots.map(slot => {
      const cls = this.classes.get(slot.classId);
      return {
        ...slot,
        subject: slot.subject || cls?.subject || cls?.name || '',
        meetingLink: slot.meetingLink || cls?.meetingLink || '',
        className: cls?.name,
      };
    });
  }

  
  // Time Shifts
  public async getAllTimeShifts(): Promise<TimeShift[]> {
    if (this.timeShifts.size === 0) {
      TIME_SHIFTS.forEach(s => this.timeShifts.set(s.id, { ...s, isActive: true }));
    }
    return Array.from(this.timeShifts.values()).sort((a, b) => a.id - b.id);
  }

  public async getTimeShiftById(id: number): Promise<TimeShift | null> {
    await this.getAllTimeShifts();
    return this.timeShifts.get(id) || null;
  }

  public async createTimeShift(shift: TimeShift): Promise<TimeShift> {
    await this.getAllTimeShifts();
    this.timeShifts.set(shift.id, { ...shift });
    return shift;
  }

  public async updateTimeShift(shift: TimeShift): Promise<TimeShift> {
    await this.getAllTimeShifts();
    this.timeShifts.set(shift.id, { ...shift });
    return shift;
  }

  public async deleteTimeShift(id: number): Promise<boolean> {
    await this.getAllTimeShifts();
    return this.timeShifts.delete(id);
  }

  public async getScheduleSlotById(id: string): Promise<ScheduleSlot | null> {
    return this.scheduleSlots.get(id) || null;
  }

  public async getScheduleSlotsByTeacherId(teacherId: string): Promise<ScheduleSlot[]> {
    return Array.from(this.scheduleSlots.values()).filter(s => s.teacherId === teacherId);
  }

  public async getScheduleSlotsByClassId(classId: string): Promise<ScheduleSlot[]> {
    return Array.from(this.scheduleSlots.values()).filter(s => s.classId === classId);
  }

  public async getScheduleSlotsByStudentId(studentId: string): Promise<ScheduleSlot[]> {
    const studentClasses = await this.getClassesByStudentId(studentId);
    const classIds = new Set(studentClasses.map(c => c.id));
    return Array.from(this.scheduleSlots.values()).filter(s => classIds.has(s.classId));
  }

  public async createScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    this.scheduleSlots.set(slot.id, { ...slot });
    return slot;
  }

  public async updateScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    this.scheduleSlots.set(slot.id, { ...slot });
    return slot;
  }

  // Attendance
  public async getAttendanceBySlotId(slotId: string): Promise<AttendanceRecord[]> {
    return Array.from(this.attendanceRecords.values()).filter(a => a.scheduleSlotId === slotId);
  }

  public async getAttendanceByStudentId(studentId: string): Promise<AttendanceRecord[]> {
    return Array.from(this.attendanceRecords.values()).filter(a => a.studentId === studentId);
  }

  public async getAttendanceByClassId(classId: string): Promise<AttendanceRecord[]> {
    return Array.from(this.attendanceRecords.values()).filter(a => a.classId === classId);
  }

  public async getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
    return Array.from(this.attendanceRecords.values()).filter(a => a.date === date);
  }

  public async saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    this.attendanceRecords.set(record.id, { ...record });
    return record;
  }

  public async saveAttendanceBatch(records: AttendanceRecord[]): Promise<AttendanceRecord[]> {
    records.forEach(r => this.attendanceRecords.set(r.id, { ...r }));
    return records;
  }

  // Requests
  public async getAllRequests(): Promise<ClassRequest[]> {
    return Array.from(this.classRequests.values());
  }

  public async getRequestById(id: string): Promise<ClassRequest | null> {
    return this.classRequests.get(id) || null;
  }

  public async getRequestsByStudentId(studentId: string): Promise<ClassRequest[]> {
    return Array.from(this.classRequests.values()).filter(r => r.studentId === studentId);
  }

  public async getRequestsByTeacherId(teacherId: string): Promise<ClassRequest[]> {
    const teacherClasses = await this.getClassesByTeacherId(teacherId);
    const classIds = new Set(teacherClasses.map(c => c.id));
    return Array.from(this.classRequests.values()).filter(r => classIds.has(r.classId));
  }

  public async createRequest(request: ClassRequest): Promise<ClassRequest> {
    this.classRequests.set(request.id, { ...request });
    return request;
  }

  public async updateRequest(request: ClassRequest): Promise<ClassRequest> {
    this.classRequests.set(request.id, { ...request });
    return request;
  }


  // Session Packages
  public async getAllSessionPackages(): Promise<SessionPackage[]> {
    return Array.from(this.sessionPackages.values());
  }

  public async getSessionPackageById(id: string): Promise<SessionPackage | null> {
    return this.sessionPackages.get(id) || null;
  }

  public async createSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    this.sessionPackages.set(pkg.id, { ...pkg });
    return pkg;
  }

  public async updateSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    this.sessionPackages.set(pkg.id, { ...pkg });
    return pkg;
  }

  public async deleteSessionPackage(id: string): Promise<boolean> {
    return this.sessionPackages.delete(id);
  }

  // Finance
  public async getAllTuitionInvoices(): Promise<TuitionInvoice[]> {
    return Array.from(this.tuitionInvoices.values());
  }

  public async getTuitionInvoicesByStudentId(studentId: string): Promise<TuitionInvoice[]> {
    return Array.from(this.tuitionInvoices.values()).filter(t => t.studentId === studentId);
  }

  public async getTuitionInvoiceById(id: string): Promise<TuitionInvoice | null> {
    return this.tuitionInvoices.get(id) || null;
  }

  
  public async createTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    this.tuitionInvoices.set(invoice.id, invoice);
    return invoice;
  }

  public async updateTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    this.tuitionInvoices.set(invoice.id, { ...invoice });
    return invoice;
  }

  public async getAllPayrollRecords(month?: string): Promise<PayrollRecord[]> {
    const list = Array.from(this.payrollRecords.values());
    if (month) {
      return list.filter(p => p.month === month);
    }
    return list;
  }

  public async getPayrollByTeacherId(teacherId: string, month?: string): Promise<PayrollRecord | null> {
    for (const p of this.payrollRecords.values()) {
      if (p.teacherId === teacherId && (!month || p.month === month)) {
        return p;
      }
    }
    return null;
  }

  public async updatePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    this.payrollRecords.set(record.id, { ...record });
    return record;
  }

  public async savePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    this.payrollRecords.set(record.id, { ...record });
    return record;
  }

  // Notifications
  public async getNotifications(userId?: string, role?: string): Promise<AppNotification[]> {
    const all = Array.from(this.notifications.values());
    return all.filter(n => {
      if (n.recipientRole === 'ALL') return true;
      if (role && n.recipientRole === role) return true;
      if (userId && n.recipientUserId === userId) return true;
      return false;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async addNotification(notification: Omit<AppNotification, 'id' | 'createdAt'>): Promise<AppNotification> {
    const id = `NOTIF_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const full: AppNotification = {
      ...notification,
      id,
      createdAt: new Date().toISOString(),
    };
    this.notifications.set(id, full);
    return full;
  }

  public async markNotificationAsRead(id: string): Promise<boolean> {
    const n = this.notifications.get(id);
    if (n) {
      n.isRead = true;
      return true;
    }
    return false;
  }

  public async markAllNotificationsAsRead(userId?: string): Promise<boolean> {
    for (const n of this.notifications.values()) {
      if (!userId || n.recipientUserId === userId || n.recipientRole === 'ALL') {
        n.isRead = true;
      }
    }
    return true;
  }

  // Audit Logs
  public async getAllAuditLogs(): Promise<AuditLog[]> {
    return [...this.auditLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  public async getAuditLogsPage(query: AuditLogPageQuery = {}): Promise<AuditLogPage> {
    const limit = Math.min(500, Math.max(1, query.limit || 50));
    const offset = Math.max(0, query.offset || 0);
    const search = (query.search || '').trim().toLowerCase();

    let logs = await this.getAllAuditLogs();
    if (search) {
      logs = logs.filter(log =>
        log.userName.toLowerCase().includes(search) ||
        log.userId.toLowerCase().includes(search) ||
        log.action.toLowerCase().includes(search) ||
        log.details.toLowerCase().includes(search)
      );
    }

    return { logs: logs.slice(offset, offset + limit), total: logs.length };
  }

  public async addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    const newLog: AuditLog = {
      ...log,
      id: `AUD${(this.auditLogs.length + 1).toString().padStart(4, '0')}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(newLog);
    return newLog;
  }

}

export const localRepo = LocalRepository.getInstance();
