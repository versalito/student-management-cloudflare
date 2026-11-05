import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { StudentService } from '@/services/StudentService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const search = searchParams.get('search') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  if (id) {
    try {
      const student = await repo.getStudentById(id);
      if (!student) return NextResponse.json({ student: null });
      const enrolledClasses = await repo.getClassesByStudentId(id);
      return NextResponse.json({
        student: { ...student, enrolledClassIds: enrolledClasses.map(c => c.id) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi khi tải học viên';
      return NextResponse.json({ student: null, error: message }, { status: 500 });
    }
  }

  // Đọc thuần: lọc `search` + phân trang ở tầng dữ liệu (1 query + count),
  // kèm lớp ghi danh embed. Việc đối soát hồ sơ thiếu chuyển sang
  // POST /api/admin/reconcile (npm run db:reconcile) — không ghi trong GET.
  try {
    const { students, total } = await repo.getStudentsPage({ search, page, limit });

    return NextResponse.json({
      students,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải danh sách học viên';
    return NextResponse.json({ students: [], total: 0, page, totalPages: 0, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      phone,
      dateOfBirth,
      gender = 'Nam',
      email,
      address,
      enrolledClassIds = [],
      fastOnboarding = false,
      actorId = 'ADMIN001',
      actorName = 'Quản trị viên',
      homeTown,
      gradeLevel = 'Lớp 12',
      targetUniversity = 'HAU',
      customUniversity,
      examBlock = 'KHOI_V',
      studyGoal,
      parentPhone,
      facebookUrl,
      otherNotes,
      totalSessionsInMonth = 12,
      remainingSessions = 12,
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Vui lòng cung cấp họ và tên học sinh' }, { status: 400 });
    }

    const studentService = new StudentService(repo);

    // Hỗ trợ Fast Onboarding hoặc Full Form
    const result = await studentService.createStudentFastOnboarding({
      name: name.trim(),
      phone: phone || '',
      actorId,
      actorName,
    });

    const student = result.student;

    // Nếu form gửi các trường mở rộng (ngày sinh, giới tính, địa chỉ, lớp học...)
    let updatedDetails = false;
    if (dateOfBirth && dateOfBirth !== '2008-01-01') {
      student.dateOfBirth = dateOfBirth;
      updatedDetails = true;
    }
    if (gender && gender !== 'Nam') {
      student.gender = gender;
      updatedDetails = true;
    }
    if (address && address !== 'TP. Hồ Chí Minh') {
      student.address = address;
      updatedDetails = true;
    }
    if (email && email.trim()) {
      student.email = email.trim();
      updatedDetails = true;
    }

    if (homeTown) { student.homeTown = homeTown.trim(); updatedDetails = true; }
    if (gradeLevel) { student.gradeLevel = gradeLevel; updatedDetails = true; }
    if (targetUniversity) { student.targetUniversity = targetUniversity; updatedDetails = true; }
    if (customUniversity) { student.customUniversity = customUniversity.trim(); updatedDetails = true; }
    if (examBlock) { student.examBlock = examBlock; updatedDetails = true; }
    if (studyGoal) { student.studyGoal = studyGoal.trim(); updatedDetails = true; }
    if (parentPhone) { student.parentPhone = parentPhone.trim(); updatedDetails = true; }
    if (facebookUrl) { student.facebookUrl = facebookUrl.trim(); updatedDetails = true; }
    if (otherNotes) { student.otherNotes = otherNotes.trim(); updatedDetails = true; }
    student.totalSessionsInMonth = Number(totalSessionsInMonth) || 12;
    student.remainingSessions = Number(remainingSessions) || 12;
    student.attendedSessionsInMonth = 0;
    student.absentSessionsInMonth = 0;
    updatedDetails = true;

    if (updatedDetails) {
      await repo.updateStudent(student);
    }

    // Gán học sinh vào các lớp nếu có chọn
    if (enrolledClassIds && Array.isArray(enrolledClassIds) && enrolledClassIds.length > 0) {
      for (const classId of enrolledClassIds) {
        const cls = await repo.getClassById(classId);
        if (cls && !cls.studentIds.includes(student.id)) {
          cls.studentIds.push(student.id);
          await repo.updateClass(cls);
        }
      }
      student.enrolledClassIds = enrolledClassIds;
    }

    return NextResponse.json({
      success: true,
      student,
      defaultPassword: result.defaultPassword,
      message: `Thêm học viên ${student.id} (${student.name}) thành công`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi tạo học viên' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Thiếu mã học viên cần xoá' }, { status: 400 });
    }

    const student = await repo.getStudentById(id);
    if (!student) {
      return NextResponse.json({ error: 'Không tìm thấy học viên' }, { status: 404 });
    }

    // Xoá học viên khỏi các lớp học liên quan
    for (const classId of student.enrolledClassIds || []) {
      const cls = await repo.getClassById(classId);
      if (cls) {
        cls.studentIds = cls.studentIds.filter(stId => stId !== id);
        await repo.updateClass(cls);
      }
    }

    await repo.deleteStudent(id);

    // Cũng có thể xóa hoặc khóa tài khoản user tương ứng nếu có
    try {
      await repo.deleteUser(id);
    } catch (e) {
      // bỏ qua nếu không có user
    }

    await repo.addAuditLog({
      action: 'DELETE',
      userId: 'ADMIN001',
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'STUDENT',
      targetId: id,
      details: `Xoá học viên ${id} - ${student.name}`,
    });

    return NextResponse.json({ success: true, message: `Đã xoá học viên ${id} (${student.name})` });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi xoá học viên' }, { status: 500 });
  }
}
