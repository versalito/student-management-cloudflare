import { IRepository } from '@/repositories/IRepository';
import { TuitionInvoice, PayrollRecord } from '@/types/finance';

/** Tháng hiện tại theo giờ Việt Nam, dạng YYYY-MM. */
function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' })
    .format(new Date())
    .slice(0, 7);
}

export interface FinanceActor {
  id: string;
  name: string;
  role: string;
}

const SYSTEM_ACTOR: FinanceActor = { id: 'SYSTEM', name: 'Hệ thống', role: 'SYSTEM' };

export class TuitionPayrollService {
  constructor(private repo: IRepository) {}

  /**
   * Tính toán tổng hợp công nợ của học viên
   */
  /**
   * Tạo mới hóa đơn học phí cho học viên
   */
  public async createInvoice(data: {
    studentId: string;
    classId?: string;
    packageId?: string;
    sessionCount?: number;
    usedSessions?: number;
    title: string;
    amount: number;
    dueDate: string;
    notes?: string;
    packageName?: string;
    packagePrice?: number;
  }, actor: FinanceActor = SYSTEM_ACTOR): Promise<TuitionInvoice> {
    if (!data.studentId || !data.title || data.amount <= 0 || !data.dueDate) {
      throw new Error("Thiếu thông tin bắt buộc hoặc số tiền không hợp lệ");
    }

    const invoiceId = `TUI${Date.now().toString().slice(-6)}`;
    // Bỏ qua chọn lớp học: Tự động gắn lớp học sinh đang học hoặc lớp hợp lệ đầu tiên để thỏa mãn Foreign Key Supabase
    let effectiveClassId = data.classId?.trim();
    if (!effectiveClassId || effectiveClassId === 'CHUNG' || effectiveClassId === 'ALL') {
      try {
        const studentClasses = await this.repo.getClassesByStudentId(data.studentId);
        if (studentClasses && studentClasses.length > 0) {
          effectiveClassId = studentClasses[0].id;
        } else {
          const allClasses = await this.repo.getAllClasses();
          effectiveClassId = allClasses.length > 0 ? allClasses[0].id : 'CLS01';
        }
      } catch (e) {
        effectiveClassId = 'CLS01';
      }
    }

    const newInvoice: TuitionInvoice = {
      id: invoiceId,
      studentId: data.studentId,
      classId: effectiveClassId,
      packageId: data.packageId,
      packageName: data.packageName,
      packagePrice: data.packagePrice,
      sessionCount: data.sessionCount,
      usedSessions: data.usedSessions || 0,
      title: data.title,
      amount: data.amount,
      paidAmount: 0,
      remainingAmount: data.amount,
      dueDate: data.dueDate,
      status: "Còn nợ",
      note: data.notes,
    };

    await this.repo.createTuitionInvoice(newInvoice);

    await this.repo.addAuditLog({
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      action: "CREATE",
      targetResource: "TUITION_INVOICE",
      targetId: newInvoice.id,
      details: `Tạo hóa đơn học phí mã ${newInvoice.id} cho học viên ${newInvoice.studentId}, lớp ${newInvoice.classId}. Số tiền: ${newInvoice.amount.toLocaleString("vi-VN")} VNĐ. Hạn nộp: ${newInvoice.dueDate}${data.notes ? ` (Ghi chú: ${data.notes})` : ""}`,
    });

    return newInvoice;
  }

  public async getStudentTuitionSummary(studentId: string) {
    const invoices = await this.repo.getTuitionInvoicesByStudentId(studentId);
    const activeInvoices = invoices.filter(inv => inv.status !== 'Đã hủy');
    const totalBilled = activeInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const totalPaid = activeInvoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
    const totalDebt = activeInvoices.reduce((sum, inv) => sum + inv.remainingAmount, 0);

    return {
      studentId,
      totalBilled,
      totalPaid,
      totalDebt,
      invoiceCount: activeInvoices.length,
      unpaidInvoices: activeInvoices.filter(inv => inv.remainingAmount > 0),
    };
  }

