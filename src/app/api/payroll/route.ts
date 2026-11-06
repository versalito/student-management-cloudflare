import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { TuitionPayrollService } from '@/services/TuitionPayrollService';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Tháng hiện tại theo giờ Việt Nam, dạng YYYY-MM. */
function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' })
    .format(new Date())
    .slice(0, 7);
}

/**
 * GET /api/payroll?teacherId=GV001&month=2026-10
 * Trả về bảng lương tháng của giáo viên (tính từ số ca dạy đã hoàn thành).
 * Không truyền teacherId thì trả toàn bộ bảng lương của tháng.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const teacherId = searchParams.get('teacherId');
    const month = searchParams.get('month') || currentMonth();

    // Giáo viên chỉ xem bảng lương của chính mình; xem toàn bộ là quyền quản trị.
    if (auth.user.role === 'TEACHER') {
      if (!isSelfOrStaff(auth.user, teacherId)) {
        return NextResponse.json({ success: false, error: 'Không có quyền xem bảng lương của giáo viên khác' }, { status: 403 });
      }
    }

    const service = new TuitionPayrollService(repo);

    if (teacherId) {
      const payroll = await service.calculateTeacherPayroll(teacherId, month);
      return NextResponse.json({ success: true, payroll, month });
    }

    const payrolls = await repo.getAllPayrollRecords(month);
    return NextResponse.json({ success: true, payrolls, month });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi tải bảng lương' },
      { status: 500 }
    );
  }
}
