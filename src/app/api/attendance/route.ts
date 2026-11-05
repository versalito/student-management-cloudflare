import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { AttendanceRecord, AttendanceStatus } from '@/types/attendance';
import { getTodayDateStr, getNowTimeStr, timeToMinutes } from '@/utils/date';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
    // Tự động hợp nhất danh sách học sinh của lớp vào sổ điểm danh nếu chưa có bản ghi
    const slot = await repo.getScheduleSlotById(slotId);
    if (slot && slot.classId) {
      const cls = await repo.getClassById(slot.classId);
      if (cls && Array.isArray(cls.studentIds) && cls.studentIds.length > 0) {
        const recordedIds = new Set(records.map(r => r.studentId));
        for (const stId of cls.studentIds) {
          if (!recordedIds.has(stId)) {
            records.push({
              id: `ATT_ROSTER_${slotId}_${stId}`,
              scheduleSlotId: slotId,
              studentId: stId,
              classId: slot.classId,
              date: slot.date,
              status: 'Chưa điểm danh' as any,
              note: 'Học viên trong danh sách lớp',
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
  try {
    const body = await request.json();

    // 1. Action: STUDENT_CHECKIN - Điểm danh nhanh phía học sinh (Self check-in)
    if (body.action === 'STUDENT_CHECKIN') {
      const { studentId, scheduleSlotId } = body;
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
      const cls = await repo.getClassById(slot.classId);
      const isEnrolled = cls?.studentIds?.includes(studentId);
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
      // Bọc riêng trong try/catch để không bao giờ làm fail điểm danh nếu lỗi xảy ra.
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

    const updatedBy = body.updatedBy || 'ADMIN001';
    const updaterName = body.updaterName || 'Quản trị viên';
    const userRole = updatedBy.startsWith('ADMIN') ? 'ADMIN' : (body.userRole || 'ADMIN');

    if (Array.isArray(body.records)) {
      const saved = await repo.saveAttendanceBatch(body.records);
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
      const saved = await repo.saveAttendanceRecord(body.record);
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
