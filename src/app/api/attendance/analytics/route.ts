import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { Student } from '@/types/student';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    // Mặc định lấy tháng hiện tại theo giờ Việt Nam.
    const month =
      searchParams.get('month') ||
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' }).format(new Date()).slice(0, 7);
    const classId = searchParams.get('classId');

    // 1. Lấy toàn bộ học viên // 1. Lấy toàn bộ học viên & lớp học ca học
    const [allStudents, allSlots] = await Promise.all([
      repo.getAllStudents(),
      repo.getAllScheduleSlots(),
    ]);

    // Lọc ca học trong tháng
    const slotsInMonth = allSlots.filter(s => s.date.startsWith(month));
    const slotIdsInMonth = new Set(slotsInMonth.map(s => s.id));

    // Sổ điểm danh của tháng: 1 query, không lặp theo lớp (N+1 cũ).
    const records = await repo.getAttendanceByMonth(month);

    // Giữ bản ghi thuộc tháng, hoặc bản ghi gắn ca học của tháng này.
    const typeFiltered = classId && classId !== 'ALL'
      ? records.filter(r => r.classId === classId)
      : records;
    const monthlyRecords = typeFiltered.filter(
      r => r.date.startsWith(month) || slotIdsInMonth.has(r.scheduleSlotId)
    );

    // Gom dữ liệu theo từng student
    const studentMap = new Map<string, Student>();
    allStudents.forEach(st => studentMap.set(st.id, st));

    // Tính toán thống kê theo từng học sinh
    const studentStats: Record<string, {
      studentId: string;
      studentName: string;
      enrolledClasses: string[];
      totalSlots: number;
      presentCount: number;
      lateCount: number;
      excusedCount: number;
      unexcusedCount: number;
      makeupCount: number;
      rate: number; // Tỷ lệ %
    }> = {};

    // Khởi tạo danh sách học viên
    allStudents.forEach(st => {
      if (classId && classId !== 'ALL') {
        if (!st.enrolledClassIds.includes(classId)) return;
      }
      studentStats[st.id] = {
        studentId: st.id,
        studentName: st.name,
        enrolledClasses: st.enrolledClassIds,
        totalSlots: 0,
        presentCount: 0,
        lateCount: 0,
        excusedCount: 0,
        unexcusedCount: 0,
        makeupCount: 0,
        // Chưa có bản ghi điểm danh nào thì chưa thể coi là chuyên cần 100%.
        rate: 0,
      };
    });

    monthlyRecords.forEach(rec => {
      let stat = studentStats[rec.studentId];
      if (!stat) {
        const student = studentMap.get(rec.studentId);
        stat = {
          studentId: rec.studentId,
          studentName: student ? student.name : rec.studentId,
          enrolledClasses: student ? student.enrolledClassIds : [],
          totalSlots: 0,
          presentCount: 0,
          lateCount: 0,
          excusedCount: 0,
          unexcusedCount: 0,
          makeupCount: 0,
          rate: 100,
        };
        studentStats[rec.studentId] = stat;
      }

      stat.totalSlots += 1;
      if (rec.status === 'Có mặt') stat.presentCount += 1;
      else if (rec.status === 'Đi muộn') stat.lateCount += 1;
      else if (rec.status === 'Vắng có phép') stat.excusedCount += 1;
      else if (rec.status === 'Vắng không phép') stat.unexcusedCount += 1;
      else if (rec.status === 'Điểm danh bù') stat.makeupCount += 1;
    });

    // Tính Attendance Rate (%)
    const items = Object.values(studentStats).map(stat => {
      const attended = stat.presentCount + stat.lateCount + stat.makeupCount;
      const rate = stat.totalSlots > 0 
        ? Math.round((attended / stat.totalSlots) * 100) 
        : 100;
      return {
        ...stat,
        rate,
      };
    });

    items.sort((a, b) => a.studentId.localeCompare(b.studentId));

    return NextResponse.json({
      success: true,
      month,
      classId: classId || 'ALL',
      totalStudents: items.length,
      items,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
