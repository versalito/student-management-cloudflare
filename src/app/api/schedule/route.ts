import { repo } from '@/repositories';
import type { ScheduleSlotQuery } from '@/repositories/IRepository';
import { NextResponse } from 'next/server';
import { ConflictEngine } from '@/services/ConflictEngine';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get('teacherId');
  const studentId = searchParams.get('studentId');
  const classId = searchParams.get('classId');
  const date = searchParams.get('date');

  try {
    const query: ScheduleSlotQuery = {
      date: date || undefined,
      classId: classId || undefined,
      teacherId: teacherId || undefined,
    };

    // Học viên: chỉ đọc join table ghi danh (1 query nhỏ) rồi lọc slot theo lớp,
    // thay vì đọc toàn bộ classes + toàn bộ slots.
    if (studentId) {
      const memberships = await repo.getClassMemberships({ studentId });
      const classIds = Array.from(new Set(memberships.map(m => m.classId)));
      if (classIds.length === 0) return NextResponse.json({ slots: [] });
      query.classIds = classIds;
    }

    const slots = await repo.getScheduleSlotsQuery(query);
    return NextResponse.json({ slots });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi khi tải lịch học';
    return NextResponse.json({ slots: [], error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const conflictEngine = new ConflictEngine(repo);
    const conflictResult = await conflictEngine.checkScheduleConflict(body, body.id);

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
        userId: 'ADMIN001',
        userName: 'Quản trị viên',
        userRole: 'ADMIN',
        targetResource: 'SCHEDULE',
        targetId: body.id,
        details: `Cập nhật nhanh ca học ${body.id} - Lớp ${body.classId} (${body.date} Ca ${body.shiftId})`,
      });
    } else {
      const allSlots = await repo.getAllScheduleSlots();
      const maxScheduleNumber = allSlots.reduce((max, slot) => {
        const match = String(slot.id || '').match(/^SCH(\d+)$/i);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);
      const newId = `SCH${(maxScheduleNumber + 1).toString().padStart(4, '0')}`;
      saved = await repo.createScheduleSlot({ ...body, id: newId });
      await repo.addAuditLog({
        action: 'CREATE',
        userId: 'ADMIN001',
        userName: 'Quản trị viên',
        userRole: 'ADMIN',
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
      userId: 'ADMIN001',
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'SCHEDULE',
      targetId: id,
      details: `Hủy ca học ${id} của lớp ${slot.classId} ngày ${slot.date}`,
    });

    return NextResponse.json({ success: true, message: `Đã hủy ca học ${id}` });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Lỗi khi hủy ca học' }, { status: 500 });
  }
}
