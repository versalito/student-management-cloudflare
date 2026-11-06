import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/app/api/payment/webhook/route';
import { repo } from '../src/repositories';
import { TuitionInvoice } from '../src/types/finance';
import { authed, sessionCookie } from './helpers/auth';

test('Bank Payment Webhook & Reconciliation Suite: Kiểm tra phân hệ gạch nợ tự động', async (t) => {
  // Chuẩn bị dữ liệu mẫu cho test suite
  const testStudentId = 'ST_TEST_001';
  const inv1Id = 'TUI_TEST_001';
  const inv2Id = 'TUI_TEST_002';

  const initialInv1: TuitionInvoice = {
    id: inv1Id,
    studentId: testStudentId,
    classId: 'CLS01',
    title: 'Học phí môn Lập trình React tháng 09/2026',
    amount: 2000000,
    paidAmount: 0,
    remainingAmount: 2000000,
    dueDate: '2026-09-10',
    status: 'Còn nợ',
  };

  const initialInv2: TuitionInvoice = {
    id: inv2Id,
    studentId: testStudentId,
    classId: 'CLS02',
    title: 'Học phí môn Lập trình Node.js tháng 10/2026',
    amount: 1500000,
    paidAmount: 0,
    remainingAmount: 1500000,
    dueDate: '2026-10-10',
    status: 'Còn nợ',
  };

  // Nạp hóa đơn mẫu vào repository
  await repo.createTuitionInvoice(initialInv1);
  await repo.createTuitionInvoice(initialInv2);

  await t.test('1. POST /api/payment/webhook từ chối nếu số tiền <= 0 hoặc payload thiếu', async () => {
    const req = authed('http://localhost:3000/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transferType: 'in',
        transferAmount: 0,
        content: 'Chuyen tien hoc phi',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.message.includes('không hợp lệ'));
  });

  await t.test('2. POST /api/payment/webhook bỏ qua giao dịch chuyển tiền đi (transferType = out)', async () => {
    const req = authed('http://localhost:3000/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transferType: 'out',
        transferAmount: 500000,
        content: 'Chuyen tien rut von',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.message.includes('Bỏ qua'));
  });

  await t.test('3. Webhook chuyển khoản đúng mã hóa đơn (TUI_TEST_001) -> Gạch nợ thành công, chuyển sang Đã nộp', async () => {
    const req = authed('http://localhost:3000/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateway: 'SePay',
        accountNumber: '0987654321',
        transferType: 'in',
        transferAmount: 2000000,
        referenceCode: 'TXN_TEST_FULL_01',
        content: `Nop tien hoc phi ${inv1Id}`,
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.invoiceId, inv1Id);
    assert.equal(data.studentId, testStudentId);
    assert.equal(data.amountPaid, 2000000);

    // Kiểm tra hóa đơn trong repository
    const updated = await repo.getTuitionInvoiceById(inv1Id);
    assert.ok(updated);
    assert.equal(updated.paidAmount, 2000000);
    assert.equal(updated.remainingAmount, 0);
    assert.equal(updated.status, 'Đã nộp');
    assert.equal(updated.paymentMethod, 'Chuyển khoản QR');
    assert.equal(updated.transactionCode, 'TXN_TEST_FULL_01');
    assert.ok(updated.paidDate);
  });

  await t.test('4. Webhook chuyển khoản thiếu tiền (Partial payment) -> Giảm remainingAmount, giữ trạng thái Còn nợ', async () => {
    const req = authed('http://localhost:3000/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateway: 'Casso',
        accountNumber: '0987654321',
        transferType: 'in',
        transferAmount: 500000,
        referenceCode: 'TXN_TEST_PARTIAL_01',
        content: `Thanh toan 1 phan ${inv2Id}`,
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.invoiceId, inv2Id);
    assert.equal(data.amountPaid, 500000);

    // Kiểm tra hóa đơn trong repository
    const updated = await repo.getTuitionInvoiceById(inv2Id);
    assert.ok(updated);
    assert.equal(updated.paidAmount, 500000);
    assert.equal(updated.remainingAmount, 1000000);
    assert.equal(updated.status, 'Còn nợ');
    assert.equal(updated.transactionCode, 'TXN_TEST_PARTIAL_01');
  });

  await t.test('5. Webhook chuyển khoản theo Mã SV (ST_TEST_001) -> Tự động tìm hóa đơn còn nợ và gạch nợ (FIFO)', async () => {
    const req = authed('http://localhost:3000/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateway: 'MBBank',
        accountNumber: '0987654321',
        transferType: 'in',
        transferAmount: 1000000,
        referenceCode: 'TXN_TEST_FIFO_01',
        content: `${testStudentId} nop tiep phan con lai`,
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.studentId, testStudentId);

    // inv2 vốn còn nợ 1.000.000, sau khi nộp tiếp 1.000.000 phải chuyển sang Đã nộp
    const updatedInv2 = await repo.getTuitionInvoiceById(inv2Id);
    assert.ok(updatedInv2);
    assert.equal(updatedInv2.paidAmount, 1500000);
    assert.equal(updatedInv2.remainingAmount, 0);
    assert.equal(updatedInv2.status, 'Đã nộp');
  });

  await t.test('6. Kiểm tra ghi nhận Audit Log chuẩn xác với action PAYMENT_PROCESS và chi tiết nguồn BANK_WEBHOOK_AUTO', async () => {
    const auditLogs = await repo.getAllAuditLogs();
    const webhookLogs = auditLogs.filter(
      log => log.userId === 'SYSTEM_BANK_WEBHOOK' && log.action === 'PAYMENT_PROCESS'
    );

    assert.ok(webhookLogs.length >= 3);
    const latestLog = webhookLogs[0];
    assert.equal(latestLog.userRole, 'SYSTEM');
    assert.equal(latestLog.targetResource, 'TUITION');
    assert.ok(latestLog.details.includes('[BANK_WEBHOOK_AUTO]'));
  });

  await t.test('7. Webhook trả về 404 nếu không tìm thấy mã hóa đơn hoặc sinh viên phù hợp trong nội dung', async () => {
    const req = authed('http://localhost:3000/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateway: 'SePay',
        accountNumber: '0987654321',
        transferType: 'in',
        transferAmount: 500000,
        referenceCode: 'TXN_UNKNOWN_01',
        content: 'Chuyen tien khong ghi ro noi dung',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.message.includes('Không tìm thấy'));
  });

  await t.test('8. Bắt buộc secret khi BANK_WEBHOOK_SECRET được cấu hình', async () => {
    const secret = 'test-webhook-secret-0123456789abcdef';
    process.env.BANK_WEBHOOK_SECRET = secret;
    try {
      const payload = JSON.stringify({
        gateway: 'SePay',
        transferType: 'in',
        transferAmount: 100000,
        referenceCode: 'TXN_NO_SECRET_01',
        content: `Nop tien ${inv2Id}`,
      });

      const withoutSecret = authed('http://localhost:3000/api/payment/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      const rejected = await POST(withoutSecret);
      assert.equal(rejected.status, 401);
      assert.equal((await rejected.json()).success, false);

      const wrongSecret = authed('http://localhost:3000/api/payment/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'sai-secret' },
        body: payload,
      });
      assert.equal((await POST(wrongSecret)).status, 401);

      const withSecret = authed('http://localhost:3000/api/payment/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
        body: payload,
      });
      assert.equal((await POST(withSecret)).status, 200);
    } finally {
      delete process.env.BANK_WEBHOOK_SECRET;
    }
  });

  await t.test('9. Gửi lại cùng referenceCode không gạch nợ lần hai', async () => {
    // inv1 đang "Đã nộp"; gửi lại đúng giao dịch đã xử lý ở test 3.
    const replay = authed('http://localhost:3000/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gateway: 'SePay',
        transferType: 'in',
        transferAmount: 2000000,
        referenceCode: 'TXN_TEST_FULL_01',
        content: `Nop tien hoc phi ${inv1Id}`,
      }),
    });

    const res = await POST(replay);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.duplicate, true);
    assert.equal(data.appliedAmount, 2000000);

    const unchanged = await repo.getTuitionInvoiceById(inv1Id);
    assert.ok(unchanged);
    assert.equal(unchanged.paidAmount, 2000000, 'số tiền đã nộp không được cộng thêm');

    const ledger = await repo.getBankTransaction('TXN_TEST_FULL_01');
    assert.ok(ledger);
    assert.equal(ledger.invoiceIds, inv1Id);
    assert.equal(ledger.resultStatus, 200);
  });
});
