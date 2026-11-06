import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { AttendanceRecord, AttendanceStatus } from '@/types/attendance';
import { getTodayDateStr, getNowTimeStr, timeToMinutes, dateToDayOfWeek } from '@/utils/date';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Trừ 1 buổi vào gói hoá đơn đang hoạt động của học sinh khi được ghi nhận có đi học.
 * Chỉ trừ cho các trạng thái tính là có mặt. Bọc lỗi để không làm hỏng thao tác điểm danh.
 */
async function deductSessionForAttendance(studentId: string, status: AttendanceStatus): Promise<void> {
  const countsAsAttended =
    status === 'Có mặt' || status === 'Đi muộn' || status === 'Điểm danh bù';
  if (!countsAsAttended) return;

  try {
    const invoices = await repo.getTuitionInvoicesByStudentId(studentId);
    const availableInvoice = (invoices || []).find(
      (inv) =>
        inv &&
        typeof inv.sessionCount === 'number' &&
        inv.sessionCount > 0 &&
        (inv.usedSessions || 0) < inv.sessionCount
    );
    if (availableInvoice) {
      availableInvoice.usedSessions = (availableInvoice.usedSessions || 0) + 1;
      await repo.updateTuitionInvoice(availableInvoice);
    }
  } catch (sessionErr: any) {
    console.warn(
      `[attendance] Không thể trừ buổi cho học sinh ${studentId}: ${sessionErr?.message || sessionErr}`
    );
  }
}

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;

  // Học viên chỉ được đọc sổ điểm danh của chính mình.
  if (auth.user.role === 'STUDENT') {
    const requestedStudentId = new URL(request.url).searchParams.get('studentId');
    if (!isSelfOrStaff(auth.user, requestedStudentId)) {
      return NextResponse.json({ error: 'Không có quyền xem điểm danh của người khác' }, { status: 403 });
    }
  }

  try {
    return await getAttendance(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải sổ điểm danh';
    return NextResponse.json({ records: [], error: message }, { status: 500 });
  }
}

