import { NextResponse } from 'next/server';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';
import { buildStudentSessionState } from '@/services/StudentSessionService';
import { teacherTeachesStudent } from '@/lib/auth/studentScope';

export const dynamic = 'force-dynamic';

/**
 * Trạng thái buổi học của một học sinh, tính hoàn toàn phía server:
 * ca đang diễn ra, ca kế tiếp, và ca đã điểm danh hôm nay.
 *
 * Client (dashboard, thời khoá biểu) chỉ hiển thị `canCheckIn` + `reason`
 * từ đây, không tự so đồng hồ máy để bật/tắt nút điểm danh.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');

  if (!studentId) {
    return NextResponse.json({ error: 'Thiếu tham số studentId' }, { status: 400 });
  }
  if (auth.user.role === 'TEACHER') {
    if (!(await teacherTeachesStudent(auth.user.id, studentId))) {
      return NextResponse.json({ error: 'Học viên này không thuộc lớp bạn phụ trách' }, { status: 403 });
    }
  } else if (!isSelfOrStaff(auth.user, studentId)) {
    return NextResponse.json({ error: 'Không có quyền xem buổi học của học viên khác' }, { status: 403 });
  }

  try {
    return NextResponse.json(await buildStudentSessionState(studentId));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
