import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { StudentSlotSwap } from '@/types/schedule';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Đổi ca nhanh trong ngày: học sinh tạm chuyển sang một buổi khác cùng lớp cùng ngày.
 * Chỉ ảnh hưởng tới buổi học cụ thể (fromSlotId -> toSlotId), không đổi ca dài hạn.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','STUDENT']);
  if (auth.response) return auth.response;

  const requestedStudentId = new URL(request.url).searchParams.get('studentId');
  if (!isSelfOrStaff(auth.user, requestedStudentId)) {
    return NextResponse.json({ success: false, error: 'Không có quyền xem đổi ca của học viên khác' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const date = searchParams.get('date');
  const toSlotId = searchParams.get('toSlotId');

  const swaps = await repo.getSlotSwaps({
    studentId: studentId || undefined,
    date: date || undefined,
    toSlotId: toSlotId || undefined,
    status: 'ACTIVE',
  });

  return NextResponse.json({ swaps });
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN','STUDENT']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { studentId, fromSlotId, toSlotId, date } = body;

    if (!isSelfOrStaff(auth.user, studentId)) {
      return NextResponse.json(
        { success: false, error: 'Không có quyền đổi ca cho học viên khác' },
        { status: 403 }
      );
    }

    if (!studentId || !fromSlotId || !toSlotId || !date) {
      return NextResponse.json(
        { success: false, error: 'Thiếu thông tin studentId, fromSlotId, toSlotId hoặc date' },
        { status: 400 }
      );
    }

    if (fromSlotId === toSlotId) {
      return NextResponse.json(
        { success: false, error: 'Ca đích phải khác ca hiện tại.' },
        { status: 400 }
      );
    }

    const fromSlot = await repo.getScheduleSlotById(fromSlotId);
    const toSlot = await repo.getScheduleSlotById(toSlotId);
    if (!fromSlot || !toSlot) {
      return NextResponse.json(
        { success: false, error: 'Ca học không tồn tại.' },
        { status: 404 }
      );
    }

    if (fromSlot.classId !== toSlot.classId) {
      return NextResponse.json(
        { success: false, error: 'Chỉ được đổi ca trong cùng một lớp học.' },
        { status: 400 }
      );
    }

    if (fromSlot.date !== toSlot.date || toSlot.date !== date) {
      return NextResponse.json(
        { success: false, error: 'Chỉ được đổi ca trong cùng một ngày học.' },
        { status: 400 }
      );
    }

    // Học sinh phải đang thuộc ca xuất phát.
    if (fromSlot.sectionId) {
      const section = await repo.getSectionById(fromSlot.sectionId);
      if (section && !(section.studentIds || []).includes(studentId)) {
        return NextResponse.json(
          { success: false, error: 'Học sinh không thuộc ca xuất phát.' },
          { status: 403 }
        );
      }
    }

    // Kiểm tra đã có lần đổi ca còn hiệu lực cho ca xuất phát chưa.
    const existing = await repo.getSlotSwaps({
      studentId,
      fromSlotId,
      date,
      status: 'ACTIVE',
    });
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Bạn đã gửi một yêu cầu đổi ca cho buổi học này rồi.' },
        { status: 409 }
      );
    }

    const swap: StudentSlotSwap = {
      id: `SWAP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      studentId,
      fromSlotId,
      toSlotId,
      date,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    const saved = await repo.createSlotSwap(swap);

    await repo.addAuditLog({
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
      action: 'SCHEDULE_CHANGE',
      targetResource: 'SCHEDULE',
      targetId: saved.id,
      details: `Đổi ca nhanh ngày ${date}: ${fromSlotId} -> ${toSlotId}`, 
    });

    return NextResponse.json({ success: true, swap: saved });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
