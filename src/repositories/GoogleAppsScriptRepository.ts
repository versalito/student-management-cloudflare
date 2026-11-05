import { LocalRepository } from './LocalRepository';
import { IRepository } from "./IRepository";
import type {
  AuditLogPage,
  AuditLogPageQuery,
  ClassMembership,
  ClassMembershipQuery,
  ScheduleSlotQuery,
  ScheduleSlotWithClassName,
  StudentPage,
  StudentPageQuery,
} from "./IRepository";
import { AppNotification } from "@/types/notification";
import { User } from "@/types/auth";
import { Student } from "@/types/student";
import { Teacher } from "@/types/teacher";
import { Classroom, ClassEntity } from "@/types/classroom";
import { ScheduleSlot, ClassRequest, TimeShift } from "@/types/schedule";
import { AttendanceRecord } from "@/types/attendance";
import { TuitionInvoice, PayrollRecord } from "@/types/finance";
import { SessionPackage } from "@/types/package";
import { AuditLog } from "@/types/audit";
import { localRepo } from "./LocalRepository";

interface GasResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export class GoogleAppsScriptRepository implements IRepository {
  private static instance: GoogleAppsScriptRepository;
  private webAppUrl: string;
  private apiKey: string;
  private fallbackToLocalOnFailure: boolean = true;
  private cache: Map<string, { data: any; expiry: number }> = new Map();
  private readonly CACHE_TTL_MS = 60 * 1000; // 60s in-memory cache

