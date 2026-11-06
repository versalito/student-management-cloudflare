import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { ShiftService } from '@/services/ShiftService';
import { ConflictEngine } from '@/services/ConflictEngine';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export type DailyActionType = 'RESCHEDULE_DAY' | 'SHIFT_MIGRATION' | 'CANCEL_DAY';

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const {
      currentDate,
      action,
      targetDate,
      fromShiftId,
      toShiftId,
      cancelStatus = 'Đã hủy', // 'Đã hủy' | 'Đổi lịch'
    } = body;

    if (!currentDate || !action) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng cung cấp currentDate và action' },
        { status: 400 }
      );
    }

    const allSlots = await repo.getAllScheduleSlots();
    const daySlots = allSlots.filter(s => s.date === currentDate && s.status !== 'Đã hủy');

    if (daySlots.length === 0) {
      return NextResponse.json({
        success: true,
        affectedCount: 0,
        message: `Không có ca học nào hoạt động trong ngày ${currentDate}`,
        updatedSlots: [],
      });
    }

    const conflictEngine = new ConflictEngine(repo);
    const updatedSlots = [];
    const conflicts = [];

    switch (action as DailyActionType) {
      case 'RESCHEDULE_DAY': {
        if (!targetDate) {
          return NextResponse.json(
            { success: false, error: 'Vui lòng cung cấp targetDate khi dời ngày' },
            { status: 400 }
          );
        }

        for (const slot of daySlots) {
          const candidateSlot = {
            ...slot,
            date: targetDate,
            status: 'Đã lên lịch' as const,
          };

          const check = await conflictEngine.checkScheduleConflict(candidateSlot, slot.id);
          if (check.hasConflict) {
            conflicts.push({
              slotId: slot.id,
              classId: slot.classId,
              shiftId: slot.shiftId,
              error: check.message,
            });
            continue;
          }

          const saved = await repo.updateScheduleSlot(candidateSlot);
          updatedSlots.push(saved);
        }

        await repo.addAuditLog({
          action: 'SCHEDULE_CHANGE',
          userId: actorId,
          userName: auth.user.name,
          userRole: 'ADMIN',
          targetResource: 'SCHEDULE',
          targetId: currentDate,
          details: `Dời toàn bộ ca học từ ngày ${currentDate} sang ngày ${targetDate}: thành công ${updatedSlots.length}/${daySlots.length} ca.${conflicts.length > 0 ? ` Có ${conflicts.length} ca xung đột.` : ''}`,
        });

        break;
      }

      case 'SHIFT_MIGRATION': {
        if (fromShiftId === undefined || toShiftId === undefined) {
          return NextResponse.json(
            { success: false, error: 'Vui lòng cung cấp fromShiftId và toShiftId' },
            { status: 400 }
          );
        }

        const targetShift = await ShiftService.getShiftById(Number(toShiftId));
        if (!targetShift) {
          return NextResponse.json(
            { success: false, error: `Không tìm thấy ca học đích với id ${toShiftId}` },
            { status: 400 }
          );
        }

        const matchingSlots = daySlots.filter(s => s.shiftId === Number(fromShiftId));
        for (const slot of matchingSlots) {
          const candidateSlot = {
            ...slot,
            shiftId: targetShift.id,
            startTime: targetShift.startTime,
            endTime: targetShift.endTime,
          };

          const check = await conflictEngine.checkScheduleConflict(candidateSlot, slot.id);
          if (check.hasConflict) {
            conflicts.push({
              slotId: slot.id,
              classId: slot.classId,
              shiftId: slot.shiftId,
              error: check.message,
            });
            continue;
          }

          const saved = await repo.updateScheduleSlot(candidateSlot);
          updatedSlots.push(saved);
        }

        await repo.addAuditLog({
          action: 'SCHEDULE_CHANGE',
          userId: actorId,
          userName: auth.user.name,
          userRole: 'ADMIN',
          targetResource: 'SCHEDULE',
          targetId: currentDate,
          details: `Chuyển ca học trong ngày ${currentDate} từ Ca ${fromShiftId} sang ${targetShift.name}: thành công ${updatedSlots.length}/${matchingSlots.length} ca.`,
        });

        break;
      }

      case 'CANCEL_DAY': {
        const finalStatus = cancelStatus === 'Đổi lịch' ? 'Đổi lịch' : 'Đã hủy';
        for (const slot of daySlots) {
          const candidateSlot = {
            ...slot,
            status: finalStatus as any,
          };

          const saved = await repo.updateScheduleSlot(candidateSlot);
          updatedSlots.push(saved);
        }

        await repo.addAuditLog({
          action: 'SCHEDULE_CHANGE',
          userId: actorId,
          userName: auth.user.name,
          userRole: 'ADMIN',
          targetResource: 'SCHEDULE',
          targetId: currentDate,
          details: `Đổi trạng thái toàn bộ ${updatedSlots.length} ca học ngày ${currentDate} sang "${finalStatus}".`,
        });

        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Hành động ${action} không hợp lệ` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      action,
      currentDate,
      affectedCount: updatedSlots.length,
      conflicts,
      message: `Thực hiện ${action} cho ngày ${currentDate} thành công (${updatedSlots.length} ca bị ảnh hưởng).`,
      updatedSlots,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi khi thực hiện thao tác theo ngày' },
      { status: 500 }
    );
  }
}
