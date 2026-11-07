import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { ClassRequest } from '@/types/schedule';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const teacherId = searchParams.get('teacherId');

  // Học viên chỉ xem đơn của chính mình; giáo viên chỉ xem đơn thuộc lớp mình phụ trách.
  if (auth.user.role === 'STUDENT' && !isSelfOrStaff(auth.user, studentId)) {
    return NextResponse.json({ error: 'Không có quyền xem đơn từ của học viên khác' }, { status: 403 });
  }

  let requests = await repo.getAllRequests();

  // Giáo viên không truyền `teacherId` trước đây nhận TOÀN BỘ đơn của trung tâm
  // (gồm đơn của lớp mình không phụ trách), chỉ khi tự truyền `teacherId` mới
  // được lọc. Ép phạm vi theo chính mình giống các route khác.
  if (auth.user.role === 'TEACHER') {
    const ownClasses = await repo.getClassesByTeacherId(auth.user.id);
    const ownSections = await repo.getSectionsByTeacherId(auth.user.id);
    const classIds = new Set<string>([
      ...ownClasses.map((c) => c.id),
      ...ownSections.map((sec) => sec.classId),
    ]);
    requests = requests.filter((r) => classIds.has(r.classId));
  }
  // Gộp sẵn tên học sinh vào response để portal giáo viên không phải gọi thêm /api/students?limit=all.
  const allStudents = await repo.getAllStudents();
  const studentNameMap = new Map(allStudents.map(s => [s.id, s.name]));
  if (studentId) {
    requests = requests.filter(r => r.studentId === studentId);
  }
  if (teacherId) {
    if (auth.user.role === 'TEACHER' && teacherId !== auth.user.id) {
      return NextResponse.json({ error: 'Giáo viên chỉ xem đơn thuộc lớp mình phụ trách' }, { status: 403 });
    }
    const teacherClasses = await repo.getClassesByTeacherId(teacherId);
    const classIds = new Set(teacherClasses.map(c => c.id));
    // Giáo viên có thể chỉ phụ trách một ca (class_sections) của lớp đa giáo viên;
    // hợp thêm lớp từ các ca mà giáo viên đó đảm nhận.
    const teacherSections = await repo.getSectionsByTeacherId(teacherId);
    for (const sec of teacherSections) classIds.add(sec.classId);
    requests = requests.filter(r => classIds.has(r.classId));
  }

  // Sắp xếp đơn mới nhất lên đầu
  requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({
    requests: requests.map(r => ({
      ...r,
      studentName: studentNameMap.get(r.studentId) || r.studentId,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    if (body.action === 'DECIDE') {
      if (auth.user.role === 'STUDENT') {
        return NextResponse.json({ success: false, error: 'Học viên không được duyệt đơn' }, { status: 403 });
      }

      const existing = await repo.getRequestById(body.requestId);
      if (!existing) {
        return NextResponse.json({ success: false, error: 'Không tìm thấy yêu cầu' }, { status: 404 });
      }

      // Giáo viên chỉ duyệt đơn thuộc lớp mình phụ trách.
      if (auth.user.role === 'TEACHER') {
        const ownClasses = await repo.getClassesByTeacherId(auth.user.id);
        const ownSections = await repo.getSectionsByTeacherId(auth.user.id);
        const classIds = new Set<string>([
          ...ownClasses.map((c) => c.id),
          ...ownSections.map((sec) => sec.classId),
        ]);
        if (!classIds.has(existing.classId)) {
          return NextResponse.json(
            { success: false, error: 'Giáo viên chỉ duyệt đơn thuộc lớp mình phụ trách' },
            { status: 403 }
          );
        }
      }

      const reviewerRole = auth.user.role;
      const reviewerName = auth.user.name;

      existing.status = body.status; // 'ĐÃ_DUYỆT' | 'TỪ_CHỐI'
      existing.reviewedBy = auth.user.id;
      existing.reviewNote = body.reviewNote;
      const updated = await repo.updateRequest(existing);

      // Duyệt đơn xin nghỉ: tự động ghi 'Vắng có phép' vào sổ điểm danh của ca tương ứng.
      if (body.status === 'ĐÃ_DUYỆT' && existing.scheduleSlotId && existing.type !== 'DOI_CA') {
        try {
          const slot = await repo.getScheduleSlotById(existing.scheduleSlotId);
          if (slot) {
            const records = await repo.getAttendanceBySlotId(slot.id);
            const found = records.find((r) => r.studentId === existing.studentId);
            await repo.saveAttendanceRecord({
              id: found?.id || `ATT_EXCUSED_${slot.id}_${existing.studentId}`,
              scheduleSlotId: slot.id,
              classId: slot.classId,
              studentId: existing.studentId,
              date: slot.date,
              status: 'Vắng có phép',
              note: `Nghỉ có phép theo đơn ${existing.id}`,
              method: 'SYSTEM',
              updatedBy: auth.user.id,
              updatedAt: new Date().toISOString(),
            });
         }
      } catch (attErr) {
        console.warn('[REQUEST-DECIDE] Không ghi được điểm danh vắng có phép:', attErr);
      }
    }

    // Duyệt đơn đổi ca (DOI_CA): chuyển học viên từ ca hiện tại sang ca đích trong cùng lớp,
    // rồi đồng bộ lại danh sách học viên của lớp (hợp học viên của mọi ca).
    if (body.status === 'ĐÃ_DUYỆT' && existing.type === 'DOI_CA') {
      try {
        const fromSlot = existing.scheduleSlotId
          ? await repo.getScheduleSlotById(existing.scheduleSlotId)
          : null;
        const toSlot = existing.targetScheduleSlotId
          ? await repo.getScheduleSlotById(existing.targetScheduleSlotId)
          : null;
        if (fromSlot && toSlot && toSlot.id !== fromSlot.id) {
          if (fromSlot.sectionId) {
            await repo.removeStudentFromSection(fromSlot.sectionId, existing.studentId);
          }
          if (toSlot.sectionId) {
            await repo.addStudentToSection(toSlot.sectionId, existing.studentId);
          }
          const sections = await repo.getClassSections(existing.classId);
          const unionIds = new Set<string>();
          for (const sec of sections) {
            for (const sid of sec.studentIds || []) unionIds.add(sid);
          }
          const cls = await repo.getClassById(existing.classId);
          if (cls) {
            cls.studentIds = Array.from(unionIds);
            await repo.updateClass(cls);
          }
        }
      } catch (shiftErr) {
        console.warn('[REQUEST-DECIDE] Không đổi ca được:', shiftErr);
      }
    }

    await repo.addAuditLog({
      userId: auth.user.id,
      userName: reviewerName,
      userRole: reviewerRole,
      action: 'REQUEST_DECIDE',
      targetResource: 'REQUEST',
      targetId: existing.id,
      details: `${body.status === 'ĐÃ_DUYỆT' ? 'Duyệt' : 'Từ chối'} đơn ${existing.type === 'DOI_CA' ? 'đổi ca' : 'xin nghỉ'} của học viên ${existing.studentId}`,
    });

      return NextResponse.json({ success: true, request: updated });
    }

    // Tạo đơn mới
    if (!isSelfOrStaff(auth.user, body.studentId)) {
      return NextResponse.json({ success: false, error: 'Chỉ được tạo đơn cho chính mình' }, { status: 403 });
    }
    const all = await repo.getAllRequests();
    const newId = `REQ${(all.length + 1).toString().padStart(3, '0')}`;
    const newRequest: ClassRequest = {
      id: newId,
      studentId: body.studentId,
      classId: body.classId,
      scheduleSlotId: body.scheduleSlotId,
      targetScheduleSlotId: body.targetScheduleSlotId || undefined,
      type: body.type,
      reason: body.reason,
      status: 'CHỜ_DUYỆT',
      createdAt: new Date().toISOString(),
    };
    const saved = await repo.createRequest(newRequest);

    await repo.addAuditLog({
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
      action: 'CREATE',
      targetResource: 'REQUEST',
      targetId: newId,
      details: `Gửi đơn xin nghỉ học lớp ${body.classId}`,
    });

    return NextResponse.json({ success: true, request: saved });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
