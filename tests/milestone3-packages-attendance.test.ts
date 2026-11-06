import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { GET as getPackages, POST as postPackage, PUT as putPackage, DELETE as deletePackage } from '../src/app/api/packages/route';
import { GET as getFinance, POST as postFinance, PUT as putFinance } from '../src/app/api/finance/route';
import { GET as getAnalytics } from '../src/app/api/attendance/analytics/route';
import { GET as getCurrentSession } from '../src/app/api/attendance/current-session/route';
import { generateVietQRUrl } from '../src/utils/vietqr';
import { SessionPackage } from '../src/types/package';
import { authed, sessionCookie } from './helpers/auth';

test('Milestone 3 Suite: Quản lý Gói Buổi Học, Tự Chọn Gói, Status Override & Thống Kê Chuyên Cần', async (t) => {
  const repo = LocalRepository.getInstance();

  await t.test('1. Gói Buổi Học (Session Packages) CRUD qua API /api/packages', async () => {
    // 1.1 GET /api/packages
    const reqGet = authed('http://localhost:3000/api/packages');
    const resGet = await getPackages(reqGet);
    const dataGet = await resGet.json();
    assert.equal(resGet.status, 200);
    assert.equal(dataGet.success, true);
    assert.ok(Array.isArray(dataGet.packages));
    assert.ok(dataGet.packages.length >= 3, 'Phải có các gói mặc định');

    // 1.2 POST /api/packages - Tạo gói mới
    const newPkgData = {
      name: 'Gói Thử Nghiệm 15 Buổi',
      sessionCount: 15,
      price: 1500000,
      isActive: true,
      description: 'Gói dành cho học sinh mới',
    };
    const reqPost = authed('http://localhost:3000/api/packages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPkgData),
    });
    const resPost = await postPackage(reqPost);
    const dataPost = await resPost.json();
    assert.equal(resPost.status, 201);
    assert.equal(dataPost.success, true);
    assert.equal(dataPost.package.name, 'Gói Thử Nghiệm 15 Buổi');
    assert.equal(dataPost.package.sessionCount, 15);
    assert.equal(dataPost.package.price, 1500000);
    const createdId = dataPost.package.id;

    // 1.3 PUT /api/packages - Cập nhật số buổi & giá tiền
    const reqPut = authed('http://localhost:3000/api/packages', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: createdId,
        price: 1400000,
        sessionCount: 16,
        isActive: false,
      }),
    });
    const resPut = await putPackage(reqPut);
    const dataPut = await resPut.json();
    assert.equal(resPut.status, 200);
    assert.equal(dataPut.success, true);
    assert.equal(dataPut.package.price, 1400000);
    assert.equal(dataPut.package.sessionCount, 16);
    assert.equal(dataPut.package.isActive, false);

    // 1.4 DELETE /api/packages - Xóa gói
    const reqDel = authed(`http://localhost:3000/api/packages?id=${createdId}`);
    const resDel = await deletePackage(reqDel);
    const dataDel = await resDel.json();
    assert.equal(resDel.status, 200);
    assert.equal(dataDel.success, true);

    const deletedPkg = await repo.getSessionPackageById(createdId);
    assert.equal(deletedPkg, null, 'Gói phải bị xóa khỏi repo');
  });

  await t.test('2. Học sinh Tự Chọn Gói (Self-checkout) & Sinh VietQR động chuẩn cú pháp TUI <MãSV> <MãHĐ>', async () => {
    const studentId = 'ST001';
    const packages = await repo.getAllSessionPackages();
    const activePkg = packages.find(p => p.isActive) || packages[0];
    assert.ok(activePkg, 'Phải có ít nhất 1 gói khả dụng');

    // 2.1 Học sinh bấm mua gói qua POST /api/finance action: PURCHASE_PACKAGE
    const reqPurchase = authed('http://localhost:3000/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'PURCHASE_PACKAGE',
        studentId,
        packageId: activePkg.id,
      }),
    });
    const resPurchase = await postFinance(reqPurchase);
    const dataPurchase = await resPurchase.json();
    assert.equal(resPurchase.status, 201);
    assert.equal(dataPurchase.success, true);
    assert.ok(dataPurchase.invoice.id.startsWith('TUI'));
    assert.equal(dataPurchase.invoice.studentId, studentId);
    assert.equal(dataPurchase.invoice.packageId, activePkg.id);
    assert.equal(dataPurchase.invoice.sessionCount, activePkg.sessionCount);
    assert.equal(dataPurchase.invoice.amount, activePkg.price);
    assert.equal(dataPurchase.invoice.status, 'Còn nợ');

    // 2.2 Kiểm tra URL VietQR động theo format yêu cầu: TUI <MãSV> <MãHóaĐơn>
    const qrUrl = generateVietQRUrl({
      bankId: 'MB',
      accountNumber: '0987654321',
      accountName: 'NGUYEN VAN A',
      amount: dataPurchase.invoice.amount,
      studentId: dataPurchase.invoice.studentId,
      invoiceId: dataPurchase.invoice.id,
    });
    const expectedMemo = encodeURIComponent(`TUI ${studentId} ${dataPurchase.invoice.id}`);
    assert.ok(qrUrl.includes(`addInfo=${expectedMemo}`), 'Nội dung chuyển khoản VietQR phải là TUI <MãSV> <MãHĐ>');
  });

  await t.test('3. Admin Kiểm Kê & Sửa Thủ Công Trạng Thái (Status Override) với 4 trạng thái & Ghi Audit Log', async () => {
    // Tạo 1 invoice để sửa
    const invoice = await repo.createTuitionInvoice({
      id: 'TUI_OVERRIDE_001',
      studentId: 'ST005',
      classId: 'CLS01',
      packageId: 'PKG20',
      sessionCount: 20,
      title: 'Học phí gói 20 buổi',
      amount: 1800000,
      paidAmount: 0,
      remainingAmount: 1800000,
      dueDate: '2026-10-20',
      status: 'Còn nợ',
    });

    // 3.1 Chuyển sang "Miễn giảm" kèm lý do học bổng
    const reqOverride1 = authed('http://localhost:3000/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_STATUS',
        invoiceId: invoice.id,
        status: 'Miễn giảm',
        reason: 'Học bổng 100% tài năng trẻ',
        actorId: 'ADMIN001',
        actorName: 'Quản trị viên',
      }),
    });
    const resOverride1 = await postFinance(reqOverride1);
    const dataOverride1 = await resOverride1.json();
    assert.equal(resOverride1.status, 200);
    assert.equal(dataOverride1.invoice.status, 'Miễn giảm');
    assert.equal(dataOverride1.invoice.remainingAmount, 0);
    assert.equal(dataOverride1.invoice.note, 'Học bổng 100% tài năng trẻ');

    // 3.2 Chuyển sang "Đã nộp" (tiền mặt)
    const reqOverride2 = authed('http://localhost:3000/api/finance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceId: invoice.id,
        status: 'Đã nộp',
        paymentMethod: 'Tiền mặt',
        reason: 'Phụ huynh đã nộp trực tiếp tại quầy tiếp tân',
        actorId: 'ADMIN001',
        actorName: 'Quản trị viên',
      }),
    });
    const resOverride2 = await putFinance(reqOverride2);
    const dataOverride2 = await resOverride2.json();
    assert.equal(resOverride2.status, 200);
    assert.equal(dataOverride2.invoice.status, 'Đã nộp');
    assert.equal(dataOverride2.invoice.paidAmount, 1800000);
    assert.equal(dataOverride2.invoice.paymentMethod, 'Tiền mặt');

    // 3.3 Chuyển sang "Quá hạn"
    const reqOverride3 = authed('http://localhost:3000/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_STATUS',
        invoiceId: invoice.id,
        status: 'Quá hạn',
        reason: 'Đã quá hạn 30 ngày chưa thanh toán',
        actorId: 'ADMIN001',
        actorName: 'Quản trị viên',
      }),
    });
    const resOverride3 = await postFinance(reqOverride3);
    const dataOverride3 = await resOverride3.json();
    assert.equal(resOverride3.status, 200);
    assert.equal(dataOverride3.invoice.status, 'Quá hạn');

    // 3.4 Kiểm tra Audit Log ghi nhận đầy đủ lý do
    const logs = await repo.getAllAuditLogs();
    const log = logs.find(l => l.targetId === invoice.id && l.details.includes('Quá hạn'));
    assert.ok(log, 'Phải có Audit Log cho thao tác sửa trạng thái');
    assert.ok(log?.details.includes('Đã quá hạn 30 ngày chưa thanh toán'));
  });

  await t.test('4. Theo dõi lớp đang học Real-time (/api/attendance/current-session)', async () => {
    // 2026-09-21 là Thứ Hai, có ca học thật trong thời khóa biểu.
    const reqSession = authed('http://localhost:3000/api/attendance/current-session?date=2026-09-21');
    const resSession = await getCurrentSession(reqSession);
    const dataSession = await resSession.json();

    assert.equal(resSession.status, 200);
    assert.equal(dataSession.success, true);
    assert.ok(dataSession.hasActiveSession, 'Phải có ca học hoạt động');
    assert.ok(dataSession.slot);
    assert.ok(dataSession.stats);
    // 4 nhóm học sinh bắt buộc: Tham gia, Chưa tham gia, Vắng có phép, Vắng không phép
    assert.ok(dataSession.stats.attendedCount !== undefined, 'Phải có số lượng Đã tham gia');
    assert.ok(dataSession.stats.notAttendedCount !== undefined, 'Phải có số lượng Chưa tham gia');
    assert.ok(dataSession.stats.excusedCount !== undefined, 'Phải có số lượng Vắng có phép');
    assert.ok(dataSession.stats.unexcusedCount !== undefined, 'Phải có số lượng Vắng không phép');
    assert.ok(dataSession.stats.attendanceRate >= 0 && dataSession.stats.attendanceRate <= 100);
  });

  await t.test('5. Bảng Tổng Kết Chuyên Cần Theo Tháng (/api/attendance/analytics)', async () => {
    const reqAnalytics = authed('http://localhost:3000/api/attendance/analytics?month=2026-09');
    const resAnalytics = await getAnalytics(reqAnalytics);
    const dataAnalytics = await resAnalytics.json();

    assert.equal(resAnalytics.status, 200);
    assert.equal(dataAnalytics.success, true);
    assert.equal(dataAnalytics.month, '2026-09');
    assert.ok(dataAnalytics.items.length > 0, 'Phải có danh sách thống kê chuyên cần học sinh');

    const firstItem = dataAnalytics.items[0];
    assert.ok(firstItem.studentId, 'Phải có studentId');
    assert.ok(firstItem.studentName, 'Phải có studentName');
    assert.ok(firstItem.totalSlots >= 0, 'Phải có tổng số buổi');
    assert.ok(firstItem.rate >= 0 && firstItem.rate <= 100, 'Attendance Rate % từ 0 đến 100');
  });
});
