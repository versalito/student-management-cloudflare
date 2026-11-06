import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Các loại thao tác được đếm cho tab lọc + thẻ thống kê ở trang Nhật ký. */
const COUNTED_ACTIONS = [
  'ATTENDANCE_CHECK',
  'SCHEDULE_CHANGE',
  'PAYMENT_PROCESS',
  'REQUEST_DECIDE',
  'SESSION_BOOKED',
  'SESSION_BOOKING_CANCELLED',
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
];

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);

    // ?stats=1: chỉ trả số lượng theo từng loại thao tác (HEAD + count, không kéo dữ liệu).
    if (searchParams.get('stats') === '1') {
      const counts = await repo.getAuditActionCounts(COUNTED_ACTIONS);
      return NextResponse.json({ counts });
    }

    const search = searchParams.get('search') || undefined;
    const action = searchParams.get('action') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));

    const { logs, total } = await repo.getAuditLogsPage({
      search,
      action,
      limit,
      offset: (page - 1) * limit,
    });

    return NextResponse.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải nhật ký';
    return NextResponse.json({ logs: [], total: 0, error: message }, { status: 500 });
  }
}
