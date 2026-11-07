import { repo } from '@/repositories';
import type { AttendanceRecord } from '@/types/attendance';
import type { ScheduleSlot } from '@/types/schedule';
import { getNowTimeStr, getTodayDateStr, timeToMinutes } from '@/utils/date';
import { resolveScheduleSlotTimes } from '@/services/SlotTimeService';

/**
 * Chốt trạng thái buổi học dựa trên sổ điểm danh.
 *
 * Vì sao cần: `schedule_slots.status` là nguồn duy nhất để tính lương giáo viên
 * (`TuitionPayrollService` lọc `status === 'Đã hoàn thành'`) và để tính công nợ
 * (`LedgerService.isSessionPayable`). Trước đây trạng thái đó chỉ được ghi trong
 * luồng giáo viên bấm CHECKOUT ở `/api/teacher-checkin`. Trên production
 * 2026-11-07: 153 buổi đã qua, **0 buổi** ở trạng thái `Đã hoàn thành`, nên
 * `GET /api/payroll?month=2026-10` trả `grossSalary: 0` cho mọi giáo viên dù
 * điểm danh vẫn được ghi bình thường.
 *
 * Quy tắc chốt:
 * - Chỉ chốt buổi đã kết thúc (ngày < hôm nay, hoặc hôm nay nhưng đã qua giờ kết
 *   thúc). Buổi đang/ sắp diễn ra phải giữ `Đã lên lịch` để giáo viên còn check-in.
 * - Không đụng vào buổi `Đã hủy`/`Đổi lịch`/đã `Đã hoàn thành` (idempotent).
 * - Chốt theo sổ điểm danh: có ít nhất một bản ghi thật (không phải
 *   `Chưa điểm danh`) cho buổi đó.
 */
export async function settleSlotStatusesFromAttendance(
  records: Pick<AttendanceRecord, 'scheduleSlotId' | 'status'>[],
): Promise<ScheduleSlot[]> {
  const slotIds = Array.from(
    new Set(records.map((r) => r.scheduleSlotId).filter((id): id is string => Boolean(id))),
  );
  if (slotIds.length === 0) return [];

  const todayStr = getTodayDateStr();
  const nowMins = timeToMinutes(getNowTimeStr());
  const settled: ScheduleSlot[] = [];

  for (const slotId of slotIds) {
    const slot = await repo.getScheduleSlotById(slotId);
    if (!slot) continue;
    if (slot.status === 'Đã hoàn thành' || slot.status === 'Đã hủy' || slot.status === 'Đổi lịch') {
      continue;
    }

    const { endTime } = await resolveScheduleSlotTimes(slot);
    const endMins = timeToMinutes(endTime);
    const isOver = slot.date < todayStr || (slot.date === todayStr && nowMins >= endMins);
    if (!isOver) continue;

    const slotRecords = await repo.getAttendanceBySlotId(slotId);
    const hasRealRecord = slotRecords.some((r) => String(r.status) !== 'Chưa điểm danh');
    if (!hasRealRecord) continue;

    const updated = await repo.updateScheduleSlot({ ...slot, status: 'Đã hoàn thành' });
    settled.push(updated);
    await repo.addAuditLog({
      userId: 'SYSTEM',
      userName: 'Hệ thống',
      userRole: 'ADMIN',
      action: 'UPDATE',
      targetResource: 'SCHEDULE',
      targetId: slot.id,
      details: `Tự chốt buổi ${slot.id} (${slot.date}) sang "Đã hoàn thành" sau khi sổ điểm danh được ghi.`,
    });
  }

  return settled;
}
