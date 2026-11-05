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
import { matchesUniFilter } from '@/lib/studentFilters';
import { Student } from '@/types/student';
import { Teacher } from '@/types/teacher';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { TimeShift, TIME_SHIFTS } from '@/types/schedule';
import { ScheduleSlot, ClassRequest, StudentSlotSwap } from '@/types/schedule';
import { AttendanceRecord } from '@/types/attendance';
import { TuitionInvoice, PayrollRecord } from '@/types/finance';
import { SessionPackage } from '@/types/package';
import { DEFAULT_PACKAGES } from './seeds/seedPackages';
import { AuditLog } from '@/types/audit';
import { generateSeedData } from './seeds/seedData';
import { dateToDayOfWeek } from '@/utils/date';

export class LocalRepository implements IRepository {
  private static instance: LocalRepository;

  private users: Map<string, User> = new Map();
  private students: Map<string, Student> = new Map();
  private teachers: Map<string, Teacher> = new Map();
  private classes: Map<string, ClassEntity> = new Map();
 private classSections: Map<string, ClassSection> = new Map();
 private classSectionStudents: Map<string, string[]> = new Map(); // sectionId -> studentIds
  private classSectionStudentDays: Map<string, Record<string, number[]>> = new Map(); // sectionId -> {studentId: scheduleDays}
 private scheduleSlots: Map<string, ScheduleSlot> = new Map();
 private appSettings: Map<string, any> = new Map();
  private slotSwaps: Map<string, StudentSlotSwap> = new Map();
 
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
    seed.classes.forEach(cl => this.classes.set(cl.id, cl));
    seed.sections.forEach(sec => this.classSections.set(sec.id, sec));
    seed.sections.forEach(sec => {
      const ids = sec.studentIds || [];
      this.classSectionStudents.set(sec.id, [...ids]);
      this.classSections.set(sec.id, { ...sec, studentIds: [...ids] });
    });
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
    this.classes.clear();
   this.classSections.clear();
   this.classSectionStudents.clear();
    this.classSectionStudentDays.clear();
   this.scheduleSlots.clear();
   this.appSettings.clear();
    this.slotSwaps.clear();
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

