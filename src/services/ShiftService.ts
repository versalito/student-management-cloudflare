import { TimeShift, TIME_SHIFTS } from '../types/schedule';
import { repo } from '../repositories';
import { getTodayDateStr } from '../utils/date';

export interface ShiftActor {
  id: string;
  name: string;
  role: string;
}

const SYSTEM_ACTOR: ShiftActor = { id: 'SYSTEM', name: 'Hệ thống', role: 'SYSTEM' };

export class ShiftService {
  public static async getAllShifts(): Promise<TimeShift[]> {
    return repo.getAllTimeShifts();
  }

  public static async getShiftById(id: number): Promise<TimeShift | null> {
    return repo.getTimeShiftById(id);
  }

  public static async updateShift(
    id: number,
    data: { shiftId?: number; startTime?: string; endTime?: string; name?: string; isActive?: boolean },
    syncFutureSlots: boolean = false,
    actor: ShiftActor = SYSTEM_ACTOR
  ): Promise<TimeShift | null> {
    const targetId = data.shiftId !== undefined ? Number(data.shiftId) : id;
    const old = await repo.getTimeShiftById(targetId);
    if (!old) return null;

    const updated: TimeShift = {
      ...old,
      name: data.name !== undefined ? data.name : old.name,
      startTime: data.startTime !== undefined ? data.startTime : old.startTime,
      endTime: data.endTime !== undefined ? data.endTime : old.endTime,
      isActive: data.isActive !== undefined ? data.isActive : old.isActive ?? true,
      durationHours: (data.startTime || data.endTime) 
        ? this.calcDuration(data.startTime || old.startTime, data.endTime || old.endTime)
        : old.durationHours
    };

    await repo.updateTimeShift(updated);

    let syncedSlotsCount = 0;
    if (syncFutureSlots) {
      const today = getTodayDateStr();
      const allSlots = await repo.getAllScheduleSlots();
      for (const slot of allSlots) {
        if (slot.shiftId === updated.id && slot.date >= today && slot.status !== 'Đã hủy') {
          if (slot.startTime !== updated.startTime || slot.endTime !== updated.endTime) {
            slot.startTime = updated.startTime;
            slot.endTime = updated.endTime;
            await repo.updateScheduleSlot(slot);
            syncedSlotsCount++;
          }
        }
      }
    }

    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      targetResource: 'SCHEDULE',
      targetId: 'SHIFT_' + updated.id,
      details: 'Cập nhật khung giờ ' + updated.name + ': ' + updated.startTime + ' - ' + updated.endTime + (syncFutureSlots ? ` (Đồng bộ ${syncedSlotsCount} ca học tương lai)` : ''),
    });

    return updated;
  }

  /**
   * Thay đổi cấu hình khung giờ ca học hàng loạt và tùy chọn tự động đồng bộ ca học tương lai
   */
  public static async bulkUpdateShifts(
    shifts: TimeShift[],
    syncFutureSlots: boolean = true,
    actor: ShiftActor = SYSTEM_ACTOR
  ): Promise<{ shifts: TimeShift[]; syncedSlotsCount: number }> {
    const current = await repo.getAllTimeShifts();
    const currentMap = new Map(current.map(s => [s.id, s]));
    const updatedShifts: TimeShift[] = [];

    for (const s of shifts) {
      const duration = (s.startTime && s.endTime)
        ? this.calcDuration(s.startTime, s.endTime)
        : (s.durationHours || 2.0);
      const shiftObj: TimeShift = {
        ...s,
        id: Number(s.id),
        name: s.name || `Ca ${s.id}`,
        startTime: s.startTime,
        endTime: s.endTime,
        durationHours: duration,
        isActive: s.isActive !== undefined ? s.isActive : true,
      };

      if (currentMap.has(shiftObj.id)) {
        await repo.updateTimeShift(shiftObj);
      } else {
        await repo.createTimeShift(shiftObj);
      }
      updatedShifts.push(shiftObj);
    }

    let syncedSlotsCount = 0;
    if (syncFutureSlots) {
      const today = getTodayDateStr();
      const allSlots = await repo.getAllScheduleSlots();
      const shiftMap = new Map<number, TimeShift>(updatedShifts.map(s => [s.id, s]));

      for (const slot of allSlots) {
        if (slot.date >= today && slot.status !== 'Đã hủy') {
          const shift = shiftMap.get(slot.shiftId);
          if (shift && (slot.startTime !== shift.startTime || slot.endTime !== shift.endTime)) {
            slot.startTime = shift.startTime;
            slot.endTime = shift.endTime;
            await repo.updateScheduleSlot(slot);
            syncedSlotsCount++;
          }
        }
      }
    }

    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      targetResource: 'SCHEDULE',
      targetId: 'BULK_SHIFTS',
      details: `Cập nhật cấu hình ca học hàng loạt (${updatedShifts.length} ca)${syncFutureSlots ? `. Đã đồng bộ ${syncedSlotsCount} ca học tương lai từ ngày ${getTodayDateStr()}` : ''}`,
    });

    return {
      shifts: updatedShifts,
      syncedSlotsCount,
    };
  }

  public static async createShift(data: {
    shiftNumber?: number;
    name?: string;
    startTime: string;
    endTime: string;
    isActive?: boolean;
  }, actor: ShiftActor = SYSTEM_ACTOR): Promise<TimeShift> {
    const all = await repo.getAllTimeShifts();
    let nextId: number;
    if (data.shiftNumber !== undefined && Number(data.shiftNumber) > 0) {
      nextId = Number(data.shiftNumber);
    } else {
      nextId = all.reduce((max, s) => Math.max(max, s.id), 0) + 1;
    }

    const newShift: TimeShift = {
      id: nextId,
      name: data.name || ('Ca ' + nextId),
      startTime: data.startTime,
      endTime: data.endTime,
      durationHours: this.calcDuration(data.startTime, data.endTime),
      isActive: data.isActive !== undefined ? data.isActive : true,
    };

    await repo.createTimeShift(newShift);

    await repo.addAuditLog({
      action: 'CREATE',
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      targetResource: 'SCHEDULE',
      targetId: 'SHIFT_' + nextId,
      details: 'Tạo ca học mới ' + newShift.name + ' (' + newShift.startTime + ' - ' + newShift.endTime + ')',
    });

    return newShift;
  }

  public static async deleteShift(id: number, actor: ShiftActor = SYSTEM_ACTOR): Promise<boolean> {
    const old = await repo.getTimeShiftById(id);
    if (!old) return false;

    const ok = await repo.deleteTimeShift(id);
    if (ok) {
      await repo.addAuditLog({
        action: 'DELETE',
        userId: actor.id,
        userName: actor.name,
        userRole: actor.role,
        targetResource: 'SCHEDULE',
        targetId: 'SHIFT_' + id,
        details: 'Xóa ca học ' + old.name,
      });
    }
    return ok;
  }

  /**
   * Áp dụng Presets cấu hình nhanh số ca
   */
  public static async applyPreset(
    presetType: '3_SHIFTS' | '2_SHIFTS' | '5_SHIFTS',
    actor: ShiftActor = SYSTEM_ACTOR
  ): Promise<TimeShift[]> {
    const current = await repo.getAllTimeShifts();
    for (const s of current) {
      await repo.deleteTimeShift(s.id);
    }

    let presetShifts: TimeShift[] = [];
    if (presetType === '3_SHIFTS') {
      presetShifts = [
        { id: 1, name: 'Ca Sáng', startTime: '08:00', endTime: '11:00', durationHours: 3.0, isActive: true },
        { id: 2, name: 'Ca Chiều', startTime: '14:00', endTime: '17:00', durationHours: 3.0, isActive: true },
        { id: 3, name: 'Ca Tối', startTime: '18:30', endTime: '21:30', durationHours: 3.0, isActive: true },
      ];
    } else if (presetType === '2_SHIFTS') {
      presetShifts = [
        { id: 1, name: 'Ca Sáng', startTime: '08:30', endTime: '11:30', durationHours: 3.0, isActive: true },
        { id: 2, name: 'Ca Tối', startTime: '18:30', endTime: '21:30', durationHours: 3.0, isActive: true },
      ];
    } else {
      presetShifts = [...TIME_SHIFTS].map(s => ({ ...s, isActive: true }));
    }

    for (const s of presetShifts) {
      await repo.createTimeShift(s);
    }

    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      targetResource: 'SCHEDULE',
      targetId: 'PRESET_' + presetType,
      details: 'Áp dụng mẫu cấu hình khung giờ: ' + presetType + ' (' + presetShifts.length + ' ca/ngày)',
    });

    return presetShifts;
  }

  private static calcDuration(start: string, end: string): number {
    try {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      return Math.max(0.5, Math.round(((endMin - startMin) / 60) * 10) / 10);
    } catch {
      return 2.0;
    }
  }

  public static async resetDefaults(): Promise<void> {
    await this.applyPreset('5_SHIFTS');
  }
}
