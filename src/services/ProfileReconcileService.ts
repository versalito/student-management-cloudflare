import { IRepository } from '@/repositories/IRepository';
import { Student, Teacher } from '@/types';

export interface ReconcileResult {
  studentsCreated: string[];
  teachersCreated: string[];
}

/**
 * Đối soát hồ sơ: bổ sung bản ghi students/teachers còn thiếu cho user đã tồn tại.
 *
 * Trước đây việc này chạy ngầm ngay trong GET /api/students và GET /api/teachers:
 * mỗi lần mở trang là 3 query toàn bảng + ghi dữ liệu. Giờ nó là thao tác tường minh,
 * idempotent (chạy lại không tạo trùng), dùng cho route admin và script CLI.
 */
export class ProfileReconcileService {
  constructor(private repo: IRepository) {}

  public async reconcile(): Promise<ReconcileResult> {
    const [users, students, teachers] = await Promise.all([
      this.repo.getAllUsers(),
      this.repo.getAllStudents(),
      this.repo.getAllTeachers(),
    ]);

    const studentIds = new Set(students.map(s => s.id));
    const teacherIds = new Set(teachers.map(t => t.id));

    const studentsCreated: string[] = [];
    const teachersCreated: string[] = [];

    for (const user of users) {
      if (user.role === 'STUDENT' && !studentIds.has(user.id)) {
        const student: Student = {
          id: user.id,
          name: user.name,
          email: user.email || `${user.username}@student.local`,
          phone: '0900000000',
          dateOfBirth: '2008-01-01',
          gender: 'Nam',
          address: 'TP. Hồ Chí Minh',
          status: 'Đang học',
          enrolledClassIds: [],
          createdAt: new Date().toISOString(),
        };
        await this.repo.createStudent(student);
        studentIds.add(user.id);
        studentsCreated.push(user.id);
      }

      if (user.role === 'TEACHER' && !teacherIds.has(user.id)) {
        const teacher: Teacher = {
          id: user.id,
          name: user.name,
          email: user.email || `${user.username}@edu.vn`,
          phone: '0901234567',
          specialty: 'Bộ môn chung',
          hourlyRate: 300000,
          ratePerSession: 250000,
          status: 'Đang dạy',
          assignedClassIds: [],
          createdAt: new Date().toISOString(),
        };
        await this.repo.createTeacher(teacher);
        teacherIds.add(user.id);
        teachersCreated.push(user.id);
      }
    }

    return { studentsCreated, teachersCreated };
  }
}
