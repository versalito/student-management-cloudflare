import { repo } from '../repositories';
import { StudentMonthlyPackage } from '../types/monthlyPackage';

export class MonthlyPackageService {
  private static packages: Map<string, StudentMonthlyPackage> = new Map();

  public static getPreviousMonth(monthStr: string): string {
    const [y, m] = monthStr.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = (prevDate.getMonth() + 1).toString().padStart(2, '0');
    return prevYear + '-' + prevMonth;
  }

  public static async registerMonthlyPackage(params: {
    studentId: string;
    month: string;
    packageName: string;
    totalSessions: number;
    price: number;
    paymentStatus?: 'CHƯA_NỘP' | 'ĐÃ_NỘP' | 'CÒN_NỢ';
    note?: string;
  }): Promise<StudentMonthlyPackage> {
    const id = 'SMP_' + params.studentId + '_' + params.month.replace('-', '_');
    
    // Tìm tháng liền kề trước để tính rollover
    const prevMonth = this.getPreviousMonth(params.month);
    const prevPkgId = 'SMP_' + params.studentId + '_' + prevMonth.replace('-', '_');
    const prevPkg = this.packages.get(prevPkgId);
    
    const rolloverSessions = prevPkg ? Math.max(0, prevPkg.remainingSessions) : 0;
    const usedSessions = 0;
    const remainingSessions = params.totalSessions + rolloverSessions - usedSessions;

    const pkg: StudentMonthlyPackage = {
      id,
      studentId: params.studentId,
      month: params.month,
      packageName: params.packageName,
      totalSessions: params.totalSessions,
      rolloverSessions,
      usedSessions,
      remainingSessions,
      price: params.price,
      paymentStatus: params.paymentStatus || 'CHƯA_NỘP',
      note: params.note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.packages.set(id, pkg);

    await repo.addAuditLog({
      action: 'CREATE',
      userId: 'SYSTEM',
      userName: 'Hệ thống Gói tháng',
      userRole: 'ADMIN',
      targetResource: 'TUITION',
      targetId: id,
      details: 'Đăng ký gói tháng ' + params.month + ' cho học sinh ' + params.studentId + ': ' + params.totalSessions + ' buổi + ' + rolloverSessions + ' buổi dồn = ' + remainingSessions + ' buổi',
    });

    return pkg;
  }

  public static async recordSessionAttendance(studentId: string, month: string): Promise<StudentMonthlyPackage | null> {
    const id = 'SMP_' + studentId + '_' + month.replace('-', '_');
    const pkg = this.packages.get(id);
    if (!pkg) return null;

    pkg.usedSessions += 1;
    pkg.remainingSessions = Math.max(0, pkg.totalSessions + pkg.rolloverSessions - pkg.usedSessions);
    pkg.updatedAt = new Date().toISOString();
    this.packages.set(id, pkg);
    return pkg;
  }

  public static async getStudentPackage(studentId: string, month: string): Promise<StudentMonthlyPackage | null> {
    const id = 'SMP_' + studentId + '_' + month.replace('-', '_');
    return this.packages.get(id) || null;
  }

  public static async getAllPackagesByMonth(month: string): Promise<StudentMonthlyPackage[]> {
    return Array.from(this.packages.values()).filter(p => p.month === month);
  }

  public static clearAll(): void {
    this.packages.clear();
  }
}
