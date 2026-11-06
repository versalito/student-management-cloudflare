import { IRepository } from '@/repositories/IRepository';
import { repo } from '@/repositories';
import { Student } from '@/types/student';
import { AuthService } from './AuthService';

import { MonthlyPackageService } from './MonthlyPackageService';

export interface StudentActor {
  id: string;
  name: string;
  role: string;
}

const SYSTEM_ACTOR: StudentActor = { id: 'SYSTEM', name: 'Hệ thống', role: 'SYSTEM' };

export class StudentService {
  constructor(private repo: IRepository) {}

  /**
   * Sinh mã học sinh dạng nămstt (YYxxx) tự động tăng.
   * Ví dụ: năm 2026 -> YY = "26". Tìm mã 26xxx lớn nhất và tăng lên 1 (padStart 3 số: 26001).
   */
  public async generateNextStudentId(targetYear?: number): Promise<string> {
    const year = targetYear || new Date().getFullYear();
    const yearPrefix = year.toString().slice(-2); // '26' for 2026

    const allStudents = await this.repo.getAllStudents();
    
    // Tìm các mã dạng {yearPrefix}xxx
    const regex = new RegExp(`^${yearPrefix}(\\d{3,})$`);
    let maxSequence = 0;

    for (const student of allStudents) {
      const match = String(student.id || '').trim().match(regex);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSequence) {
          maxSequence = seq;
        }
      }
    }

    const nextSeq = maxSequence + 1;
    return `${yearPrefix}${nextSeq.toString().padStart(3, '0')}`;
  }

  /**
   * Tạo nhanh học sinh (1-Click Fast Onboarding):
   * - Sinh mã học sinh dạng YYxxx (ví dụ 26001)
   * - Tạo Student trong database/repo
   * - Tự động tạo tài khoản User: username = 26xxx (lowercase/standard), password mặc định = '123456', role = 'STUDENT'
   * - Ghi Audit Log
   */
  public async createStudentFastOnboarding(params: {
    name: string;
    phone?: string;
    actorId?: string;
    actorName?: string;
    actorRole?: string;
  }): Promise<{ student: Student; defaultPassword: string }> {
    const {
      name,
      phone = '',
      actorId = SYSTEM_ACTOR.id,
      actorName = SYSTEM_ACTOR.name,
      actorRole = SYSTEM_ACTOR.role,
    } = params;

    if (!name || !name.trim()) {
      throw new Error('Họ và tên học sinh là bắt buộc');
    }

    const studentId = await this.generateNextStudentId();
    const defaultPassword = '123456';

    const newStudent: Student = {
      id: studentId,
      name: name.trim(),
      dateOfBirth: '2008-01-01',
      gender: 'Nam',
      phone: phone.trim() || '0900000000',
      address: 'TP. Hồ Chí Minh',
      status: 'Đang học',
      enrolledClassIds: [],
      createdAt: new Date().toISOString(),
    };

    // Bảng students có khoá ngoại trỏ sang users, nên phải tạo tài khoản trước.
    const authService = new AuthService(this.repo);
    const existingUser = await this.repo.getUserById(studentId);
    if (!existingUser) {
      await this.repo.createUser({
        id: studentId,
        username: studentId.toLowerCase(),
        passwordHash: await authService.hashPassword(defaultPassword),
        role: 'STUDENT',
        name: newStudent.name,
        isActive: true,
      });
    }

    await this.repo.createStudent(newStudent);

    await this.repo.addAuditLog({
      action: 'CREATE',
      userId: actorId,
      userName: actorName,
      userRole: actorRole,
      targetResource: 'STUDENT',
      targetId: studentId,
      details: `Tạo nhanh học sinh mới [${studentId}] - ${name.trim()}`,
    });

    return {
      student: newStudent,
      defaultPassword,
    };
  }

  public static async updateStudentStatus(
    studentId: string,
    status: 'Đang học' | 'Tạm dừng' | 'Đã nghỉ học',
    reason?: string,
    actor: StudentActor = SYSTEM_ACTOR
  ): Promise<{ student: any; dropoutAudit?: any }> {
    const student = await repo.getStudentById(studentId);
    if (!student) throw new Error('Không tìm thấy học sinh ' + studentId);

    const oldStatus = student.status;
    student.status = status;
    await repo.updateStudent(student);

    let dropoutAudit: any = null;

    if (status === 'Đã nghỉ học') {
      const allUsers = await repo.getAllUsers();
      const linkedUser = allUsers.find(u => (u as any).studentId === studentId || u.username === studentId || u.username === studentId.toLowerCase());
      if (linkedUser) {
        linkedUser.isActive = false;
        await repo.updateUser(linkedUser);
      }

      const currentMonth = new Date().toISOString().substring(0, 7);
      const activePackage = await MonthlyPackageService.getStudentPackage(studentId, currentMonth);

      dropoutAudit = {
        studentId,
        studentName: student.name,
        action: 'DROPOUT_PROCESSED',
        accountLocked: !!linkedUser,
        currentMonth,
        remainingSessions: activePackage ? activePackage.remainingSessions : 0,
        refundEstimate: activePackage ? Math.round((activePackage.price / (activePackage.totalSessions || 1)) * activePackage.remainingSessions) : 0,
        reason: reason || 'Nghỉ học theo yêu cầu'
      };
    }

    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      targetResource: 'STUDENT',
      targetId: studentId,
      details: 'Thay đổi trạng thái học sinh ' + studentId + ' (' + student.name + ') từ ' + oldStatus + ' -> ' + status + '. Lý do: ' + (reason || 'Không ghi chú'),
    });

    return { student, dropoutAudit };
  }
}
