import { IRepository } from '@/repositories/IRepository';
import { repo as defaultRepo } from '@/repositories';
import { ShiftService } from './ShiftService';
import { ConflictEngine } from './ConflictEngine';
import { ScheduleSlot, ScheduleConflict } from '@/types/schedule';
import { ClassEntity, ClassSection } from '@/types/classroom';

export interface BulkGenerateParams {
  classIds: string[]; // ['CLS01', ...] hoặc ['all']
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  shiftId?: number;
  startTime?: string;
  endTime?: string;
  scheduleDays?: number[];
  overwriteExisting?: boolean;
  actorId?: string;
  /** Chỉ tính toán và trả về kế hoạch, không ghi gì xuống cơ sở dữ liệu. */
  previewOnly?: boolean;
}

export interface BulkGenerateConflictItem {
  classId: string;
  date: string;
  shiftId: number;
  conflicts: ScheduleConflict[];
}

export interface BulkGenerateResult {
  summary: {
    totalAttempted: number;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    conflictCount: number;
  };
  createdSlots: ScheduleSlot[];
  conflicts: BulkGenerateConflictItem[];
}

export class BulkScheduleService {
  constructor(private repo: IRepository = defaultRepo) {}

  public async generateRecurringSlots(params: BulkGenerateParams): Promise<BulkGenerateResult> {
    const {
      classIds,
      startDate,
      endDate,
      shiftId: overrideShiftId,
      startTime: overrideStartTime,
      endTime: overrideEndTime,
      scheduleDays: overrideScheduleDays,
      overwriteExisting = false,
      actorId = 'SYSTEM',
      previewOnly = false,
    } = params;

    // 1. Đọc danh sách lớp học cần sinh lịch
    const allClasses = await this.repo.getAllClasses();
    let targetClasses: ClassEntity[] = [];

    const isAll = classIds.length === 0 || classIds.includes('all') || classIds.includes('ALL');
    if (isAll) {
      targetClasses = allClasses.filter(c => c.status === 'Đang mở');
    } else {
      const idSet = new Set(classIds);
      targetClasses = allClasses.filter(c => idSet.has(c.id));
    }

    if (targetClasses.length === 0) {
      return {
        summary: {
          totalAttempted: 0,
          createdCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          conflictCount: 0,
        },
        createdSlots: [],
        conflicts: [],
      };
    }

    const conflictEngine = new ConflictEngine(this.repo);
    const shifts = await ShiftService.getAllShifts();

    // Mỗi lớp có thể có nhiều ca học: đọc toàn bộ ca của từng lớp và sinh lịch cho từng ca.
    // Lớp cũ chưa có ca (dữ liệu legacy) thì tự suy một "ca ảo" từ thông tin lớp.
    const sectionsByClass = new Map<string, ClassSection[]>();
    for (const cls of targetClasses) {
      const sections = await this.repo.getClassSections(cls.id);
      const activeSections = sections.filter((s) => s.isActive !== false);
      if (activeSections.length > 0) {
        sectionsByClass.set(cls.id, activeSections);
      } else {
        sectionsByClass.set(cls.id, [
          {
            id: '',
            classId: cls.id,
            name: cls.name || 'Ca học',
            shiftId: cls.shiftId,
            startTime: cls.startTime,
            endTime: cls.endTime,
            scheduleDays: [...(cls.scheduleDays || [])],
            teacherId: cls.teacherId,
            isActive: true,
            studentIds: [],
          },
        ]);
      }
    }
    const shiftMap = new Map<number, (typeof shifts)[0]>();
    shifts.forEach(s => shiftMap.set(s.id, s));

    // Lấy trước max id của ScheduleSlot để sinh ID tăng dần duy nhất
    const initialSlots = await this.repo.getAllScheduleSlots();
    let maxNum = await this.repo.getMaxScheduleSlotNumber();

    // Chuẩn bị danh sách ngày từ startDate đến endDate
    const dateList: string[] = [];
    const [sY, sM, sD] = startDate.split('-').map(Number);
    const [eY, eM, eD] = endDate.split('-').map(Number);
    const curr = new Date(Date.UTC(sY, sM - 1, sD));
    const end = new Date(Date.UTC(eY, eM - 1, eD));

    while (curr <= end) {
      const y = curr.getUTCFullYear();
      const m = String(curr.getUTCMonth() + 1).padStart(2, '0');
      const d = String(curr.getUTCDate()).padStart(2, '0');
      dateList.push(`${y}-${m}-${d}`);
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    let totalAttempted = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let conflictCount = 0;

    const createdSlots: ScheduleSlot[] = [];
    const conflicts: BulkGenerateConflictItem[] = [];

    // Giữ sẵn danh sách ca học trong bộ nhớ và cập nhật dần, tránh truy vấn lặp lại
    // (Worker có giới hạn số subrequest cho mỗi lần chạy).
    const workingSlots: ScheduleSlot[] = [...initialSlots];
    const slotsToCreate: ScheduleSlot[] = [];
    const slotsToUpdate: ScheduleSlot[] = [];

    // Duyệt qua từng ngày, mỗi ca học (section) của lớp sinh slot riêng.
    for (const dateStr of dateList) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      const jsDay = dateObj.getUTCDay(); // 0: CN, 1: T2, 2: T3, ..., 6: T7
      const dayOfWeek = jsDay === 0 ? 8 : jsDay + 1; // 2..7 cho T2..T7, 8 cho CN

      for (const cls of targetClasses) {
        const sections = sectionsByClass.get(cls.id) || [];

        for (const section of sections) {
          // Override lịch (quick schedule) áp cho mọi ca; ngược lại ưu tiên thứ của ca, fallback về lớp.
          const sectionDays = overrideScheduleDays && overrideScheduleDays.length > 0
            ? overrideScheduleDays
            : (section.scheduleDays && section.scheduleDays.length > 0
                ? section.scheduleDays
                : cls.scheduleDays || []);

          if (!sectionDays.includes(dayOfWeek)) {
            continue;
          }

          totalAttempted++;

          const rawShiftId = overrideShiftId !== undefined && overrideShiftId !== null
            ? Number(overrideShiftId)
            : (section.shiftId ?? cls.shiftId ?? 1);
          const currentShiftId = Number(rawShiftId) || 1;

          const defaultShift = shiftMap.get(currentShiftId) || shifts[0] || {
            id: currentShiftId,
            startTime: '18:30',
            endTime: '20:30',
          };

          const slotStartTime = overrideStartTime || section.startTime || cls.startTime || defaultShift.startTime || '18:30';
          const slotEndTime = overrideEndTime || section.endTime || cls.endTime || defaultShift.endTime || '20:30';
          const slotTeacherId = section.teacherId || cls.teacherId;

          // Ưu tiên khớp theo sectionId; dữ liệu cũ chưa có sectionId thì khớp theo lớp + ngày.
          const existingSlot = workingSlots.find((s) => {
            if (section.id) {
              return s.sectionId === section.id && s.date === dateStr && s.status !== 'Đã hủy';
            }
            return s.classId === cls.id && s.date === dateStr && !s.sectionId && s.status !== 'Đã hủy';
          });

          if (existingSlot) {
            if (overwriteExisting) {
              const updatedSlot: ScheduleSlot = {
                ...existingSlot,
                sectionId: section.id || existingSlot.sectionId,
                teacherId: slotTeacherId,
                shiftId: currentShiftId,
                startTime: slotStartTime,
                endTime: slotEndTime,
                subject: cls.subject || existingSlot.subject,
                meetingLink: cls.meetingLink || existingSlot.meetingLink,
                status: 'Đã lên lịch',
              };

              const check = await conflictEngine.checkScheduleConflict(updatedSlot, existingSlot.id, workingSlots);
              if (check.hasConflict) {
                conflictCount++;
                conflicts.push({
                  classId: cls.id,
                  date: dateStr,
                  shiftId: currentShiftId,
                  conflicts: check.conflicts,
                });
              } else {
                slotsToUpdate.push(updatedSlot);
                const idx = workingSlots.findIndex((s) => s.id === existingSlot.id);
                if (idx >= 0) workingSlots[idx] = updatedSlot;
                updatedCount++;
                createdSlots.push(updatedSlot);
              }
            } else {
              skippedCount++;
            }
            continue;
          }

          // Trường hợp chưa có slot: Kiểm tra xung đột
          const candidateSlot: Omit<ScheduleSlot, 'id'> = {
            classId: cls.id,
            sectionId: section.id || undefined,
            teacherId: slotTeacherId,
            date: dateStr,
            shiftId: currentShiftId,
            startTime: slotStartTime,
            endTime: slotEndTime,
            subject: cls.subject || cls.name,
            topic: `Buổi học định kỳ - ${cls.name}`,
            meetingLink: cls.meetingLink || '',
            status: 'Đã lên lịch',
          };

          const conflictResult = await conflictEngine.checkScheduleConflict(candidateSlot, undefined, workingSlots);

          if (conflictResult.hasConflict) {
            conflictCount++;
            conflicts.push({
              classId: cls.id,
              date: dateStr,
              shiftId: currentShiftId,
              conflicts: conflictResult.conflicts,
            });
          } else {
            maxNum++;
            const newSlotId = `SCH${maxNum.toString().padStart(4, '0')}`;
            const newSlot: ScheduleSlot = {
              id: newSlotId,
              ...candidateSlot,
            };
            slotsToCreate.push(newSlot);
            workingSlots.push(newSlot);
            createdCount++;
            createdSlots.push(newSlot);
          }
        }
      }
    }

    // Ghi một lượt xuống cơ sở dữ liệu thay vì gọi riêng từng ca.
    if (!previewOnly && slotsToCreate.length > 0) {
      await this.repo.createScheduleSlotsBatch(slotsToCreate);
    }
    if (!previewOnly && slotsToUpdate.length > 0) {
      await this.repo.updateScheduleSlotsBatch(slotsToUpdate);
    }

    // Ghi nhận Audit Log tổng kết
    if (!previewOnly) {
      await this.repo.addAuditLog({
        action: 'CREATE',
        userId: actorId,
        userName: actorId === 'SYSTEM' ? 'Hệ thống' : actorId,
        userRole: 'ADMIN',
        targetResource: 'SCHEDULE',
        targetId: 'BULK_GENERATE',
        details: `Sinh lịch lặp dài hạn từ ${startDate} đến ${endDate}: Tạo mới ${createdCount}, Cập nhật ${updatedCount}, Bỏ qua ${skippedCount}, Xung đột ${conflictCount} (Tổng quét: ${totalAttempted}) cho ${targetClasses.length} lớp.`,
      });
    }

    return {
      summary: {
        totalAttempted,
        createdCount,
        updatedCount,
        skippedCount,
        conflictCount,
      },
      createdSlots,
      conflicts,
    };
  }
}
