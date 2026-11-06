import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { BookingService } from '@/services/BookingService';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';
import { getTodayDateStr } from '@/utils/date';

export const dynamic = 'force-dynamic';

/** Cửa sổ mặc định khi giao diện không truyền `from`/`to`: hôm nay + 14 ngày. */
function defaultRange(from?: string | null, to?: string | null) {
  const start = from || getTodayDateStr();
  if (to) return { from: start, to };
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 14);
  return { from: start, to: end.toISOString().slice(0, 10) };
}

/**
 * `GET /api/student/bookings?studentId=&from=&to=`
 * Trả buổi lẻ học sinh đã đặt kèm dữ liệu hiển thị và cờ `cancellable`.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId') || auth.user.id;
  if (!isSelfOrStaff(auth.user, studentId)) {
    return NextResponse.json({ error: 'Không có quyền xem buổi lẻ của học viên khác' }, { status: 403 });
  }

  const { from, to } = defaultRange(searchParams.get('from'), searchParams.get('to'));

  try {
    const service = new BookingService(repo);
    const [bookings, student] = await Promise.all([
      service.listMyBookings(studentId, { from, to }),
      repo.getStudentById(studentId),
    ]);
    return NextResponse.json({ studentId, studentName: student?.name, from, to, bookings });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi khi tải buổi lẻ đã đặt';
    return NextResponse.json({ bookings: [], error: message }, { status: 500 });
  }
}

/**
 * `POST /api/student/bookings` body `{ studentId?, slotId }`
 * Học viên chỉ đặt cho chính mình; quản trị đặt hộ được.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'STUDENT']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const studentId = body.studentId || auth.user.id;
    const slotId = body.slotId;

    if (!isSelfOrStaff(auth.user, studentId)) {
      return NextResponse.json({ error: 'Không có quyền đặt buổi cho học viên khác' }, { status: 403 });
    }
    if (!slotId) {
      return NextResponse.json({ error: 'Thiếu mã buổi học (slotId)' }, { status: 400 });
    }
    if (!(await repo.getStudentById(studentId))) {
      return NextResponse.json({ error: 'Không tìm thấy học viên' }, { status: 404 });
    }

    const service = new BookingService(repo);
    const { booking, alreadyBooked } = await service.book(studentId, slotId);

    if (!alreadyBooked) {
      const slot = await repo.getScheduleSlotById(slotId);
      await repo.addAuditLog({
        action: 'SESSION_BOOKED',
        userId: auth.user.id,
        userName: auth.user.name,
        userRole: auth.user.role,
        targetResource: 'SCHEDULE',
        targetId: slotId,
        details: `Đăng ký buổi lẻ ${slotId}${slot ? ` ngày ${slot.date}` : ''} cho học viên ${studentId}`,
      });
    }

    return NextResponse.json({ success: true, booking, alreadyBooked }, { status: alreadyBooked ? 200 : 201 });
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      const coded = err as Error & { code: string; status?: number };
      return NextResponse.json({ error: err.message, code: coded.code }, { status: coded.status ?? 400 });
    }
    const message = err instanceof Error ? err.message : 'Lỗi khi đăng ký buổi';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * `DELETE /api/student/bookings?slotId=&studentId=` — huỷ trước giờ bắt đầu.
 */
export async function DELETE(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId') || auth.user.id;
  const slotId = searchParams.get('slotId');

  if (!isSelfOrStaff(auth.user, studentId)) {
    return NextResponse.json({ error: 'Không có quyền huỷ buổi của học viên khác' }, { status: 403 });
  }
  if (!slotId) {
    return NextResponse.json({ error: 'Thiếu mã buổi học (slotId)' }, { status: 400 });
  }

  try {
    const service = new BookingService(repo);
    const booking = await service.cancel(studentId, slotId);
    await repo.addAuditLog({
      action: 'SESSION_BOOKING_CANCELLED',
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
      targetResource: 'SCHEDULE',
      targetId: slotId,
      details: `Huỷ đăng ký buổi lẻ ${slotId} của học viên ${studentId}`,
    });
    return NextResponse.json({ success: true, booking });
  } catch (err) {
    if (err instanceof Error && 'code' in err) {
      const coded = err as Error & { code: string; status?: number };
      return NextResponse.json({ error: err.message, code: coded.code }, { status: coded.status ?? 400 });
    }
    const message = err instanceof Error ? err.message : 'Lỗi khi huỷ buổi';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
