import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { StudentService } from '@/services/StudentService';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';
import { teacherTeachesStudent } from '@/lib/auth/studentScope';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;
  if (!isSelfOrStaff(auth.user, id)) {
    return NextResponse.json({ error: 'Không có quyền xem hồ sơ học viên khác' }, { status: 403 });
  }
  if (auth.user.role === 'TEACHER' && !(await teacherTeachesStudent(auth.user.id, id))) {
    return NextResponse.json(
      { error: 'Học viên này không thuộc lớp bạn phụ trách' },
      { status: 403 }
    );
  }

  try {
    const studentId = id;
    const student = await repo.getStudentById(studentId);
    if (!student) {
      return NextResponse.json({ error: 'Không tìm thấy học sinh' }, { status: 404 });
    }

    const enrolledClasses = await repo.getClassesByStudentId(studentId);
    return NextResponse.json({
      student: {
        ...student,
        enrolledClassIds: enrolledClasses.map(c => c.id),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi server' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;
  if (!isSelfOrStaff(auth.user, id)) {
    return NextResponse.json({ error: 'Không có quyền sửa hồ sơ học viên khác' }, { status: 403 });
  }
  // `isSelfOrStaff` cho TEACHER luôn true — chặn thêm theo lớp/ca thực tế.
  if (auth.user.role === 'TEACHER' && !(await teacherTeachesStudent(auth.user.id, id))) {
    return NextResponse.json(
      { error: 'Học viên này không thuộc lớp bạn phụ trách' },
      { status: 403 }
    );
  }

  try {
    const studentId = id;
    const body = await request.json();
    const full = body;
    const {
      actorId, actorRole, phone, address, name,
      status, homeTown, gradeLevel, targetUniversity, customUniversity, examBlock,
      studyGoal, facebookUrl, otherNotes, registeredDate, parentPhone, assignmentUrl,
      dateOfBirth, gender,
      remainingSessions, totalSessionsInMonth, attendedSessionsInMonth, absentSessionsInMonth,
    } = full;

    // Học viên tự sửa hồ sơ: chỉ các trường cá nhân, không đụng hạn mức/học phí/trạng thái.
    if (auth.user.role === 'STUDENT') {
      const forbidden = [
        status, registeredDate, remainingSessions, totalSessionsInMonth,
        attendedSessionsInMonth, absentSessionsInMonth, actorRole,
      ];
      if (forbidden.some((v) => v !== undefined)) {
        return NextResponse.json(
          { error: 'Học viên không được sửa trạng thái, hạn mức buổi học hoặc phân quyền' },
          { status: 403 }
        );
      }
    }

    const student = await repo.getStudentById(studentId);
    if (!student) {
      return NextResponse.json({ error: 'Không tìm thấy học sinh' }, { status: 404 });
    }

    const studentService = new StudentService(repo);

    // Cập nhật các trường thông tin cơ bản khác nếu có gửi kèm
    let needUpdate = false;
    if (phone !== undefined) {
      student.phone = phone.trim();
      needUpdate = true;
    }
    if (address !== undefined) {
      student.address = address.trim();
      needUpdate = true;
    }
    if (name !== undefined) {
      student.name = name.trim();
      needUpdate = true;
    }
    if (status !== undefined) {
      student.status = status;
      needUpdate = true;
    }
    if (homeTown !== undefined) { student.homeTown = homeTown.trim(); needUpdate = true; }
    if (gradeLevel !== undefined) { student.gradeLevel = gradeLevel; needUpdate = true; }
    if (targetUniversity !== undefined) { student.targetUniversity = targetUniversity; needUpdate = true; }
    if (customUniversity !== undefined) { student.customUniversity = customUniversity.trim(); needUpdate = true; }
    if (examBlock !== undefined) { student.examBlock = examBlock; needUpdate = true; }
    if (studyGoal !== undefined) { student.studyGoal = studyGoal.trim(); needUpdate = true; }
    if (facebookUrl !== undefined) { student.facebookUrl = facebookUrl.trim(); needUpdate = true; }
    if (otherNotes !== undefined) { student.otherNotes = otherNotes.trim(); needUpdate = true; }
    if (parentPhone !== undefined) { student.parentPhone = parentPhone.trim(); needUpdate = true; }
    if (dateOfBirth !== undefined) { student.dateOfBirth = dateOfBirth; needUpdate = true; }
    if (gender !== undefined) { student.gender = gender; needUpdate = true; }
    if (assignmentUrl !== undefined) { student.assignmentUrl = assignmentUrl.trim(); needUpdate = true; }
    if (registeredDate !== undefined) { student.registeredDate = registeredDate; needUpdate = true; }
    if (remainingSessions !== undefined) { student.remainingSessions = Number(remainingSessions); needUpdate = true; }
    if (totalSessionsInMonth !== undefined) { student.totalSessionsInMonth = Number(totalSessionsInMonth); needUpdate = true; }
    if (attendedSessionsInMonth !== undefined) { student.attendedSessionsInMonth = Number(attendedSessionsInMonth); needUpdate = true; }
    if (absentSessionsInMonth !== undefined) { student.absentSessionsInMonth = Number(absentSessionsInMonth); needUpdate = true; }

    if (needUpdate) {
      await repo.updateStudent(student);

      // Đồng bộ ngược lại bảng Users nếu có thay đổi tên
      try {
        const u = await repo.getUserById(studentId);
        if (u) {
          let uChanged = false;
          if (name && u.name !== name.trim()) { u.name = name.trim(); uChanged = true; }
          if (uChanged) await repo.updateUser(u);
        }
      } catch (err) {
        console.error('[SYNC-STUDENT-TO-USER-ERROR]:', err);
      }
    }

    const updatedStudent = await repo.getStudentById(studentId);

    return NextResponse.json({
      success: true,
      student: updatedStudent,
      message: `Cập nhật thông tin học sinh [${studentId}] thành công`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi cập nhật học sinh' }, { status: 500 });
  }
}
