import { getTodayDateStr } from '@/utils/date';
import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { loadScheduleView } from '@/services/ScheduleViewService';
import { AttendanceRecord } from '@/types/attendance';
import { authenticate } from '@/lib/auth/session';
import { getTeacherClassIds } from '@/lib/auth/studentScope';

export const dynamic = 'force-dynamic';

export interface StudentAttendanceDetail {
  id: string;
  name: string;
  phone?: string;
  checkinTime?: string;
  method?: string;
  note?: string;
}

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const requestedTeacherId = searchParams.get('teacherId');

    // Trước đây route này không giới hạn gì: một giáo viên bất kỳ gọi không tham
    // số là nhận ca đang diễn ra của TOÀN trung tâm, kèm tên + SĐT từng học viên
    // trong danh sách "chưa điểm danh". Giáo viên phải bị ép về ca của mình;
    // `?teacherId=` của người khác là 403 chứ không phải một phép lọc.
    const isTeacher = auth.user.role === 'TEACHER';
    if (isTeacher && requestedTeacherId && requestedTeacherId !== auth.user.id) {
      return NextResponse.json(
        { success: false, error: 'Không có quyền xem ca dạy của giáo viên khác' },
        { status: 403 },
      );
    }
    const teacherId = isTeacher ? auth.user.id : requestedTeacherId || undefined;

    const now = new Date();
    // Lấy ngày và giờ chuẩn xác theo múi giờ Việt Nam (Asia/Saigon)
    const today = getTodayDateStr();
    const nowTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Saigon',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);

    // Đọc qua ScheduleViewService để giờ của buổi là giờ thật (ca học → slot → lớp),
    // giống hệt nút điểm danh của học sinh. Đọc bảng thô sẽ lệch khi slot thiếu giờ.
    const { slots: daySlots } = await loadScheduleView({ date: today, teacherId: teacherId || undefined });
    // Chỉ bật "Đang diễn ra" khi giờ hiện tại nằm đúng trong khung giờ học.
    // Không có nhánh "trả về ca đầu tiên của ngày" nữa: ca chưa/đã kết thúc mà báo
    // là đang diễn ra sẽ khiến sổ điểm danh trực tiếp hiển thị sai.
    const activeSlot =
      daySlots.find((s) => s.startTime <= nowTime && s.endTime >= nowTime && s.status !== 'Đã hủy') || null;

    if (!activeSlot) {
      return NextResponse.json({
        success: true,
        hasActiveSession: false,
        message: 'Hiện không có ca học nào đang diễn ra',
      });
    }

    // Lấy thông tin lớp học & danh sách học sinh của lớp
    if (isTeacher) {
      const allowed = await getTeacherClassIds(auth.user.id);
      if (!allowed.has(activeSlot.classId)) {
        // Ca đang diễn ra là của giáo viên khác: coi như giáo viên này không có
        // ca đang dạy, không trả thông tin lớp/học viên.
        return NextResponse.json({
          success: true,
          hasActiveSession: false,
          message: 'Hiện không có ca học nào đang diễn ra',
        });
      }
    }

    const cls = await repo.getClassById(activeSlot.classId);
    const rosterStudentIds = cls ? [...cls.studentIds] : [];

    // Học sinh đặt buổi lẻ cho ca này cũng phải hiện trong sổ trực tiếp.
    const bookings = await repo.getSessionBookings({
      slotIds: [activeSlot.id],
      statuses: ['Đã đăng ký', 'Đã học'],
    });
    for (const booking of bookings) {
      if (!rosterStudentIds.includes(booking.studentId)) rosterStudentIds.push(booking.studentId);
    }

    // Lấy bản ghi điểm danh của slot này
    const records = await repo.getAttendanceBySlotId(activeSlot.id);
    const recordMap = new Map<string, AttendanceRecord>();
    records.forEach(r => recordMap.set(r.studentId, r));

    // Lấy toàn bộ danh sách sinh viên để lấy tên và thông tin liên lạc
    const allStudents = await repo.getAllStudents();
    const studentInfoMap = new Map<string, any>();
    allStudents.forEach(st => studentInfoMap.set(st.id, st));

    // Thống kê 4 nhóm theo yêu cầu:
    // 1. attended: Tham gia (Đã điểm danh: Có mặt, Đi muộn, Điểm danh bù)
    // 2. notAttended: Chưa tham gia (Chưa được điểm danh)
    // 3. excused: Vắng có phép
    // 4. unexcused: Vắng không phép
    const attendedList: StudentAttendanceDetail[] = [];
    const notAttendedList: StudentAttendanceDetail[] = [];
    const excusedList: StudentAttendanceDetail[] = [];
    const unexcusedList: StudentAttendanceDetail[] = [];

    const allStudentIds = new Set<string>([...rosterStudentIds]);
    records.forEach(r => allStudentIds.add(r.studentId));

    const totalStudents = allStudentIds.size;

    allStudentIds.forEach(stId => {
      const rec = recordMap.get(stId);
      const stObj = studentInfoMap.get(stId);
      const studentName = stObj?.name || `Học viên ${stId}`;

      const detail: StudentAttendanceDetail = {
        id: stId,
        name: studentName,
        phone: stObj?.phone,
        checkinTime: rec?.checkinTime,
        method: rec?.method,
        note: rec?.note,
      };

      if (!rec) {
        notAttendedList.push(detail);
      } else {
        if (rec.status === 'Có mặt' || rec.status === 'Đi muộn' || rec.status === 'Điểm danh bù') {
          attendedList.push(detail);
        } else if (rec.status === 'Vắng có phép') {
          excusedList.push(detail);
        } else if (rec.status === 'Vắng không phép') {
          unexcusedList.push(detail);
        } else {
          notAttendedList.push(detail);
        }
      }
    });

    return NextResponse.json({
      success: true,
      hasActiveSession: true,
      slot: activeSlot,
      className: cls?.name || activeSlot.classId,
      stats: {
        totalStudents,
        attendedCount: attendedList.length,
        notAttendedCount: notAttendedList.length,
        excusedCount: excusedList.length,
        unexcusedCount: unexcusedList.length,
        attendanceRate: totalStudents > 0 ? Math.round((attendedList.length / totalStudents) * 100) : 0,
      },
      studentsByStatus: {
        attended: attendedList,
        notAttended: notAttendedList,
        excused: excusedList,
        unexcused: unexcusedList,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
