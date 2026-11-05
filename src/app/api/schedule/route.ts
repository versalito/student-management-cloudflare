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

    // Bảng slots là bảng lớn nên lọc ngay ở tầng dữ liệu; classes/sections/teachers
    // chỉ vài chục dòng nên đọc full để bổ sung dữ liệu hiển thị.
    const [rawSlots, allClasses, allSections, allTeachers] = await Promise.all([
      repo.getScheduleSlotsQuery(query),
      repo.getAllClasses(),
      repo.getAllClassSections(),
      repo.getAllTeachers(),
    ]);

    const classMap = new Map(allClasses.map(cls => [cls.id, cls]));
    // Giờ thật phải theo ca (class_sections). Slot cũ có thể lưu giờ lệch, nên
    // ưu tiên giờ của ca để nút điểm danh / đổi ca tính đúng trạng thái.
    const sectionTimeMap = new Map(
      allSections.filter((s) => s.isActive !== false).map((s) => [s.id, s])
    );
    const teacherMap = new Map(allTeachers.map((t) => [t.id, t]));

    // Lọc bỏ triệt để các slot mồ côi nếu lớp học đã bị xóa khỏi hệ thống.
    const enriched = rawSlots
      .filter(slot => classMap.has(slot.classId))
      .map(slot => {
        const cls = classMap.get(slot.classId);
        const sec = slot.sectionId ? sectionTimeMap.get(slot.sectionId) : undefined;
        const teacher = teacherMap.get(slot.teacherId);
        return {
          ...slot,
          startTime: (sec && sec.startTime) || slot.startTime || cls?.startTime || '18:30',
          endTime: (sec && sec.endTime) || slot.endTime || cls?.endTime || '20:30',
          subject: slot.subject || cls?.subject || cls?.name || '',
          meetingLink: slot.meetingLink || cls?.meetingLink || '',
          teacherName: teacher?.name || '',
        };
      });

    return NextResponse.json({ slots: enriched });
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
