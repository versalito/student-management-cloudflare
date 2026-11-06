import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../src/app/api/settings/bank/route';
import { generateVietQRUrl } from '../src/utils/vietqr';
import { TuitionPayrollService } from '../src/services/TuitionPayrollService';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { authed, sessionCookie } from './helpers/auth';

test('Bank Settings & VietQR Suite: Kiểm tra API cấu hình ngân hàng & helper sinh mã QR', async (t) => {
  await t.test('1. GET /api/settings/bank trả về cấu hình mặc định', async () => {
    const res = await GET(authed('http://localhost/api'));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.bankConfig);
    assert.equal(data.bankConfig.bankId, 'MB');
    assert.equal(data.bankConfig.accountNumber, '0987654321');
  });

  await t.test('2. POST /api/settings/bank cập nhật thông tin tài khoản thành công', async () => {
    const updateReq = authed('http://localhost:3000/api/settings/bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankId: 'VCB',
        bankName: 'Ngân hàng Ngoại Thương (Vietcombank)',
        accountNumber: '1234567890',
        accountName: 'trung tam toilaning',
      }),
    });
    const res = await POST(updateReq);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.bankConfig.bankId, 'VCB');
    assert.equal(data.bankConfig.accountNumber, '1234567890');
    assert.equal(data.bankConfig.accountName, 'TRUNG TAM TOILANING');

    // Kiểm tra lại qua GET
    const resGet = await GET(authed('http://localhost/api'));
    const dataGet = await resGet.json();
    assert.equal(dataGet.bankConfig.bankId, 'VCB');
    assert.equal(dataGet.bankConfig.accountNumber, '1234567890');
  });

  await t.test('3. Helper generateVietQRUrl sinh đúng URL chuẩn Napas247 với nội dung là Mã Học Sinh', () => {
    const url = generateVietQRUrl({
      bankId: 'MB',
      accountNumber: '0987654321',
      accountName: 'NGUYEN VAN A',
      amount: 2800000,
      studentId: 'ST001',
    });
    assert.ok(url.startsWith('https://img.vietqr.io/image/MB-0987654321-compact2.png'));
    assert.ok(url.includes('amount=2800000'));
    assert.ok(url.includes('addInfo=ST001'));
    assert.ok(url.includes('accountName=NGUYEN%20VAN%20A'));
  });

  await t.test('4. TuitionPayrollService.createInvoice không cần classId, tự động fallback về CHUNG', async () => {
    const repo = LocalRepository.getInstance();
    const financeService = new TuitionPayrollService(repo);

    const invoice = await financeService.createInvoice({
      studentId: 'ST001',
      title: 'Học phí tổng hợp - K2026',
      amount: 3000000,
      dueDate: '2026-10-15',
    });

    assert.ok(invoice.id);
    assert.equal(invoice.studentId, 'ST001');
    assert.ok(invoice.classId);
    assert.equal(invoice.amount, 3000000);
    assert.equal(invoice.status, 'Còn nợ');
  });
});