async function getAttendance(request: Request) {
  const { searchParams } = new URL(request.url);
  const slotId = searchParams.get('slotId');
  const studentId = searchParams.get('studentId');
  const classId = searchParams.get('classId');
  const date = searchParams.get('date');

  let records: AttendanceRecord[] = [];

  if (slotId) {
    records = await repo.getAttendanceBySlotId(slotId);
    // Hợp danh sách học viên thuộc CA của buổi học vào sổ điểm danh nếu chưa có bản ghi.
    const slot = await repo.getScheduleSlotById(slotId);
    if (slot && slot.classId) {
       // Ưu tiên danh sách của ca (class_sections); buổi cũ chưa gán ca thì lấy theo lớp.
       let rosterIds: string[] = [];
       if (slot.sectionId) {
         // Ba lượt đọc độc lập: gom thành một `Promise.all` thay vì chờ lần lượt.
         const [section, daysMap, swapsIn, swapsOut] = await Promise.all([
           repo.getSectionById(slot.sectionId),
           repo.getSectionStudentScheduleDays(slot.sectionId),
           repo.getSlotSwaps({ toSlotId: slotId, status: 'ACTIVE' }),
           repo.getSlotSwaps({ fromSlotId: slotId, status: 'ACTIVE' }),
         ]);
         // Học sinh có chọn "thứ riêng" thì chỉ vào sổ ở đúng thứ đã chọn.
         const slotDow = dateToDayOfWeek(slot.date);
         rosterIds = (section?.studentIds || []).filter((stId) => {
           const days = daysMap[stId] || [];
           if (days.length === 0) return true;
           return slotDow !== null && days.includes(slotDow);
         });
         // Đổi ca nhanh trong ngày: đổi SANG ca này thì thêm vào sổ, đổi ĐI thì bỏ khỏi sổ.
         const outSet = new Set(swapsOut.map((sw) => sw.studentId));
         const seen = new Set(rosterIds);
         for (const sw of swapsIn) {
           if (!seen.has(sw.studentId)) rosterIds.push(sw.studentId);
         }
         rosterIds = rosterIds.filter((stId) => !outSet.has(stId));
       } else {
         const cls = await repo.getClassById(slot.classId);
         rosterIds = cls?.studentIds || [];
       }
      if (Array.isArray(rosterIds) && rosterIds.length > 0) {
        const recordedIds = new Set(records.map(r => r.studentId));
        for (const stId of rosterIds) {
          if (!recordedIds.has(stId)) {
            records.push({
              id: `ATT_ROSTER_${slotId}_${stId}`,
              scheduleSlotId: slotId,
              studentId: stId,
              classId: slot.classId,
              date: slot.date,
              status: 'Chưa điểm danh' as any,
              note: 'Học viên trong ca học',
              method: 'MANUAL',
              updatedBy: 'SYSTEM',
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    }
  } else if (classId) {
    records = await repo.getAttendanceByClassId(classId);
  } else if (studentId) {
    records = await repo.getAttendanceByStudentId(studentId);
  } else {
    // Không có filter: chỉ đọc sổ điểm danh của hôm nay (1 query theo index `idx_attendance_date`)
    // thay vì N+1 query cho từng lớp rồi gộp cả bảng.
    records = await repo.getAttendanceByDate(date || getTodayDateStr());
  }

  // Filter further by date, classId, slotId, studentId if multiple params provided
  if (date) {
    records = records.filter(r => r.date === date);
  }
  if (classId && slotId) {
    records = records.filter(r => r.classId === classId);
  }
  if (studentId && (slotId || classId)) {
    records = records.filter(r => r.studentId === studentId);
  }

  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();

    // 1. Action: STUDENT_CHECKIN - Điểm danh nhanh phía học sinh (Self check-in)
    if (body.action === 'STUDENT_CHECKIN') {
      const { studentId, scheduleSlotId } = body;
      // Học viên chỉ tự điểm danh cho chính mình.
      if (!isSelfOrStaff(auth.user, studentId)) {
        return NextResponse.json(
          { success: false, error: 'Không có quyền điểm danh cho học viên khác' },
          { status: 403 }
        );
      }
      if (!studentId || !scheduleSlotId) {
        return NextResponse.json(
          { success: false, error: 'Thiếu thông tin studentId hoặc scheduleSlotId' },
          { status: 400 }
        );
      }

      // Slot tồn tại
      const slot = await repo.getScheduleSlotById(scheduleSlotId);
      if (!slot) {
        return NextResponse.json(
          { success: false, error: 'Ca học không tồn tại' },
          { status: 400 }
        );
      }

      // Kiểm tra HS có trong lớp của slot không
      // Ưu tiên kiểm tra theo ca (class_sections); buổi cũ chưa gắn ca thì theo lớp.
      // Học sinh đổi ca nhanh SANG ca này (student_slot_swaps) cũng được phép tự điểm danh.
      let isEnrolled = false;
      if (slot.sectionId) {
        const section = await repo.getSectionById(slot.sectionId);
        isEnrolled = (section?.studentIds || []).includes(studentId);
      } else {
        const cls = await repo.getClassById(slot.classId);
        isEnrolled = cls?.studentIds?.includes(studentId) || false;
      }
      if (!isEnrolled) {
        const swapsIn = await repo.getSlotSwaps({ toSlotId: scheduleSlotId, status: 'ACTIVE' });
        isEnrolled = swapsIn.some((sw) => sw.studentId === studentId);
      }
      if (!isEnrolled) {
        return NextResponse.json(
          { success: false, error: 'Học sinh không thuộc danh sách lớp học của ca này' },
          { status: 403 }
        );
      }

      // So sánh ngày và giờ theo múi giờ Asia/Saigon
      const todayStr = getTodayDateStr();
      const nowTimeStr = getNowTimeStr();

      if (slot.date !== todayStr) {
        return NextResponse.json(
          { success: false, error: `Ca học diễn ra vào ngày ${slot.date}, hôm nay là ${todayStr}` },
          { status: 400 }
        );
      }

      const nowMins = timeToMinutes(nowTimeStr);
      const startMins = timeToMinutes(slot.startTime);
      const endMins = timeToMinutes(slot.endTime);

      // Ca qua nửa đêm (vd 22:00 -> 01:00): hợp lệ khi nowMins >= startMins HOẶC nowMins <= endMins.
      const isOvernight = startMins > endMins;
      const inShiftWindow = isOvernight
        ? (nowMins >= startMins || nowMins <= endMins)
        : (nowMins >= startMins && nowMins <= endMins);

      if (!inShiftWindow) {
        return NextResponse.json(
          {
            success: false,
            error: `Chỉ được điểm danh khi ca học đang diễn ra (${slot.startTime} - ${slot.endTime}). Hiện tại là ${nowTimeStr}`,
          },
          { status: 400 }
        );
      }

      // Kiểm tra nếu đã có record cho (studentId, scheduleSlotId)
      const existingRecords = await repo.getAttendanceBySlotId(scheduleSlotId);
      const existing = existingRecords.find(r => r.studentId === studentId);
      if (existing) {
        return NextResponse.json(
          {
            success: false,
            error: 'Bạn đã được điểm danh trong ca học này rồi, không thể tự điểm danh lại',
            record: existing,
          },
          { status: 409 }
        );
      }

      // Tính status theo mốc 30 phút:
      // Trong 30 phút đầu ca (từ startTime đến startTime + 30') -> 'Có mặt'
      // Sau 30 phút nhưng vẫn trong ca (đến endTime) -> 'Đi muộn'
      const status: AttendanceStatus = (nowMins <= startMins + 30) ? 'Có mặt' : 'Đi muộn';

      const newRecord: AttendanceRecord = {
        id: `ATT_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        scheduleSlotId: slot.id,
        classId: slot.classId,
        studentId: studentId,
        date: slot.date,
        status: status,
        checkinTime: nowTimeStr,
        method: 'STUDENT_QUICK',
        note: `Học sinh tự điểm danh nhanh lúc ${nowTimeStr} (${status})`,
        updatedBy: studentId,
        updatedAt: new Date().toISOString(),
      };

      const saved = await repo.saveAttendanceRecord(newRecord);

      // Tự động trừ 1 buổi (usedSessions) khỏi gói hoá đơn đang hoạt động của học sinh.
      await deductSessionForAttendance(studentId, status);

      const studentObj = await repo.getStudentById(studentId);
      await repo.addAuditLog({
        userId: studentId,
        userName: studentObj?.name || `Học sinh ${studentId}`,
        userRole: 'STUDENT',
        action: 'ATTENDANCE_CHECK',
        targetResource: 'ATTENDANCE',
        targetId: saved.scheduleSlotId || saved.id,
        details: `Học sinh ${studentObj?.name || studentId} tự điểm danh nhanh: ${status} lúc ${nowTimeStr}`,
      });

      return NextResponse.json({ success: true, record: saved });
    }

    // Các nhánh còn lại là sổ điểm danh do giáo viên/quản trị ghi.
    if (auth.user.role === 'STUDENT') {
      return NextResponse.json(
        { success: false, error: 'Học viên chỉ được tự điểm danh, không được sửa sổ điểm danh' },
        { status: 403 }
      );
    }

    const updatedBy = auth.user.id;
    const updaterName = auth.user.name;
    const userRole = auth.user.role;

    if (Array.isArray(body.records)) {
      // Bỏ qua các dòng chỉ để hiển thị trên sổ (học viên chưa được điểm danh).
      // Chỉ lưu những dòng có trạng thái thật, tránh ghi placeholder vào DB.
      const realRecords = (body.records as AttendanceRecord[]).filter(
        (r) => r && String(r.status) !== 'Chưa điểm danh'
      )
        // Người ghi sổ do phiên quyết định, không tin `updatedBy` client gửi lên.
        .map((r) => ({ ...r, updatedBy: updatedBy }));

      // Phải đọc sổ hiện có TRƯỚC khi lưu để biết dòng nào là mới, tránh trừ buổi trùng.
      const alreadyRecorded = new Set<string>();
      const slotIdsToCheck = Array.from(
        new Set(realRecords.map((r) => r.scheduleSlotId).filter(Boolean))
      );
      for (const sid of slotIdsToCheck) {
        const existing = await repo.getAttendanceBySlotId(sid);
        existing.forEach((r) => alreadyRecorded.add(`${r.scheduleSlotId}::${r.studentId}`));
      }

      const saved = await repo.saveAttendanceBatch(realRecords);

      // Trừ buổi cho các bản ghi có mặt và chưa từng được ghi nhận trước đó.
      const toDeduct = realRecords.filter(
        (r) => !alreadyRecorded.has(`${r.scheduleSlotId}::${r.studentId}`)
      );
      for (const rec of toDeduct) {
        await deductSessionForAttendance(rec.studentId, rec.status);
      }

      await repo.addAuditLog({
        userId: updatedBy,
        userName: updaterName,
        userRole: userRole as any,
        action: 'ATTENDANCE_CHECK',
        targetResource: 'ATTENDANCE',
        targetId: body.slotId || 'BATCH',
        details: `Cập nhật sổ điểm danh cho ${saved.length} học viên (Ca: ${body.slotId || 'Nhiều ca'})`,
      });
      return NextResponse.json({ success: true, count: saved.length, records: saved });
    } else if (body.record) {
      const saved = await repo.saveAttendanceRecord({ ...body.record, updatedBy: updatedBy });
      await deductSessionForAttendance(saved.studentId, saved.status);
      await repo.addAuditLog({
        userId: updatedBy,
        userName: updaterName,
        userRole: userRole as any,
        action: 'ATTENDANCE_CHECK',
        targetResource: 'ATTENDANCE',
        targetId: saved.scheduleSlotId || saved.id,
        details: `Cập nhật điểm danh cho học viên ${saved.studentId} trạng thái: ${saved.status}`,
      });
      return NextResponse.json({ success: true, record: saved });
    }
    return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
