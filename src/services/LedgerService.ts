import { repo } from '../repositories';
import { ManualExpense, LedgerMonthlySummary, TeacherTimesheetSummary } from '../types/ledger';

export interface LedgerActor {
  id: string;
  name: string;
  role: string;
}

const SYSTEM_ACTOR: LedgerActor = { id: 'SYSTEM', name: 'Hệ thống', role: 'SYSTEM' };

export class LedgerService {
  private static expenses: Map<string, ManualExpense> = new Map();

  public static async addExpense(params: {
    title: string;
    amount: number;
    category?: 'Mặt bằng' | 'Thiết bị' | 'Giáo trình' | 'Vận hành' | 'Khác';
    expenseDate?: string;
    note?: string;
    createdBy?: string;
  }, actor: LedgerActor = SYSTEM_ACTOR): Promise<ManualExpense> {
    const id = 'EXP_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const exp: ManualExpense = {
      id,
      title: params.title,
      amount: Number(params.amount),
      category: params.category || 'Vận hành',
      expenseDate: params.expenseDate || new Date().toISOString().split('T')[0],
      note: params.note,
      createdBy: params.createdBy || actor.id,
      createdAt: new Date().toISOString()
    };
    this.expenses.set(id, exp);

    await repo.addAuditLog({
      action: 'CREATE',
      userId: exp.createdBy,
      userName: actor.name,
      userRole: actor.role,
      targetResource: 'FINANCE',
      targetId: id,
      details: 'Tạo khoản chi: ' + exp.title + ' - Số tiền: ' + exp.amount.toLocaleString('vi-VN') + ' đ',
    });

    return exp;
  }

  public static async deleteExpense(id: string, actor: LedgerActor = SYSTEM_ACTOR): Promise<boolean> {
    const exp = this.expenses.get(id);
    if (!exp) return false;
    this.expenses.delete(id);

    await repo.addAuditLog({
      action: 'DELETE',
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      targetResource: 'FINANCE',
      targetId: id,
      details: 'Xóa khoản chi: ' + exp.title + ' - ' + exp.amount + ' đ',
    });

    return true;
  }

  public static async getExpensesByMonth(month: string): Promise<ManualExpense[]> {
    return Array.from(this.expenses.values()).filter(e => e.expenseDate.startsWith(month));
  }

  public static async calculateMonthlyLedger(month: string): Promise<LedgerMonthlySummary> {
    const allInvoices = await repo.getAllTuitionInvoices();
    const monthInvoices = allInvoices.filter(inv => (inv.paidDate && inv.paidDate.startsWith(month)) || (inv.dueDate && inv.dueDate.startsWith(month)));
    const totalRevenue = monthInvoices.reduce((sum, inv) => sum + (Number(inv.paidAmount) || 0), 0);

    const teachers = await repo.getAllTeachers();
    const slots = await repo.getAllScheduleSlots();
    const monthSlots = slots.filter(s => s.date.startsWith(month));

    let totalTeacherExpense = 0;
    let totalTeacherSessions = 0;

    teachers.forEach(tc => {
      const tcSlots = monthSlots.filter(s => s.teacherId === tc.id);
      const rate = tc.ratePerSession || 250000;
      const paidSlots = tcSlots.filter(isSessionPayable);
      totalTeacherSessions += paidSlots.length;
      totalTeacherExpense += paidSlots.length * rate;
    });

    const manualList = await this.getExpensesByMonth(month);
    const totalManualExpense = manualList.reduce((sum, e) => sum + Number(e.amount), 0);

    const totalExpense = totalTeacherExpense + totalManualExpense;
    const netProfit = totalRevenue - totalExpense;

    return {
      month,
      totalRevenue,
      totalTeacherExpense,
      totalManualExpense,
      totalExpense,
      netProfit,
      invoicesCount: monthInvoices.length,
      teacherSessionsCount: totalTeacherSessions,
      teacherScheduledCount: monthSlots.filter(s => s.status !== 'Đã hủy').length,
      expenses: manualList,
    };
  }

  public static async getTeacherTimesheets(month: string): Promise<TeacherTimesheetSummary[]> {
    const teachers = await repo.getAllTeachers();
    const slots = await repo.getAllScheduleSlots();
    const monthSlots = slots.filter(s => s.date.startsWith(month));

    return teachers.map(tc => {
      const tcSlots = monthSlots.filter(s => s.teacherId === tc.id);
      const rate = tc.ratePerSession || 250000;
      const scheduledSlots = tcSlots.filter(s => s.status !== 'Đã hủy');
      const checkedInSlots = tcSlots.filter(s => !!s.checkinTime);
      const paidSlots = tcSlots.filter(isSessionPayable);
      const lateSlots = tcSlots.filter(s => s.checkinStatus === 'Đi muộn');
      const totalEarnings = paidSlots.length * rate;

      return {
        teacherId: tc.id,
        teacherName: tc.name,
        month,
        totalSessions: paidSlots.length,
        scheduledSessions: scheduledSlots.length,
        checkedInSessions: checkedInSlots.length,
        lateSessions: lateSlots.length,
        ratePerSession: rate,
        totalEarnings,
        status: 'CHƯA_CHỐT' as const
      };
    });
  }

  public static clearAll(): void {
    this.expenses.clear();
  }
}

/**
 * Một ca được tính trả lương khi giáo viên đã chấm công vào ca,
 * hoặc ca đã được đánh dấu hoàn thành (dữ liệu cũ trước khi có chấm công).
 */
function isSessionPayable(slot: { checkinTime?: string; status: string }): boolean {
  if (slot.status === 'Đã hủy') return false;
  return slot.status === 'Đã hoàn thành';
}
