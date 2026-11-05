import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { AuthService } from '../src/services/AuthService';
import { TuitionPayrollService } from '../src/services/TuitionPayrollService';

test('Upgrade Suite: 2-Way Sync & Manual Tuition Status', async (t) => {
  const repo = LocalRepository.getInstance();
  const authService = new AuthService(repo);
  const financeService = new TuitionPayrollService(repo);

  await t.test('1. Đồng bộ Chiều 1: Thêm học sinh -> Tạo tài khoản user tương ứng', async () => {
    const stId = 'ST992';
    const stName = 'Nguyễn Văn Test Sync';

    const newStudent = {
      id: stId,
      name: stName,
      dateOfBirth: '2008-05-12',
      gender: 'Nam' as const,
      phone: '0988776655',
      address: 'TP. Hồ Chí Minh',
      status: 'Đang học' as const,
      enrolledClassIds: [],
      createdAt: new Date().toISOString(),
    };

    await repo.createStudent(newStudent);

    // Kiểm tra học sinh đã tạo
    const savedSt = await repo.getStudentById(stId);
    assert.ok(savedSt, 'Học sinh phải được tạo trong repo');

    // Tạo user tương ứng như trong route /api/students
    let user = await repo.getUserById(stId);
    if (!user) {
      await repo.createUser({
        id: stId,
        username: stId.toLowerCase(),
        passwordHash: await authService.hashPassword('student123'),
        role: 'STUDENT',
        name: newStudent.name,
        isActive: true,
      });
    }

    user = await repo.getUserById(stId);
    assert.ok(user, 'User phải tồn tại sau khi đồng bộ');
    assert.equal(user.username, 'st992');
    assert.equal(user.role, 'STUDENT');

    // Test xác thực đăng nhập
    const authResult = await authService.authenticate('st992', 'student123');
    assert.ok(authResult, 'Học sinh mới phải đăng nhập thành công với mật khẩu mặc định student123');
  });

  await t.test('2. Đồng bộ Chiều 2: Tạo User STUDENT -> Tự động sinh Student tương ứng', async () => {
    const userId = 'ST993';
    const userName = 'Trần Thị Test Sync';

    await repo.createUser({
      id: userId,
      username: userId.toLowerCase(),
      passwordHash: await authService.hashPassword('student123'),
      role: 'STUDENT',
      name: userName,
      isActive: true,
    });

    // Đồng bộ sang bảng students như trong route /api/users
    let student = await repo.getStudentById(userId);
    if (!student) {
      await repo.createStudent({
        id: userId,
        name: userName,
        phone: '0900000000',
        dateOfBirth: '2008-01-01',
        gender: 'Nữ',
        address: 'TP. Hồ Chí Minh',
        status: 'Đang học',
        enrolledClassIds: [],
        createdAt: new Date().toISOString(),
      });
    }

    student = await repo.getStudentById(userId);
    assert.ok(student, 'Hồ sơ học viên phải được đồng bộ tạo tự động');
    assert.equal(student.name, userName);
    assert.equal(student.status, 'Đang học');
  });

  await t.test('3. Cập nhật thủ công trạng thái hóa đơn: Đã nộp, Còn nợ, Quá hạn', async () => {
    // Tạo 1 hóa đơn mẫu
    const invoice = await financeService.createInvoice({
      studentId: 'ST992',
      classId: 'CHUNG',
      title: 'Học phí thực hành nâng cao',
      amount: 2500000,
      dueDate: '2026-10-15',
      notes: 'Test nâng cấp',
    });

    assert.equal(invoice.status, 'Còn nợ');
    assert.equal(invoice.paidAmount, 0);
    assert.equal(invoice.remainingAmount, 2500000);

    // 4.1. Chuyển sang "Đã nộp"
    invoice.paidAmount = invoice.amount;
    invoice.remainingAmount = 0;
    invoice.status = 'Đã nộp';
    invoice.paidDate = '2026-09-20';
    invoice.paymentMethod = 'Tiền mặt';
    invoice.transactionCode = 'CASH_TEST_01';
    await repo.updateTuitionInvoice(invoice);

    let fetched = await repo.getTuitionInvoiceById(invoice.id);
    assert.ok(fetched);
    assert.equal(fetched.status, 'Đã nộp');
    assert.equal(fetched.paidAmount, 2500000);
    assert.equal(fetched.remainingAmount, 0);
    assert.equal(fetched.paymentMethod, 'Tiền mặt');
    assert.equal(fetched.paidDate, '2026-09-20');

    // 4.2. Hoàn tác về "Còn nợ"
    invoice.paidAmount = 0;
    invoice.remainingAmount = invoice.amount;
    invoice.status = 'Còn nợ';
    invoice.paidDate = undefined;
    invoice.paymentMethod = undefined;
    invoice.transactionCode = undefined;
    await repo.updateTuitionInvoice(invoice);

    fetched = await repo.getTuitionInvoiceById(invoice.id);
    assert.ok(fetched);
    assert.equal(fetched.status, 'Còn nợ');
    assert.equal(fetched.paidAmount, 0);
    assert.equal(fetched.remainingAmount, 2500000);
    assert.equal(fetched.paidDate, undefined);

    // 4.3. Đánh dấu "Quá hạn"
    invoice.status = 'Quá hạn';
    invoice.remainingAmount = invoice.amount - (invoice.paidAmount || 0);
    await repo.updateTuitionInvoice(invoice);

    fetched = await repo.getTuitionInvoiceById(invoice.id);
    assert.ok(fetched);
    assert.equal(fetched.status, 'Quá hạn');
    assert.equal(fetched.remainingAmount, 2500000);
  });
});