  // Classes
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
        (student.phone || '').includes(search)
      );
    }

    if (query.status && query.status !== 'ALL') {
      students = students.filter(student => student.status === query.status);
    }

    if (query.uni && query.uni !== 'ALL') {
      students = students.filter(student => matchesUniFilter(student, query.uni!));
    }

    if (query.all) {
      return { students, total: students.length };
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
    if (existed) {
      for (const [secId, sec] of this.classSections.entries()) {
        if (sec.classId === id) {
          this.classSections.delete(secId);
          this.classSectionStudents.delete(secId);
          this.classSectionStudentDays.delete(secId);
        }
      }
      for (const [recId, rec] of this.attendanceRecords.entries()) {
        if (rec.classId === id) {
          this.attendanceRecords.delete(recId);
        }
      }
      for (const [reqId, req] of this.classRequests.entries()) {
        if (req.classId === id) {
          this.classRequests.delete(reqId);
        }
      }
    }
    return existed;
  }

  public async createClass(classEntity: ClassEntity): Promise<ClassEntity> {
    this.classes.set(classEntity.id, { ...classEntity });
    return classEntity;
  }

  // Class Sections
  private withStudentScheduleDays(section: ClassSection): ClassSection {
    const studentIds = this.classSectionStudents.get(section.id) || section.studentIds || [];
    const studentScheduleDays: Record<string, number[]> = {};
    const daysMap = this.classSectionStudentDays.get(section.id) || {};
    for (const stId of studentIds) {
      studentScheduleDays[stId] = daysMap[stId] || [];
    }
    return { ...section, studentIds, studentScheduleDays };
  }

  public async getClassSections(classId: string): Promise<ClassSection[]> {
    const list = Array.from(this.classSections.values()).filter(s => s.classId === classId);
    const joined = list.map(s => this.withStudentScheduleDays(s));
    return joined.sort((a, b) => (a.shiftId || 0) - (b.shiftId || 0));
  }

  public async getSectionById(id: string): Promise<ClassSection | null> {
    const sec = this.classSections.get(id) || null;
    if (sec) {
      return this.withStudentScheduleDays(sec);
    }
    return null;
  }

  public async getSectionsByStudentId(studentId: string): Promise<ClassSection[]> {
    const result: ClassSection[] = [];
    for (const sec of this.classSections.values()) {
      const ids = this.classSectionStudents.get(sec.id) || sec.studentIds || [];
      if (ids.includes(studentId)) {
        result.push(this.withStudentScheduleDays(sec));
      }
    }
    return result;
  }

  public async getSectionsByTeacherId(teacherId: string): Promise<ClassSection[]> {
    const result: ClassSection[] = [];
    for (const sec of this.classSections.values()) {
      if (sec.teacherId === teacherId && sec.isActive !== false) {
        result.push(this.withStudentScheduleDays(sec));
      }
    }
    return result.sort((a, b) => (a.shiftId || 0) - (b.shiftId || 0));
  }

  public async getAllClassSections(): Promise<ClassSection[]> {
    const result: ClassSection[] = [];
    for (const sec of this.classSections.values()) {
      result.push(this.withStudentScheduleDays(sec));
    }
    return result.sort((a, b) => (a.shiftId || 0) - (b.shiftId || 0));
  }

  public async createClassSection(section: ClassSection): Promise<ClassSection> {
    this.classSections.set(section.id, { ...section });
    this.classSectionStudents.set(section.id, [...(section.studentIds || [])]);
    return section;
  }

  public async updateClassSection(section: ClassSection): Promise<ClassSection> {
    this.classSections.set(section.id, { ...section });
    if (section.studentIds !== undefined) {
      this.classSectionStudents.set(section.id, [...section.studentIds]);
    }
    return section;
  }

  public async deleteClassSection(id: string): Promise<boolean> {
    const existed = this.classSections.delete(id);
    this.classSectionStudents.delete(id);
    this.classSectionStudentDays.delete(id);
    return existed;
  }

  public async addStudentToSection(sectionId: string, studentId: string, scheduleDays?: number[]): Promise<void> {
    const ids = this.classSectionStudents.get(sectionId) || [];
    if (!ids.includes(studentId)) {
      ids.push(studentId);
      this.classSectionStudents.set(sectionId, ids);
    }
    // Lưu thứ riêng nếu học sinh chọn bớt buổi; rỗng (mảng rỗng) nghĩa là theo lịch ca.
    if (scheduleDays !== undefined) {
      const daysMap = this.classSectionStudentDays.get(sectionId) || {};
      daysMap[studentId] = scheduleDays;
      this.classSectionStudentDays.set(sectionId, daysMap);
    }
  }

  public async removeStudentFromSection(sectionId: string, studentId: string): Promise<void> {
    const ids = (this.classSectionStudents.get(sectionId) || []).filter(id => id !== studentId);
    this.classSectionStudents.set(sectionId, ids);
    const daysMap = this.classSectionStudentDays.get(sectionId);
    if (daysMap) {
      delete daysMap[studentId];
      this.classSectionStudentDays.set(sectionId, daysMap);
    }
  }

  public async getSectionStudentScheduleDays(sectionId: string): Promise<Record<string, number[]>> {
    return this.classSectionStudentDays.get(sectionId) || {};
  }

  public async getSlotSwaps(filter: { studentId?: string; toSlotId?: string; fromSlotId?: string; date?: string; status?: 'ACTIVE' | 'CANCELLED' }): Promise<StudentSlotSwap[]> {
    let result = Array.from(this.slotSwaps.values());
    if (filter.studentId) result = result.filter(s => s.studentId === filter.studentId);
    if (filter.toSlotId) result = result.filter(s => s.toSlotId === filter.toSlotId);
    if (filter.fromSlotId) result = result.filter(s => s.fromSlotId === filter.fromSlotId);
    if (filter.date) result = result.filter(s => s.date === filter.date);
    if (filter.status) result = result.filter(s => s.status === filter.status);
    return result;
  }

  public async createSlotSwap(swap: StudentSlotSwap): Promise<StudentSlotSwap> {
    this.slotSwaps.set(swap.id, { ...swap });
    return swap;
  }

  // App Settings
  public async getAppSetting<T = any>(key: string): Promise<T | null> {
    return this.appSettings.has(key) ? (this.appSettings.get(key) as T) : null;
  }

  public async setAppSetting(key: string, value: any): Promise<void> {
    this.appSettings.set(key, value);
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
      if (query.sectionIds && query.sectionIds.length > 0) {
        const inSection = !!slot.sectionId && query.sectionIds.includes(slot.sectionId);
        const unsectioned =
          query.includeUnsectioned === true &&
          !slot.sectionId &&
          (!query.classIds || query.classIds.includes(slot.classId));
        if (!inSection && !unsectioned) return false;
      }
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
    // Học sinh chỉ thấy các buổi thuộc ca mà mình tham gia.
   const studentSections = await this.getSectionsByStudentId(studentId);
   const classIds = new Set(studentSections.map(s => s.classId));
   const sectionIds = new Set(studentSections.map(s => s.id));
    // Thứ riêng của từng học sinh trong từng ca.
    const studentDaysBySection = new Map<string, number[]>();
    for (const sec of studentSections) {
      const daysMap = await this.getSectionStudentScheduleDays(sec.id);
      studentDaysBySection.set(sec.id, daysMap[studentId] || []);
    }
   return Array.from(this.scheduleSlots.values()).filter(s => {
     if (s.sectionId && sectionIds.size > 0) {
       return sectionIds.has(s.sectionId);
     }
     return classIds.has(s.classId);
    })
      .filter(s => {
        if (!s.sectionId) return true;
        const days = studentDaysBySection.get(s.sectionId) || [];
        // Mảng rỗng = theo đúng lịch ca (không lọc thêm).
        if (days.length === 0) return true;
        const dow = dateToDayOfWeek(s.date);
        return dow !== null && days.includes(dow);
      });
 }

  public async createScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    this.scheduleSlots.set(slot.id, { ...slot });
    return slot;
  }

  public async updateScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    this.scheduleSlots.set(slot.id, { ...slot });
    return slot;
  }

  public async createScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    for (const slot of slots) {
      this.scheduleSlots.set(slot.id, { ...slot });
    }
    return slots;
  }

  public async updateScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    for (const slot of slots) {
      this.scheduleSlots.set(slot.id, { ...slot });
    }
    return slots;
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
    if (query.action && query.action !== 'ALL') {
      logs = logs.filter(log => log.action === query.action);
    }
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

  public async getAuditActionCounts(actions: string[]): Promise<Record<string, number>> {
    const logs = await this.getAllAuditLogs();
    const counts: Record<string, number> = {};
    for (const action of actions) {
      counts[action] = logs.filter(log => log.action === action).length;
    }
    counts.ALL = logs.length;
    return counts;
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
