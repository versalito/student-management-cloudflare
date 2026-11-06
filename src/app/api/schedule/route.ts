import { repo } from '@/repositories';
import { NextResponse } from 'next/server';
import { ConflictEngine } from '@/services/ConflictEngine';
import { loadScheduleView } from '@/services/ScheduleViewService';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);

  try {
    const view = await loadScheduleView({
      date: searchParams.get('date') || undefined,
      dateFrom: searchParams.get('from') || undefined,
      dateTo: searchParams.get('to') || undefined,
      classId: searchParams.get('classId') || undefined,
      teacherId: searchParams.get('teacherId') || undefined,
      studentId: searchParams.get('studentId') || undefined,
    });

    return NextResponse.json({ slots: view.slots });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi khi tải lịch học';
    return NextResponse.json({ slots: [], error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const conflictEngine = new ConflictEngine(repo);
    // Xung đột chỉ xảy ra trong cùng ngày, nên nạp trước các ca của đúng ngày đó
    // thay vì để engine đọc toàn bảng lịch.
    const sameDaySlots = body.date
      ? (await repo.getScheduleSlotsQuery({ date: body.date, excludeCancelled: true }))
        .map(({ className: _className, ...slot }) => slot)
      : undefined;
    const conflictResult = await conflictEngine.checkScheduleConflict(body, body.id, sameDaySlots);

    if (conflictResult.hasConflict) {
      return NextResponse.json({ 
        success: false, 
        error: conflictResult.message,
        conflicts: conflictResult.conflicts 
      }, { status: 400 });
    }

    let saved;
    if (body.id) {
      saved = await repo.updateScheduleSlot(body);
      await repo.addAuditLog({
        action: 'UPDATE',
        userId: auth.user.id,
        userName: auth.user.name,
        userRole: auth.user.role,
        targetResource: 'SCHEDULE',
        targetId: body.id,
        details: `Cập nhật nhanh ca học ${body.id} - Lớp ${body.classId} (${body.date} Ca ${body.shiftId})`,
      });
    } else {
      const maxScheduleNumber = await repo.getMaxScheduleSlotNumber();
      const newId = `SCH${(maxScheduleNumber + 1).toString().padStart(4, '0')}`;
      saved = await repo.createScheduleSlot({ ...body, id: newId });
      await repo.addAuditLog({
        action: 'CREATE',
        userId: auth.user.id,
        userName: auth.user.name,
        userRole: auth.user.role,
        targetResource: 'SCHEDULE',
        targetId: newId,
        details: `Tạo mới ca học ${newId} - Lớp ${body.classId} (${body.date} Ca ${body.shiftId})`,
      });
    }

    return NextResponse.json({ success: true, slot: saved });
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
      return NextResponse.json({ error: 'Thiếu mã ca học cần xoá' }, { status: 400 });
    }

    const slot = await repo.getScheduleSlotById(id);
    if (!slot) {
      return NextResponse.json({ error: 'Không tìm thấy ca học' }, { status: 404 });
    }

    slot.status = 'Đã hủy';
    await repo.updateScheduleSlot(slot);

    await repo.addAuditLog({
      action: 'DELETE',
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
      targetResource: 'SCHEDULE',
      targetId: id,
      details: `Hủy ca học ${id} của lớp ${slot.classId} ngày ${slot.date}`,
    });

    return NextResponse.json({ success: true, message: `Đã hủy ca học ${id}` });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Lỗi khi hủy ca học' }, { status: 500 });
  }
}
