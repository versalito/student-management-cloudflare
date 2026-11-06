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
 * `GET /api/student/slots?studentId=&from=&to=&subject=`
 *
 * Các buổi lẻ còn đăng ký được: lớp `Đang mở`, chưa bắt đầu, chưa có trong
 * thời khoá biểu của học sinh. Buổi trùng giờ vẫn trả về kèm `conflict` để
 * giao diện hiển thị lý do thay vì im lặng ẩn.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId') || auth.user.id;
  if (!isSelfOrStaff(auth.user, studentId)) {
    return NextResponse.json({ error: 'Không có quyền xem buổi của học viên khác' }, { status: 403 });
  }

  const { from, to } = defaultRange(searchParams.get('from'), searchParams.get('to'));
  const subject = searchParams.get('subject') || undefined;

  try {
    const service = new BookingService(repo);
    const [slots, student] = await Promise.all([
      service.listBookableSlots({ studentId, from, to, subject }),
      repo.getStudentById(studentId),
    ]);
    return NextResponse.json({ studentId, studentName: student?.name, from, to, slots });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi khi tải danh sách buổi';
    return NextResponse.json({ slots: [], error: message }, { status: 500 });
  }
}
