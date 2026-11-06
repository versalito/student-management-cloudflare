import { getTodayDateStr } from '@/utils/date';
import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { ScheduleSlot } from '@/types/schedule';
import { AttendanceRecord } from '@/types/attendance';
import { authenticate } from '@/lib/auth/session';

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
    const dateParam = searchParams.get('date');
    const teacherId = searchParams.get('teacherId');

    const now = new Date();
    // Lấy ngày và giờ chuẩn xác theo múi giờ Việt Nam (Asia/Saigon)
    const today = dateParam || getTodayDateStr();
    const nowTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Saigon',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);

    const slots = await repo.getAllScheduleSlots();
    // Lọc theo ngày
    let daySlots = slots.filter(s => s.date === today);

    if (teacherId) {
      daySlots = daySlots.filter(s => s.teacherId === teacherId);
    }

    let activeSlot: ScheduleSlot | null = null;

    if (dateParam) {
      // Xem theo một ngày cụ thể: chỉ lấy ca học của đúng ngày đó.
      activeSlot = daySlots.find(s => s.status !== "Đã hủy") || null;
    } else {
      // Trường hợp chạy thời gian thực trên giao diện Live:
      // CHUẨN XÁC TUYỆT ĐỐI: Chỉ bật "Đang Diễn Ra" khi thời gian hiện tại nằm ĐÚNG trong khung giờ học
      if (daySlots.length > 0) {
        activeSlot = daySlots.find(s => s.startTime <= nowTime && s.endTime >= nowTime && s.status !== "Đã hủy") || null;
      } else {
        activeSlot = null;
      }
    }

    if (!activeSlot) {
      return NextResponse.json({
        success: true,
        hasActiveSession: false,
        message: 'Hiện không có ca học nào đang diễn ra',
      });
    }

    // Lấy thông tin lớp học & danh sách học sinh của lớp
    const cls = await repo.getClassById(activeSlot.classId);
    const rosterStudentIds = cls ? cls.studentIds : [];

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
