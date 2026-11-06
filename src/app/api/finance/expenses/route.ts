import { NextResponse } from 'next/server';
import { LedgerService } from '@/services/LedgerService';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || new Date().toISOString().substring(0, 7);
    const expenses = await LedgerService.getExpensesByMonth(month);
    return NextResponse.json({ success: true, expenses });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { title, amount, category, expenseDate, note } = body;

    if (!title || !amount) {
      return NextResponse.json({ success: false, error: 'Vui lòng điền đủ tên khoản chi và số tiền' }, { status: 400 });
    }

    const expense = await LedgerService.addExpense({
      title,
      amount: Number(amount),
      category,
      expenseDate,
      note,
    }, { id: auth.user.id, name: auth.user.name, role: auth.user.role });

    return NextResponse.json({ success: true, expense, message: 'Thêm khoản chi thành công' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu mã khoản chi' }, { status: 400 });
    }

    const ok = await LedgerService.deleteExpense(id, {
      id: auth.user.id,
      name: auth.user.name,
      role: auth.user.role,
    });
    return NextResponse.json({ success: ok, message: ok ? 'Xóa khoản chi thành công' : 'Không tìm thấy khoản chi' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
