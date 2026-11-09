import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { AttendanceRecord, AttendanceStatus } from '@/types/attendance';
import { getTodayDateStr, getNowTimeStr, timeToMinutes, dateToDayOfWeek, daysBetween } from '@/utils/date';
import { resolveScheduleSlotTimes } from '@/services/SlotTimeService';
import { evaluateSessionWindow } from '@/services/StudentSessionService';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';
import { getTeacherClassIds, teacherTeachesClass, teacherTeachesStudent } from '@/lib/auth/studentScope';
import { settleBookingsAttended } from '@/services/BookingService';
import { settleSlotStatusesFromAttendance } from '@/services/SlotSettlementService';

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

  // Giáo viên chỉ đọc sổ của lớp mình phụ trách.
  //
  // Trước đây nhánh này chỉ kiểm `classId` và trả sớm khi thiếu tham số, nên
  // `?slotId=` (đường trang Điểm danh dùng) bị chặn thành sổ rỗng, còn `?date=`
  // trả cả ngày của trung tâm. Giờ kiểm đúng khoá của từng nhánh rồi mới lọc.
  if (auth.user.role === 'TEACHER') {
    const searchParams = new URL(request.url).searchParams;
    const allowed = await getTeacherClassIds(auth.user.id);
    const requestedClassId = searchParams.get('classId');
    if (requestedClassId && !allowed.has(requestedClassId)) {
      return NextResponse.json({ error: 'Lớp này không thuộc phạm vi bạn phụ trách' }, { status: 403 });
    }

    const slotId = searchParams.get('slotId');
    if (slotId) {
      const slot = await repo.getScheduleSlotById(slotId);
      if (slot && !allowed.has(slot.classId)) {
        return NextResponse.json({ error: 'Ca này không thuộc phạm vi bạn phụ trách' }, { status: 403 });
      }
    }

    const requestedStudentId = searchParams.get('studentId');
    if (requestedStudentId && !(await teacherTeachesStudent(auth.user.id, requestedStudentId))) {
      return NextResponse.json({ error: 'Học viên này không thuộc lớp bạn phụ trách' }, { status: 403 });
    }

    // Không có khoá nào: đọc sổ trong ngày nhưng chỉ giữ lớp mình dạy.
    if (!requestedClassId && !slotId && !requestedStudentId) {
      const records = await repo.getAttendanceByDate(
        searchParams.get('date') || getTodayDateStr()
      );
      return NextResponse.json({
        records: records.filter((record) => allowed.has(record.classId)),
      });
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
      // Học sinh đặt buổi lẻ cũng phải có tên trong sổ của buổi đó.
      const booked = await repo.getSessionBookings({
        slotIds: [slotId],
        statuses: ['Đã đăng ký', 'Đã học'],
      });
      for (const booking of booked) {
        if (!rosterIds.includes(booking.studentId)) rosterIds.push(booking.studentId);
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
        // Buổi lẻ: học sinh đã đặt buổi này thì được tự điểm danh như học viên của ca.
        // `Đã học` phải tính là đã đăng ký, nếu không lần điểm danh thứ hai rơi vào
        // nhánh 403 "không thuộc lớp" thay vì 409 "đã điểm danh rồi".
        const bookings = await repo.getSessionBookings({
          studentId,
          slotId: scheduleSlotId,
          statuses: ['Đã đăng ký', 'Đã học'],
        });
        isEnrolled = bookings.length > 0;
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

      // Giờ thật lấy theo thứ tự: ca học (class_sections) → slot → lớp, đúng như
      // ScheduleViewService dùng để tính `canCheckIn`. Đọc thẳng slot.startTime sẽ
      // lệch với nút trên giao diện khi slot chưa lưu giờ.
      const effective = await resolveScheduleSlotTimes(slot);

      const dayOffset = daysBetween(slot.date, todayStr);
      const isOvernight = timeToMinutes(effective.startTime) > timeToMinutes(effective.endTime);

      // Ca học chỉ hợp lệ nếu diễn ra hôm nay:
      // - Cùng ngày bắt đầu ca (dayOffset === 0)
      // - Hoặc là ca qua đêm bắt đầu từ tối hôm qua (dayOffset === 1 && isOvernight)
      const isDateValid = dayOffset === 0 || (dayOffset === 1 && isOvernight);
      if (!isDateValid) {
        return NextResponse.json(
          { success: false, error: `Ca học diễn ra vào ngày ${slot.date}, hôm nay là ${todayStr}` },
          { status: 400 }
        );
      }

      const nowMins = timeToMinutes(nowTimeStr);
      const window = evaluateSessionWindow(
        effective.startTime,
        effective.endTime,
        nowMins,
        undefined,
        dayOffset
      );

      if (!window.open) {
        return NextResponse.json(
          {
            success: false,
            error: `${window.reason}. Ca học ${effective.startTime} - ${effective.endTime}, hiện tại là ${nowTimeStr}.`,
            code: window.status === 'ended' ? 'SESSION_ENDED' : 'SESSION_NOT_OPEN',
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
      const startMins = timeToMinutes(effective.startTime);
      const currentElapsedMins = dayOffset * 1440 + nowMins;
      const status: AttendanceStatus = (currentElapsedMins <= startMins + 30) ? 'Có mặt' : 'Đi muộn';
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

      // Buổi lẻ đã dùng thì chốt `Đã học`, không cho huỷ nữa.
      await settleBookingsAttended(repo, [saved]);

      // Chốt buổi sang "Đã hoàn thành" khi buổi đã kết thúc, để lương giáo viên
      // và công nợ tính được (xem SlotSettlementService).
      await settleSlotStatusesFromAttendance([saved]);

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

    // Giáo viên chỉ ghi sổ điểm danh cho lớp/ca mình phụ trách. Trước đây mọi
    // tài khoản TEACHER ghi được cho bất kỳ lớp nào (đổi trạng thái, trừ buổi
    // của học viên lớp khác).
    if (userRole === 'TEACHER') {
      const classIds = new Set<string>();
      for (const record of Array.isArray(body.records) ? body.records : []) {
        if (record?.classId) classIds.add(record.classId);
      }
      if (body.record?.classId) classIds.add(body.record.classId);
      if (body.classId) classIds.add(body.classId);
      for (const classId of classIds) {
        if (!(await teacherTeachesClass(updatedBy, classId))) {
          return NextResponse.json(
            { success: false, error: 'Lớp này không thuộc phạm vi bạn phụ trách' },
            { status: 403 }
          );
        }
      }
    }

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
      await settleBookingsAttended(repo, saved);
      await settleSlotStatusesFromAttendance(saved);

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
      await settleBookingsAttended(repo, [saved]);
      await settleSlotStatusesFromAttendance([saved]);
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
