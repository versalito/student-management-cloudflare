import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { POST as postFinance, DELETE as deleteFinance } from '../src/app/api/finance/route';
import { authed, studentUser, teacherUser, adminUser } from './helpers/auth';

test('Luồng thu học phí: học viên chỉ đọc và huỷ hoá đơn chưa trả, quản trị xác nhận thanh toán', async (t) => {
  const repo = LocalRepository.getInstance();

  async function makeInvoice(id: string, studentId = 'ST001', amount = 1000000) {
    const fresh = {
      id,
      studentId,
      classId: 'CLS01',
      sessionCount: 8,
      title: 'Học phí kiểm thử luồng thu tiền',
      amount,
      paidAmount: 0,
      remainingAmount: amount,
      dueDate: '2026-12-31',
      status: 'Còn nợ' as const,
    };
    const existing = await repo.getTuitionInvoiceById(id);
    if (existing) {
      await repo.updateTuitionInvoice({ ...existing, ...fresh });
      return;
    }
    await repo.createTuitionInvoice(fresh);
  }

  const post = async (body: Record<string, unknown>, user = studentUser) => {
    const res = await postFinance(
      authed(
        'http://localhost/api/finance',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        user,
      ),
    );
    return { status: res.status, data: await res.json() };
  };

  const del = async (invoiceId: string, user = studentUser) => {
    const res = await deleteFinance(
      authed(`http://localhost/api/finance?invoiceId=${invoiceId}`, { method: 'DELETE' }, user),
    );
    return { status: res.status, data: await res.json() };
  };

  await t.test('1. Học viên tự huỷ hoá đơn chưa thanh toán của mình', async () => {
    await makeInvoice('TUI_REPORT_002');
    const { status, data } = await del('TUI_REPORT_002');
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.invoice.status, 'Đã hủy');
    assert.equal(data.invoice.remainingAmount, 0);
  });

  await t.test('2. Học viên không huỷ được hoá đơn của người khác', async () => {
    await makeInvoice('TUI_REPORT_003', 'ST002');
    const { status, data } = await del('TUI_REPORT_003');
    assert.equal(status, 403);
    assert.match(String(data.error), /quyền/);

    const invoice = await repo.getTuitionInvoiceById('TUI_REPORT_003');
    assert.equal(invoice?.status, 'Còn nợ');
  });

  await t.test('3. Hoá đơn đã thu tiền hoặc đã huỷ thì không huỷ lại được', async () => {
    await makeInvoice('TUI_REPORT_004');
    const paid = await repo.getTuitionInvoiceById('TUI_REPORT_004');
    paid!.paidAmount = 200000;
    paid!.remainingAmount = 800000;
    await repo.updateTuitionInvoice(paid!);
    const paidRes = await del('TUI_REPORT_004');
    assert.equal(paidRes.status, 400);
    assert.match(String(paidRes.data.error), /đã thanh toán/);

    await makeInvoice('TUI_REPORT_005');
    await del('TUI_REPORT_005');
    const again = await del('TUI_REPORT_005');
    assert.equal(again.status, 400);
    assert.match(String(again.data.error), /đã được hủy trước đó/);
  });
  await t.test('4. Học viên và giáo viên không được ghi sổ thu tiền', async () => {
    await makeInvoice('TUI_REPORT_005');
    const asStudent = await post({
      action: 'UPDATE_STATUS',
      invoiceId: 'TUI_REPORT_005',
      status: 'Đã nộp',
    });
    assert.equal(asStudent.status, 403);

    const asTeacher = await post(
      {
        action: 'UPDATE_STATUS',
        invoiceId: 'TUI_REPORT_005',
        status: 'Đã nộp',
      },
      teacherUser,
    );
    assert.equal(asTeacher.status, 403);

    const stillUnpaid = await repo.getTuitionInvoiceById('TUI_REPORT_005');
    assert.equal(stillUnpaid?.status, 'Còn nợ');
  });

  await t.test('5. Quản trị xác nhận thu một phần: giữ trạng thái Còn nợ và trừ đúng số còn lại', async () => {
    await makeInvoice('TUI_REPORT_006', 'ST001', 1000000);
    const { status, data } = await post(
      {
        action: 'UPDATE_STATUS',
        invoiceId: 'TUI_REPORT_006',
        status: 'Đã nộp',
        paidAmount: 400000,
        paymentMethod: 'Chuyển khoản QR',
      },
      adminUser,
    );
    assert.equal(status, 200);
    assert.equal(data.invoice.status, 'Còn nợ');
    assert.equal(data.invoice.paidAmount, 400000);
    assert.equal(data.invoice.remainingAmount, 600000);
  });

  await t.test('6. Quản trị thu nốt phần còn lại thì hoá đơn chuyển sang Đã nộp', async () => {
    const { status, data } = await post(
      {
        action: 'UPDATE_STATUS',
        invoiceId: 'TUI_REPORT_006',
        status: 'Đã nộp',
        paidAmount: 600000,
        paymentMethod: 'Tiền mặt',
      },
      adminUser,
    );
    assert.equal(status, 200);
    assert.equal(data.invoice.status, 'Đã nộp');
    assert.equal(data.invoice.remainingAmount, 0);
    assert.equal(data.invoice.paidAmount, 1000000);
  });

  await t.test('7. Phương thức thu ngoài danh sách cho phép bị từ chối (khớp check constraint DB)', async () => {
    await makeInvoice('TUI_REPORT_008');
    const { status, data } = await post(
      {
        action: 'UPDATE_STATUS',
        invoiceId: 'TUI_REPORT_008',
        status: 'Đã nộp',
        paymentMethod: 'Chuyển khoản VietQR',
      },
      adminUser,
    );
    assert.equal(status, 400);
    assert.match(String(data.error), /Phương thức thu không hợp lệ/);

    const invoice = await repo.getTuitionInvoiceById('TUI_REPORT_008');
    assert.equal(invoice?.status, 'Còn nợ');
  });
});
