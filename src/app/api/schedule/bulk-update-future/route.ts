import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { ShiftService } from '@/services/ShiftService';
import { ConflictEngine } from '@/services/ConflictEngine';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const {
      classId,
      fromDate,
      targetShiftId,
      targetTeacherId,
      targetMeetingLink,
    } = body;

    if (!classId || !fromDate) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng cung cấp classId và fromDate' },
        { status: 400 }
      );
    }

    let targetShift = null;
    if (targetShiftId !== undefined && targetShiftId !== null) {
      targetShift = await ShiftService.getShiftById(Number(targetShiftId));
      if (!targetShift) {
        return NextResponse.json(
          { success: false, error: `Không tìm thấy ca học với id ${targetShiftId}` },
          { status: 400 }
        );
      }
    }

    const allSlots = await repo.getAllScheduleSlots();
    const targetSlots = allSlots.filter(
      s => s.classId === classId && s.date >= fromDate && s.status !== 'Đã hủy'
    );

    if (targetSlots.length === 0) {
      return NextResponse.json({
        success: true,
        updatedCount: 0,
        message: 'Không tìm thấy ca học nào phù hợp để cập nhật',
        updatedSlots: [],
      });
    }

    const conflictEngine = new ConflictEngine(repo);
    const updatedSlots = [];
    const conflictErrors = [];

    for (const slot of targetSlots) {
      const updatedSlot = {
        ...slot,
        shiftId: targetShift ? targetShift.id : slot.shiftId,
        startTime: targetShift ? targetShift.startTime : slot.startTime,
        endTime: targetShift ? targetShift.endTime : slot.endTime,
        teacherId: targetTeacherId !== undefined && targetTeacherId !== '' ? targetTeacherId : slot.teacherId,
        meetingLink: targetMeetingLink !== undefined && targetMeetingLink !== '' ? targetMeetingLink : slot.meetingLink,
      };

      // Kiểm tra xung đột lịch học trước khi cập nhật
      const conflictCheck = await conflictEngine.checkScheduleConflict(updatedSlot, slot.id);
      if (conflictCheck.hasConflict) {
        conflictErrors.push({
          slotId: slot.id,
          date: slot.date,
          error: conflictCheck.message,
        });
        continue;
      }

      const saved = await repo.updateScheduleSlot(updatedSlot);
      updatedSlots.push(saved);
    }

    // Ghi AuditLog
    await repo.addAuditLog({
      action: 'SCHEDULE_CHANGE',
      userId: actorId,
      userName: auth.user.name,
      userRole: 'ADMIN',
      targetResource: 'SCHEDULE',
      targetId: classId,
      details: `Thay đổi lịch từ ngày ${fromDate} về sau cho lớp ${classId}: đã cập nhật ${updatedSlots.length}/${targetSlots.length} ca.${targetShift ? ` Ca mới: ${targetShift.name}.` : ''}${targetTeacherId ? ` GV mới: ${targetTeacherId}.` : ''}`,
    });

    return NextResponse.json({
      success: true,
      updatedCount: updatedSlots.length,
      totalMatched: targetSlots.length,
      conflicts: conflictErrors,
      message: `Đã cập nhật thành công ${updatedSlots.length}/${targetSlots.length} ca học từ ngày ${fromDate}`,
      updatedSlots,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi xử lý thay đổi lịch từ nay về sau' },
      { status: 500 }
    );
  }
}
