import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { MAX_STUDENT_PAGE_LIMIT } from '@/repositories/IRepository';
import { StudentService } from '@/services/StudentService';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';


export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);

  // Học viên chỉ đọc được hồ sơ của chính mình: danh sách học viên chứa SĐT,
  // phụ huynh, địa chỉ, ngày sinh. Trước đây STUDENT gọi `?limit=all` là lấy
  // được toàn bộ bảng, và `?id=<người khác>` là đọc được hồ sơ bất kỳ ai.
  if (auth.user.role === 'STUDENT') {
    const requestedId = searchParams.get('id');
    // Gọi trần (không id) = đọc hồ sơ của chính mình; id của người khác thì chặn.
    if (requestedId && !isSelfOrStaff(auth.user, requestedId)) {
      return NextResponse.json(
        { error: 'Không có quyền xem hồ sơ học viên khác' },
        { status: 403 }
      );
    }
    try {
      const student = await repo.getStudentById(auth.user.id);
      if (!student) return NextResponse.json({ student: null });
      const enrolledClasses = await repo.getClassesByStudentId(auth.user.id);
      return NextResponse.json({
        student: { ...student, enrolledClassIds: enrolledClasses.map(c => c.id) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi khi tải học viên';
      return NextResponse.json({ student: null, error: message }, { status: 500 });
    }
  }

  const id = searchParams.get('id');
  const search = searchParams.get('search')?.toLowerCase();
  const status = searchParams.get('status');
  const uni = searchParams.get('uni');
  const limitParam = searchParams.get('limit');
  const page = parseInt(searchParams.get('page') || '1', 10);
  // limit=all dùng cho các ô chọn học sinh (hoá đơn, đơn từ) cần đủ danh sách,
  // nhưng vẫn bị chặn trần: một request không được kéo cả bảng (và bỏ `range()`).
  const parsedLimit = parseInt(limitParam || '50', 10);
  const limit = limitParam === 'all'
    ? MAX_STUDENT_PAGE_LIMIT
    : Math.min(MAX_STUDENT_PAGE_LIMIT, Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50);

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
    const { students, total } = await repo.getStudentsPage({
      search,
      page,
      limit,
      all: limitParam === 'all',
      status: status || undefined,
      uni: uni || undefined,
    });

    return NextResponse.json({
      students,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải danh sách học viên';
    return NextResponse.json({ students: [], total: 0, page, totalPages: 0, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const {
      name,
      phone,
      dateOfBirth,
      gender = 'Nam',
      address,
      enrolledClassIds = [],
      fastOnboarding = false,
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
      actorRole: auth.user.role,
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
        if (!cls || cls.studentIds.includes(student.id)) continue;
        cls.studentIds.push(student.id);
        await repo.updateClass(cls);
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
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

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
      userId: auth.user.id,
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