  private getCached<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (item && item.expiry > Date.now()) {
      return item.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, expiry: Date.now() + this.CACHE_TTL_MS });
  }

  public invalidateCache(prefix?: string): void {
    if (!prefix) {
      this.cache.clear();
      return;
    }
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }


  private constructor() {
    this.webAppUrl = process.env.GAS_WEB_APP_URL || "";
    this.apiKey = process.env.GAS_API_KEY || "STUDENT_MANAGEMENT_SECRET_2026";
  }

  public static getInstance(): GoogleAppsScriptRepository {
    if (!GoogleAppsScriptRepository.instance) {
      GoogleAppsScriptRepository.instance = new GoogleAppsScriptRepository();
    }
    return GoogleAppsScriptRepository.instance;
  }

  private async callGas<T = any>(service: string, action: string, params: Record<string, any> = {}): Promise<T> {
    if (!this.webAppUrl) {
      if (this.fallbackToLocalOnFailure) {
        console.warn(`[GAS Repository] GAS_WEB_APP_URL chưa cấu hình, fallback sang LocalRepository cho ${service}.${action}`);
        return this.fallbackCall(service, action, params);
      }
      throw new Error("[GAS Repository] GAS_WEB_APP_URL is not configured.");
    }

    try {
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(this.webAppUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: this.apiKey, service, action, params }),
            cache: "no-store",
            signal: AbortSignal.timeout(4000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          const json: GasResponse<T> = await res.json();
          if (!json.success) throw new Error(`GAS Error [${json.error?.code}]: ${json.error?.message}`);
          return json.data as T;
        } catch (error: any) {
          lastError = error;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
        }
      }
      throw lastError || new Error('GAS request failed');
    } catch (err: any) {
      console.error(`[GAS Repository Error] ${service}.${action} failed:`, err.message);
      if (this.fallbackToLocalOnFailure) {
        console.warn(`[GAS Repository] Fallback sang LocalRepository do lỗi kết nối: ${err.message}`);
        return this.fallbackCall(service, action, params);
      }
      throw err;
    }
  }

  private async fallbackCall(service: string, action: string, params: Record<string, any>): Promise<any> {
    switch (service) {
      case "UserService":
        if (action === "getUserById") return localRepo.getUserById(params.id);
        if (action === "getUserByUsername") return localRepo.getUserByUsername(params.username);
        if (action === "authenticate") return localRepo.authenticate(params.username, params.passwordHash);
        if (action === "getAllUsers") return localRepo.getAllUsers();
        if (action === "updateUser") return localRepo.updateUser(params.user);
        if (action === "createUser") return localRepo.createUser(params.user);
        if (action === "deleteUser") return localRepo.deleteUser(params.id);
        break;
      case "StudentService":
        if (action === "getStudentById") return localRepo.getStudentById(params.id);
        if (action === "getAllStudents") return localRepo.getAllStudents();
        if (action === "updateStudent") return localRepo.updateStudent(params.student);
        if (action === "createStudent") return localRepo.createStudent(params.student);
        if (action === "deleteStudent") return localRepo.deleteStudent(params.id);
        break;
      case "TeacherService":
        if (action === "getTeacherById") return localRepo.getTeacherById(params.id);
        if (action === "getAllTeachers") return localRepo.getAllTeachers();
        if (action === "updateTeacher") return localRepo.updateTeacher(params.teacher);
        if (action === "createTeacher") return localRepo.createTeacher(params.teacher);
        if (action === "deleteTeacher") return localRepo.deleteTeacher(params.id);
        break;
      case "ClassService":
        if (action === "getAllClasses") return localRepo.getAllClasses();
        if (action === "getClassById") return localRepo.getClassById(params.id);
        if (action === "getClassesByTeacherId") return localRepo.getClassesByTeacherId(params.teacherId);
        if (action === "getClassesByStudentId") return localRepo.getClassesByStudentId(params.studentId);
        if (action === "updateClass") return localRepo.updateClass(params.classEntity);
        if (action === "createClass") return localRepo.createClass(params.classEntity);
        break;
      case "ScheduleService":
        if (action === "getAllScheduleSlots") return localRepo.getAllScheduleSlots();
        if (action === "getScheduleSlotById") return localRepo.getScheduleSlotById(params.id);
        if (action === "getSlotsByTeacherId") return localRepo.getScheduleSlotsByTeacherId(params.teacherId);
        if (action === "getSlotsByClassId") return localRepo.getScheduleSlotsByClassId(params.classId);
        if (action === "getSlotsByStudentId") return localRepo.getScheduleSlotsByStudentId(params.studentId);
        if (action === "createScheduleSlot") return localRepo.createScheduleSlot(params.slot);
        if (action === "updateScheduleSlot") return localRepo.updateScheduleSlot(params.slot);
        break;
      case "AttendanceService":
        if (action === "getAttendanceBySlotId") return localRepo.getAttendanceBySlotId(params.slotId);
        if (action === "getAttendanceByStudentId") return localRepo.getAttendanceByStudentId(params.studentId);
        if (action === "getAttendanceByClassId") return localRepo.getAttendanceByClassId(params.classId);
        if (action === "saveAttendanceRecord") return localRepo.saveAttendanceRecord(params.record);
        if (action === "saveAttendanceBatch") return localRepo.saveAttendanceBatch(params.records);
        break;
      case "LeaveRequestService":
        if (action === "getAllRequests") return localRepo.getAllRequests();
        if (action === "getRequestById") return localRepo.getRequestById(params.id);
        if (action === "getRequestsByStudentId") return localRepo.getRequestsByStudentId(params.studentId);
        if (action === "getRequestsByTeacherId") return localRepo.getRequestsByTeacherId(params.teacherId);
        if (action === "createRequest") return localRepo.createRequest(params.request);
        if (action === "updateRequest") return localRepo.updateRequest(params.request);
        break;
      case "TuitionService":
        if (action === "getAllSessionPackages") return localRepo.getAllSessionPackages();
        if (action === "getSessionPackageById") return localRepo.getSessionPackageById(params.id);
        if (action === "createSessionPackage") return localRepo.createSessionPackage(params.pkg);
        if (action === "updateSessionPackage") return localRepo.updateSessionPackage(params.pkg);
        if (action === "deleteSessionPackage") return localRepo.deleteSessionPackage(params.id);
        if (action === "getAllTuitionInvoices") return localRepo.getAllTuitionInvoices();
        if (action === "getTuitionInvoicesByStudentId") return localRepo.getTuitionInvoicesByStudentId(params.studentId);
        if (action === "getTuitionInvoiceById") return localRepo.getTuitionInvoiceById(params.id);
        if (action === "updateTuitionInvoice") return localRepo.updateTuitionInvoice(params.invoice);
        if (action === "createTuitionInvoice") return localRepo.createTuitionInvoice(params.invoice);
        break;
      case "TeacherPayrollPeriodService":
        if (action === "getAllPayrollRecords") return localRepo.getAllPayrollRecords(params.month);
        if (action === "getPayrollByTeacherId") return localRepo.getPayrollByTeacherId(params.teacherId, params.month);
        if (action === "updatePayrollRecord") return localRepo.updatePayrollRecord(params.record);
        if (action === "savePayrollRecord") return localRepo.savePayrollRecord(params.record);
        break;
      case "AuditLogService":
        if (action === "getAllAuditLogs") return localRepo.getAllAuditLogs();
        if (action === "addAuditLog") return localRepo.addAuditLog(params.log);
        break;
      case "NotificationService":
        if (action === "getNotifications") return localRepo.getNotifications(params.userId, params.role);
        if (action === "addNotification") return localRepo.addNotification(params.notification);
        if (action === "markAsRead") return localRepo.markNotificationAsRead(params.id);
        if (action === "markAllAsRead") return localRepo.markAllNotificationsAsRead(params.userId);
        break;
    }
    return null;
  }

  // Users

  // Normalize dates/times from Google Sheets format to local app format
  private normalizeScheduleSlot(slot: any): any {
    if (!slot) return slot;
    // Date: "2026-08-31T17:00:00.000Z" -> "2026-09-01" (timezone shift)
    if (slot.date && slot.date.includes('T')) {
      const d = new Date(slot.date);
      slot.date = d.toISOString().split('T')[0];
    }
    // Google Sheets may serialize time-only cells as 1899 Date objects.
    // Derive the canonical time from shiftId to avoid spreadsheet locale/timezone drift.
    if (slot.shiftId) slot.shiftId = Number(slot.shiftId);
    const shiftTimes: Record<number, [string, string]> = {
      1: ['08:00', '10:00'],
      2: ['10:15', '12:15'],
      3: ['13:30', '15:30'],
      4: ['15:45', '17:45'],
      5: ['18:30', '20:30'],
    };
    if (shiftTimes[slot.shiftId]) {
      [slot.startTime, slot.endTime] = shiftTimes[slot.shiftId];
    }
    return slot;
  }

  private normalizeStudent(student: any): any {
    if (!student) return student;
    // Ensure relationship arrays and Phase-1 display fields are always present.
    if (!student.enrolledClassIds) student.enrolledClassIds = [];
    if (typeof student.enrolledClassIds === 'string') {
      student.enrolledClassIds = student.enrolledClassIds.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    // Map normalized GAS enums to the Vietnamese UI contract.
    const statusMap: Record<string, string> = {
      ACTIVE: 'Đang học', PAUSED: 'Bảo lưu', DROPPED: 'Đã tốt nghiệp',
    };
    student.status = statusMap[student.status] || student.status || 'Đang học';
    student.gender = student.gender || 'Nam';
    // Ensure phone is string and retain leading-zero-friendly presentation where possible.
    if (student.phone !== undefined && student.phone !== null) student.phone = String(student.phone);
    // Normalize dateOfBirth
    if (student.dateOfBirth && student.dateOfBirth.includes('T')) {
      student.dateOfBirth = student.dateOfBirth.split('T')[0];
    }
    return student;
  }

  private normalizeClass(cls: any): any {
    if (!cls) return cls;
    if (!cls.studentIds) cls.studentIds = [];
    if (typeof cls.studentIds === 'string') {
      cls.studentIds = cls.studentIds.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    if (!cls.scheduleDays) cls.scheduleDays = [];
    if (typeof cls.scheduleDays === 'string') {
      cls.scheduleDays = cls.scheduleDays.split(',').map((s: string) => Number(s.trim())).filter(Boolean);
    }
    if (cls.tuitionFee) cls.tuitionFee = Number(cls.tuitionFee);
    if (cls.shiftId) cls.shiftId = Number(cls.shiftId);
    return cls;
  }

  private normalizeTeacher(teacher: any): any {
    if (!teacher) return teacher;
    if (!teacher.assignedClassIds) teacher.assignedClassIds = [];
    if (typeof teacher.assignedClassIds === 'string') {
      teacher.assignedClassIds = teacher.assignedClassIds.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    if (teacher.hourlyRate) teacher.hourlyRate = Number(teacher.hourlyRate);
    if (teacher.phone) teacher.phone = String(teacher.phone);
    return teacher;
  }

  public async getUserById(id: string): Promise<User | null> {
    return this.callGas<User | null>("UserService", "getUserById", { id });
  }

  public async getUserByUsername(username: string): Promise<User | null> {
    return this.callGas<User | null>("UserService", "getUserByUsername", { username });
  }

  public async authenticate(username: string, passwordHash: string): Promise<User | null> {
    // Canonical authentication for local and GAS-mirrored users
    return localRepo.authenticate(username, passwordHash);
  }

  public async getAllUsers(): Promise<User[]> {
    return this.callGas<User[]>("UserService", "getAllUsers");
  }

  public async updateUser(user: User): Promise<User> {
    return this.callGas<User>("UserService", "updateUser", { user });
  }

  public async createUser(user: User): Promise<User> {
    return this.callGas<User>("UserService", "createUser", { user });
  }

  public async deleteUser(id: string): Promise<boolean> {
    return this.callGas<boolean>("UserService", "deleteUser", { id });
  }

  // Students
  public async getStudentById(id: string): Promise<Student | null> {
    const student = await this.callGas<any>("StudentService", "getStudentById", { id });
    if (!student) return null;
    const memberships = await this.getClassMemberships({ studentId: id });
    return this.normalizeStudent({
      ...student,
      enrolledClassIds: memberships.map(m => m.classId),
    });
  }

  public async getAllStudents(): Promise<Student[]> {
    const cached = this.getCached<Student[]>("students:all");
    if (cached) return cached;
    const data = await this.callGas<any>("StudentService", "getAllStudents");
    const students = Array.isArray(data) ? data : (data?.students || []);
    const result = students.map((s: any) => this.normalizeStudent(s));
    this.setCache("students:all", result);
    return result;
  }

  public async updateStudent(student: Student): Promise<Student> {
    this.invalidateCache("students");
    return this.callGas<Student>("StudentService", "updateStudent", { student });
  }

  public async createStudent(student: Student): Promise<Student> {
    this.invalidateCache("students");
    return this.callGas<Student>("StudentService", "createStudent", { student });
  }

  public async deleteStudent(id: string): Promise<boolean> {
    this.invalidateCache("students");
    return this.callGas<boolean>("StudentService", "deleteStudent", { id });
  }

  // Teachers
  public async getTeacherById(id: string): Promise<Teacher | null> {
    const teacher = await this.callGas<any>("TeacherService", "getTeacherById", { id });
    return this.normalizeTeacher(teacher);
  }

  public async getAllTeachers(): Promise<Teacher[]> {
    const cached = this.getCached<Teacher[]>("teachers:all");
    if (cached) return cached;
    const data = await this.callGas<any>("TeacherService", "getAllTeachers");
    const teachers = Array.isArray(data) ? data : (data?.teachers || []);
    const result = teachers.map((t: any) => this.normalizeTeacher(t));
    this.setCache("teachers:all", result);
    return result;
  }

  public async updateTeacher(teacher: Teacher): Promise<Teacher> {
    return this.callGas<Teacher>("TeacherService", "updateTeacher", { teacher });
  }

  public async createTeacher(teacher: Teacher): Promise<Teacher> {
    this.invalidateCache("teachers");
    return this.callGas<Teacher>("TeacherService", "createTeacher", { teacher });
  }

  public async deleteTeacher(id: string): Promise<boolean> {
    this.invalidateCache("teachers");
    return this.callGas<boolean>("TeacherService", "deleteTeacher", { id });
  }

  // Classrooms & Classes
  public async getAllClassrooms(): Promise<Classroom[]> {
    // Classrooms are defined from standard facilities or local
    return localRepo.getAllClassrooms();
  }

  public async getClassroomById(id: string): Promise<Classroom | null> {
    return localRepo.getClassroomById(id);
  }

  public async getAllClasses(): Promise<ClassEntity[]> {
    const cached = this.getCached<ClassEntity[]>("classes:all");
    if (cached) return cached;
    const data = await this.callGas<any>("ClassService", "getAllClasses");
    const classes = Array.isArray(data) ? data : (data?.classes || []);
    const result = classes.map((c: any) => this.normalizeClass(c));
    this.setCache("classes:all", result);
    return result;
  }

  public async getClassById(id: string): Promise<ClassEntity | null> {
    const cls = await this.callGas<any>("ClassService", "getClassById", { id });
    return this.normalizeClass(cls);
  }

  public async getClassesByTeacherId(teacherId: string): Promise<ClassEntity[]> {
    const classes = await this.callGas<any[]>("ClassService", "getClassesByTeacherId", { teacherId });
    return (classes || []).map(c => this.normalizeClass(c));
  }

  public async getClassesByStudentId(studentId: string): Promise<ClassEntity[]> {
    const classes = await this.callGas<any[]>("ClassService", "getClassesByStudentId", { studentId });
    return (classes || []).map(c => this.normalizeClass(c));
  }

  public async updateClass(classEntity: ClassEntity): Promise<ClassEntity> {
    this.invalidateCache("classes");
    return this.callGas<ClassEntity>("ClassService", "updateClass", { classEntity });
  }

  public async deleteClass(id: string): Promise<boolean> {
    return LocalRepository.getInstance().deleteClass(id);
  }

  public async createClass(classEntity: ClassEntity): Promise<ClassEntity> {
    return this.callGas<ClassEntity>("ClassService", "createClass", { classEntity });
  }

  // Schedule
  public async getAllScheduleSlots(): Promise<ScheduleSlot[]> {
    const cached = this.getCached<ScheduleSlot[]>("schedules:all");
    if (cached) return cached;
    const data = await this.callGas<any>("ScheduleService", "getAllScheduleSlots");
    const slots = Array.isArray(data) ? data : (data?.slots || []);
    const result = slots.map((s: any) => this.normalizeScheduleSlot(s));
    this.setCache("schedules:all", result);
    return result;
  }

  
  public async getAllTimeShifts(): Promise<TimeShift[]> { return LocalRepository.getInstance().getAllTimeShifts(); }
  public async getTimeShiftById(id: number): Promise<TimeShift | null> { return LocalRepository.getInstance().getTimeShiftById(id); }
  public async createTimeShift(shift: TimeShift): Promise<TimeShift> { return LocalRepository.getInstance().createTimeShift(shift); }
  public async updateTimeShift(shift: TimeShift): Promise<TimeShift> { return LocalRepository.getInstance().updateTimeShift(shift); }
  public async deleteTimeShift(id: number): Promise<boolean> { return LocalRepository.getInstance().deleteTimeShift(id); }

  public async getScheduleSlotById(id: string): Promise<ScheduleSlot | null> {
    const slot = await this.callGas<any>("ScheduleService", "getScheduleSlotById", { id });
    return this.normalizeScheduleSlot(slot);
  }

  public async getScheduleSlotsByTeacherId(teacherId: string): Promise<ScheduleSlot[]> {
    const slots = await this.callGas<any[]>("ScheduleService", "getSlotsByTeacherId", { teacherId });
    return (slots || []).map(s => this.normalizeScheduleSlot(s));
  }

  public async getScheduleSlotsByClassId(classId: string): Promise<ScheduleSlot[]> {
    const slots = await this.callGas<any[]>("ScheduleService", "getSlotsByClassId", { classId });
    return (slots || []).map(s => this.normalizeScheduleSlot(s));
  }

  public async getScheduleSlotsByStudentId(studentId: string): Promise<ScheduleSlot[]> {
    const slots = await this.callGas<any[]>("ScheduleService", "getSlotsByStudentId", { studentId });
    return (slots || []).map(s => this.normalizeScheduleSlot(s));
  }

  public async createScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    this.invalidateCache("schedules");
    return this.callGas<ScheduleSlot>("ScheduleService", "createScheduleSlot", { slot });
  }

  public async updateScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    this.invalidateCache("schedules");
    return this.callGas<ScheduleSlot>("ScheduleService", "updateScheduleSlot", { slot });
  }

  // Attendance
  public async getAttendanceBySlotId(slotId: string): Promise<AttendanceRecord[]> {
    return this.callGas<AttendanceRecord[]>("AttendanceService", "getAttendanceBySlotId", { slotId });
  }

  public async getAttendanceByStudentId(studentId: string): Promise<AttendanceRecord[]> {
    return this.callGas<AttendanceRecord[]>("AttendanceService", "getAttendanceByStudentId", { studentId });
  }

  public async getAttendanceByClassId(classId: string): Promise<AttendanceRecord[]> {
    return this.callGas<AttendanceRecord[]>("AttendanceService", "getAttendanceByClassId", { classId });
  }

  public async saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    return this.callGas<AttendanceRecord>("AttendanceService", "saveAttendanceRecord", { record });
  }

  public async saveAttendanceBatch(records: AttendanceRecord[]): Promise<AttendanceRecord[]> {
    return this.callGas<AttendanceRecord[]>("AttendanceService", "saveAttendanceBatch", { records });
  }

  // Requests
  public async getAllRequests(): Promise<ClassRequest[]> {
    return this.callGas<ClassRequest[]>("LeaveRequestService", "getAllRequests");
  }

  public async getRequestById(id: string): Promise<ClassRequest | null> {
    return this.callGas<ClassRequest | null>("LeaveRequestService", "getRequestById", { id });
  }

  public async getRequestsByStudentId(studentId: string): Promise<ClassRequest[]> {
    return this.callGas<ClassRequest[]>("LeaveRequestService", "getRequestsByStudentId", { studentId });
  }

  public async getRequestsByTeacherId(teacherId: string): Promise<ClassRequest[]> {
    return this.callGas<ClassRequest[]>("LeaveRequestService", "getRequestsByTeacherId", { teacherId });
  }

  public async createRequest(request: ClassRequest): Promise<ClassRequest> {
    return this.callGas<ClassRequest>("LeaveRequestService", "createRequest", { request });
  }

  public async updateRequest(request: ClassRequest): Promise<ClassRequest> {
    return this.callGas<ClassRequest>("LeaveRequestService", "updateRequest", { request });
  }

  // Session Packages
  public async getAllSessionPackages(): Promise<SessionPackage[]> {
    return localRepo.getAllSessionPackages();
  }

  public async getSessionPackageById(id: string): Promise<SessionPackage | null> {
    return localRepo.getSessionPackageById(id);
  }

  public async createSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    return localRepo.createSessionPackage(pkg);
  }

  public async updateSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    return localRepo.updateSessionPackage(pkg);
  }

  public async deleteSessionPackage(id: string): Promise<boolean> {
    return localRepo.deleteSessionPackage(id);
  }

  // Finance
  public async getAllTuitionInvoices(): Promise<TuitionInvoice[]> {
    return this.callGas<TuitionInvoice[]>("TuitionService", "getAllTuitionInvoices");
  }

  public async getTuitionInvoicesByStudentId(studentId: string): Promise<TuitionInvoice[]> {
    return this.callGas<TuitionInvoice[]>("TuitionService", "getTuitionInvoicesByStudentId", { studentId });
  }

  public async getTuitionInvoiceById(id: string): Promise<TuitionInvoice | null> {
    return this.callGas<TuitionInvoice | null>("TuitionService", "getTuitionInvoiceById", { id });
  }

  public async createTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    return this.callGas<TuitionInvoice>("TuitionService", "createTuitionInvoice", { invoice });
  }

  public async updateTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    return this.callGas<TuitionInvoice>("TuitionService", "updateTuitionInvoice", { invoice });
  }

  public async getAllPayrollRecords(month?: string): Promise<PayrollRecord[]> {
    return this.callGas<PayrollRecord[]>("TeacherPayrollPeriodService", "getAllPayrollRecords", { month });
  }

  public async getPayrollByTeacherId(teacherId: string, month?: string): Promise<PayrollRecord | null> {
    return this.callGas<PayrollRecord | null>("TeacherPayrollPeriodService", "getPayrollByTeacherId", { teacherId, month });
  }

  public async updatePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    return this.callGas<PayrollRecord>("TeacherPayrollPeriodService", "updatePayrollRecord", { record });
  }

  public async savePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    return this.callGas<PayrollRecord>("TeacherPayrollPeriodService", "savePayrollRecord", { record });
  }

  // Audit Logs
  public async getAllAuditLogs(): Promise<AuditLog[]> {
    return this.callGas<AuditLog[]>("AuditLogService", "getAllAuditLogs");
  }

  // Truy vấn tối ưu: GAS trả cả sheet nên lọc/phân trang tại đây (không có SQL).
  public async getScheduleSlotsQuery(query: ScheduleSlotQuery = {}): Promise<ScheduleSlotWithClassName[]> {
    const [slots, classes] = await Promise.all([this.getAllScheduleSlots(), this.getAllClasses()]);
    const classMap = new Map(classes.map(cls => [cls.id, cls]));

    return slots
      .filter(slot => {
        if (query.date && slot.date !== query.date) return false;
        if (query.dateFrom && slot.date < query.dateFrom) return false;
        if (query.dateTo && slot.date > query.dateTo) return false;
        if (query.classId && slot.classId !== query.classId) return false;
        if (query.classIds && !query.classIds.includes(slot.classId)) return false;
        if (query.teacherId && slot.teacherId !== query.teacherId) return false;
        if (query.excludeCancelled && slot.status === 'Đã hủy') return false;
        return true;
      })
      .map(slot => {
        const cls = classMap.get(slot.classId);
        return {
          ...slot,
          subject: slot.subject || cls?.subject || cls?.name || '',
          meetingLink: slot.meetingLink || cls?.meetingLink || '',
          className: cls?.name,
        };
      });
  }

  public async getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
    const classes = await this.getAllClasses();
    const records = await Promise.all(classes.map(cls => this.getAttendanceByClassId(cls.id)));
    return records.flat().filter(record => record.date === date);
  }

  public async getClassMemberships(query: ClassMembershipQuery = {}): Promise<ClassMembership[]> {
    const classes = await this.getAllClasses();
    return classes.flatMap(cls =>
      (cls.studentIds || [])
        .filter(studentId => !query.studentId || studentId === query.studentId)
        .map(studentId => ({ classId: cls.id, studentId }))
    );
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

    let students = (await this.getAllStudents()).map(student => ({
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

  public async getAuditLogsPage(query: AuditLogPageQuery = {}): Promise<AuditLogPage> {
    const limit = Math.min(500, Math.max(1, query.limit || 50));
    const offset = Math.max(0, query.offset || 0);
    const search = (query.search || '').trim().toLowerCase();

    let logs = await this.getAllAuditLogs();
    logs = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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

  public async addAuditLog(log: Omit<AuditLog, "id" | "timestamp">): Promise<AuditLog> {
    return this.callGas<AuditLog>("AuditLogService", "addAuditLog", { log });
  }

  // Notifications
  public async getNotifications(userId?: string, role?: string): Promise<AppNotification[]> {
    return this.callGas<AppNotification[]>("NotificationService", "getNotifications", { userId, role });
  }

  public async addNotification(notification: Omit<AppNotification, "id" | "createdAt">): Promise<AppNotification> {
    return this.callGas<AppNotification>("NotificationService", "addNotification", { notification });
  }

  public async markNotificationAsRead(id: string): Promise<boolean> {
    return this.callGas<boolean>("NotificationService", "markAsRead", { id });
  }

  public async markAllNotificationsAsRead(userId?: string): Promise<boolean> {
    return this.callGas<boolean>("NotificationService", "markAllAsRead", { userId });
  }

  // Reset / Re-seed
  public async resetData(): Promise<void> {
    await this.callGas("Setup", "initializeSheets");
    await localRepo.resetData();
  }

}

export const gasRepo = GoogleAppsScriptRepository.getInstance();