  /**
   * Xử lý thanh toán học phí (giả lập hoặc qua mã giao dịch QR)
   */
  public async processPayment(
    invoiceId: string, 
    paymentAmount: number, 
    method: 'Chuyển khoản QR' | 'Tiền mặt' | 'Thẻ ngân hàng' = 'Chuyển khoản QR',
    transactionCode?: string,
    actor?: FinanceActor
  ): Promise<TuitionInvoice> {
    const invoice = await this.repo.getTuitionInvoiceById(invoiceId);
    if (!invoice) {
      throw new Error(`Không tìm thấy hóa đơn học phí với mã ${invoiceId}`);
    }

    if (paymentAmount <= 0) {
      throw new Error('Số tiền thanh toán phải lớn hơn 0');
    }

    const newPaidAmount = Math.min(invoice.amount, invoice.paidAmount + paymentAmount);
    const newRemainingAmount = invoice.amount - newPaidAmount;

    invoice.paidAmount = newPaidAmount;
    invoice.remainingAmount = newRemainingAmount;
    invoice.status = newRemainingAmount === 0 ? 'Đã nộp' : 'Còn nợ';
    invoice.paidDate = new Date().toISOString().split('T')[0];
    invoice.paymentMethod = method;
    invoice.transactionCode = transactionCode || `PAY_TXN_${Date.now()}`;

    await this.repo.updateTuitionInvoice(invoice);

    // Ghi audit log
    await this.repo.addAuditLog({
      userId: actor?.id ?? invoice.studentId,
      userName: actor?.name ?? `Sinh viên ${invoice.studentId}`,
      userRole: actor?.role ?? 'STUDENT',
      action: 'PAYMENT_PROCESS',
      targetResource: 'TUITION',
      targetId: invoice.id,
      details: `Thanh toán số tiền ${paymentAmount.toLocaleString('vi-VN')} VNĐ qua ${method}. Mã GD: ${invoice.transactionCode}`,
    });

    return invoice;
  }

  /**
   * Tính toán lại bảng lương tháng của Giáo viên dựa trên số buổi dạy thực tế
   */
  public async calculateTeacherPayroll(teacherId: string, month: string = currentMonth()): Promise<PayrollRecord> {
    const teacher = await this.repo.getTeacherById(teacherId);
    if (!teacher) {
      throw new Error(`Không tìm thấy giáo viên với mã ${teacherId}`);
    }

    // Lấy tất cả lịch dạy đã hoàn thành trong tháng đó
    const allSlots = await this.repo.getScheduleSlotsByTeacherId(teacherId);
    const completedSlotsInMonth = allSlots.filter(
      s => s.date.startsWith(month) && s.status === 'Đã hoàn thành'
    );

    const totalSlots = completedSlotsInMonth.length;
    const totalHours = totalSlots * 2;
    // Chuẩn thực tế Mr. Thuyết: Lương giảng viên tính cố định theo ca dạy (ratePerSession)
    const sessionRate = teacher.ratePerSession || teacher.hourlyRate || 250000;
    const grossSalary = totalSlots * sessionRate;
    // Chỉ thưởng khi thực sự có ca dạy hoàn thành trong tháng.
    const bonus = totalSlots === 0 ? 0 : totalSlots >= 12 ? 1000000 : 500000;
    const deduction = 0;
    const netSalary = grossSalary + bonus - deduction;

    let existingPayroll = await this.repo.getPayrollByTeacherId(teacherId, month);
    if (!existingPayroll) {
      existingPayroll = {
        id: `PAY_${teacherId}_${month.replace('-', '')}`,
        teacherId,
        month,
        totalSlots,
        totalHours,
        hourlyRate: teacher.hourlyRate,
        grossSalary,
        bonus,
        deduction,
        netSalary,
        status: 'Tạm tính',
      };
      await this.repo.savePayrollRecord(existingPayroll);
    } else {
      existingPayroll.totalSlots = totalSlots;
      existingPayroll.totalHours = totalHours;
      existingPayroll.hourlyRate = teacher.hourlyRate;
      existingPayroll.grossSalary = grossSalary;
      existingPayroll.bonus = bonus;
      existingPayroll.deduction = deduction;
      existingPayroll.netSalary = netSalary;
      await this.repo.updatePayrollRecord(existingPayroll);
    }

    return existingPayroll;
  }

  /**
   * Chốt hoặc thanh toán bảng lương cho giáo viên
   */
  public async finalizePayroll(
    payrollId: string,
    action: 'CHỐT' | 'THANH_TOÁN',
    actor: FinanceActor = SYSTEM_ACTOR
  ): Promise<PayrollRecord> {
    const all = await this.repo.getAllPayrollRecords();
    const payroll = all.find(p => p.id === payrollId);
    if (!payroll) {
      throw new Error(`Không tìm thấy bảng lương ${payrollId}`);
    }

    payroll.status = action === 'CHỐT' ? 'Đã chốt' : 'Đã thanh toán';
    if (action === 'THANH_TOÁN') {
      payroll.paidDate = new Date().toISOString().split('T')[0];
    }
    await this.repo.updatePayrollRecord(payroll);

    await this.repo.addAuditLog({
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      action: 'UPDATE',
      targetResource: 'PAYROLL',
      targetId: payroll.id,
      details: `${action === 'CHỐT' ? 'Chốt' : 'Thanh toán'} bảng lương mã ${payroll.id} cho giáo viên ${payroll.teacherId}. Thực nhận: ${payroll.netSalary.toLocaleString('vi-VN')} VNĐ`,
    });

    return payroll;
  }
}
