import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { ClassSection } from '@/types/classroom';
import { ScheduleSlot } from '@/types/schedule';
import { getTodayDateStr, dateToDayOfWeek } from '@/utils/date';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Học viên không được thấy mã học viên của cả lớp: chỉ số lượng + ca của mình. */
function toStudentView(sec: ClassSection, studentId: string) {
  const { studentIds, studentScheduleDays, ...rest } = sec;
  return {
    ...rest,
    studentCount: studentIds?.length ?? 0,
    isMine: (studentIds || []).includes(studentId),
    myScheduleDays: studentScheduleDays?.[studentId],
  };
}

/**
 * Giáo viên chỉ cần mã học viên của ca mình dạy (để mở sổ điểm danh); ca của
 * lớp/giáo viên khác chỉ cần sĩ số để biết ca còn trống mà nhận. Trước đây
 * `?all=true` trả nguyên `studentIds` của mọi ca trong trung tâm.
 */
function toTeacherView(sec: ClassSection, teacherId: string) {
  const isOwn = sec.teacherId === teacherId;
  if (isOwn) return sec;
  const { studentIds, studentScheduleDays: _studentScheduleDays, ...rest } = sec;
  return { ...rest, studentCount: studentIds?.length ?? 0 };
}

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const classId = searchParams.get('classId');
  const studentId = searchParams.get('studentId');
  const teacherId = searchParams.get('teacherId');
  const id = searchParams.get('id');
  const classIdsParam = searchParams.get('classIds');
  const all = searchParams.get('all');

  // Học viên chỉ xem được ca của lớp (để chọn ca đăng ký) và ca của chính mình;
  // không được kéo ca của một học viên khác hay toàn bộ ca của trung tâm.
  const isStudent = auth.user.role === 'STUDENT';
  const isTeacher = auth.user.role === 'TEACHER';
  /** Áp phạm vi hiển thị theo vai trò cho một ca. */
  const view = (sec: ClassSection) =>
    isStudent
      ? toStudentView(sec, auth.user.id)
      : isTeacher
        ? toTeacherView(sec, auth.user.id)
        : sec;
  if (isStudent) {
    if ((studentId && !isSelfOrStaff(auth.user, studentId)) || all === 'true') {
      return NextResponse.json(
        { error: 'Không có quyền xem ca học của người khác' },
        { status: 403 }
      );
    }
    if (id) {
      const sec = await repo.getSectionById(id);
      if (!sec) return NextResponse.json({ section: null });
      const owns = (sec.studentIds || []).includes(auth.user.id);
      const classWide = classId ? sec.classId === classId : false;
      if (!owns && !classWide) {
        return NextResponse.json(
          { error: 'Không có quyền xem ca học này' },
          { status: 403 }
        );
      }
      return NextResponse.json({ section: toStudentView(sec, auth.user.id) });
    }
  }

  if (id) {
    const sec = await repo.getSectionById(id);
    return NextResponse.json({ section: sec ? view(sec) : sec });
  }
  if (all === 'true') {
    const sections = await repo.getAllClassSections();
    return NextResponse.json({ sections: sections.map(view) });
  }
  if (classIdsParam) {
    const ids = classIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
    const sectionsByClass: Record<string, ClassSection[]> = {};
    for (const cid of ids) {
      const secs = await repo.getClassSections(cid);
      // Học viên xem ca để chọn/đổi ca: cần biết mình có trong ca không và ca
      // đông bao nhiêu, không cần mã học viên của cả lớp.
      sectionsByClass[cid] = secs.map(view);
    }
    return NextResponse.json({ sectionsByClass });
  }
  if (classId) {
    const sections = await repo.getClassSections(classId);
    return NextResponse.json({ sections: sections.map(view) });
  }
  if (studentId) {
    const sections = await repo.getSectionsByStudentId(studentId);
    return NextResponse.json({ sections: sections.map(view) });
  }
  if (teacherId) {
    const sections = await repo.getSectionsByTeacherId(teacherId);
    return NextResponse.json({ sections: sections.map(view) });
  }
  return NextResponse.json({ error: 'Thiếu classId, studentId hoặc teacherId' }, { status: 400 });
}

export async function POST(request: Request) {
  // Tạo ca là thao tác cấu trúc lớp: chỉ quản trị. Giáo viên vẫn nhận ca có sẵn
  // qua PUT (claim) — xem nhánh quyền bên dưới.
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { classId, name, shiftId, startTime, endTime, scheduleDays, teacherId } = body;
    if (!classId) {
      return NextResponse.json({ error: 'Thiếu classId' }, { status: 400 });
    }
    const cls = await repo.getClassById(classId);
    if (!cls) return NextResponse.json({ error: 'Không tìm thấy lớp học' }, { status: 404 });

    const existing = await repo.getClassSections(classId);
    const n = existing.length + 1;
    const id = 'SEC_' + classId + '_' + Date.now().toString().slice(-5);
    const startTimeResolved = startTime || cls.startTime || '18:30';
    const endTimeResolved = endTime || cls.endTime || '20:30';
    const section: ClassSection = {
      id,
      classId,
      name: name || 'Ca ' + n + ' (' + startTimeResolved + ' - ' + endTimeResolved + ')',
      shiftId: shiftId !== undefined ? Number(shiftId) : cls.shiftId,
      startTime: startTimeResolved,
      endTime: endTimeResolved,
      scheduleDays: Array.isArray(scheduleDays) ? scheduleDays.map(Number) : (cls.scheduleDays || []),
      teacherId: teacherId || cls.teacherId,
      isActive: true,
      studentIds: [],
    };
    await repo.createClassSection(section);
    return NextResponse.json({ success: true, section });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi tạo ca học';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;

  try {
    const body = await request.json();
    const {
      sectionId,
      name,
      shiftId,
      startTime,
      endTime,
      scheduleDays,
      teacherId,
      isActive,
      syncFutureSlots = true,
    } = body;
    if (!sectionId) return NextResponse.json({ error: 'Thiếu sectionId' }, { status: 400 });
    const sec = await repo.getSectionById(sectionId);
    if (!sec) return NextResponse.json({ error: 'Không tìm thấy ca học' }, { status: 404 });

    // Giáo viên chỉ thao tác trên ca mình phụ trách, và chỉ được "nhận ca"
    // (ca chưa phân công) hoặc sửa giờ/thứ của ca mình. Không được gán ca sang
    // giáo viên khác hay cướp ca đã có người — trước đây mọi TEACHER làm được
    // cả hai, kể cả đổi giáo viên của lớp người khác.
    if (auth.user.role === 'TEACHER') {
      const isUnassigned =
        !sec.teacherId || sec.teacherId === 'CHUA_PHAN_CONG' || sec.teacherId === '';
      const isOwn = sec.teacherId === auth.user.id;
      const claimsSelf = teacherId === auth.user.id;
      if (!isUnassigned && !isOwn) {
        return NextResponse.json(
          { error: 'Ca này đã được phân công cho giáo viên khác' },
          { status: 403 }
        );
      }
      if (teacherId !== undefined && !claimsSelf) {
        return NextResponse.json(
          { error: 'Bạn chỉ có thể nhận ca cho chính mình' },
          { status: 403 }
        );
      }
    }

    const oldTeacherId = sec.teacherId;
    const oldScheduleDays = sec.scheduleDays;
    if (name !== undefined) sec.name = name.trim();
    if (shiftId !== undefined) sec.shiftId = Number(shiftId);
    if (startTime !== undefined) sec.startTime = startTime;
    if (endTime !== undefined) sec.endTime = endTime;
    if (scheduleDays !== undefined && Array.isArray(scheduleDays)) sec.scheduleDays = scheduleDays.map(Number);
    if (teacherId !== undefined) sec.teacherId = teacherId || undefined;
    if (isActive !== undefined) sec.isActive = Boolean(isActive);
    await repo.updateClassSection(sec);

    // Khi đổi giáo viên của một ca: cập nhật assignedClassIds cho giáo viên cũ/mới
    // (chỉ khi chưa có ca nào khác của lớp đó do giáo viên này phụ trách).
    if (teacherId !== undefined && teacherId !== oldTeacherId) {
      const sectionsOfClass = await repo.getClassSections(sec.classId);
      if (teacherId && oldTeacherId && oldTeacherId !== teacherId) {
        const oldTeacher = await repo.getTeacherById(oldTeacherId);
        if (oldTeacher && Array.isArray(oldTeacher.assignedClassIds)) {
          const stillTeachingClass = sectionsOfClass.some(
            (s) => s.id !== sec.id && s.teacherId === oldTeacherId && s.isActive !== false
          );
          if (!stillTeachingClass) {
            oldTeacher.assignedClassIds = oldTeacher.assignedClassIds.filter((cid) => cid !== sec.classId);
            await repo.updateTeacher(oldTeacher);
          }
        }
      }
      if (teacherId) {
        const newTeacher = await repo.getTeacherById(teacherId);
        if (newTeacher) {
          if (!newTeacher.assignedClassIds) newTeacher.assignedClassIds = [];
          if (!newTeacher.assignedClassIds.includes(sec.classId)) {
            newTeacher.assignedClassIds.push(sec.classId);
            await repo.updateTeacher(newTeacher);
          }
        }
      }
    }

    // Đồng bộ các buổi học tương lai thuộc ca này (theo sectionId) lên thông tin mới.
    let syncedSlotsCount = 0;
    if (syncFutureSlots) {
      const today = getTodayDateStr();
      const allSlots = await repo.getAllScheduleSlots();
      const slotsToUpdate: ScheduleSlot[] = [];
      const daysChanged =
        scheduleDays !== undefined &&
        JSON.stringify(scheduleDays.map(Number)) !== JSON.stringify(oldScheduleDays || []);

      for (const slot of allSlots) {
        if (slot.sectionId !== undefined && slot.sectionId !== "" && slot.sectionId !== sec.id) continue;
        if ((slot.sectionId === undefined || slot.sectionId === "") && slot.classId !== sec.classId) continue;
        if (slot.date < today || slot.status === "Đã hủy") continue;

        let changed = false;
        if (teacherId !== undefined && slot.teacherId !== teacherId) {
          slot.teacherId = teacherId || sec.teacherId || slot.teacherId;
          changed = true;
        }
        if (startTime !== undefined && slot.startTime !== startTime) {
          slot.startTime = startTime;
          changed = true;
        }
        if (endTime !== undefined && slot.endTime !== endTime) {
          slot.endTime = endTime;
          changed = true;
        }
        if (shiftId !== undefined && slot.shiftId !== Number(shiftId)) {
          slot.shiftId = Number(shiftId);
          changed = true;
        }
        if (slot.sectionId !== sec.id) {
          slot.sectionId = sec.id;
          changed = true;
        }

        // Khi thay đổi thứ: slot cũ không thuộc thứ mới thì hủy
        if (daysChanged) {
          const dow = dateToDayOfWeek(slot.date);
          if (dow && !(sec.scheduleDays || []).includes(dow)) {
            slot.status = "Đã hủy";
            changed = true;
          }
        }

        if (changed) {
          slotsToUpdate.push(slot);
        }
      }

      if (slotsToUpdate.length > 0) {
        await repo.updateScheduleSlotsBatch(slotsToUpdate);
      }
      syncedSlotsCount = slotsToUpdate.length;

      
    }

    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actorId,
      userName: auth.user.name,
      userRole: 'ADMIN',
      targetResource: 'CLASS_SECTION',
      targetId: sec.id,
      details: `Cập nhật ca ${sec.id} (${sec.name}) lớp ${sec.classId}; đồng bộ ${syncedSlotsCount} buổi học tương lai`,
    });

    return NextResponse.json({ success: true, section: sec, syncedSlotsCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi cập nhật ca học';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const actorId = auth.user.id;
    if (!id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });
    const sec = await repo.getSectionById(id);
    if (!sec) return NextResponse.json({ error: 'Không tìm thấy ca học' }, { status: 404 });

    // Hủy các buổi học tương lai của ca thay vì xóa cứng, dùng batch update để tránh lỗi subrequests.
    const today = getTodayDateStr();
    const allSlots = await repo.getAllScheduleSlots();
    let cancelledSlotsCount = 0;
    const slotsToCancel: ScheduleSlot[] = [];
    for (const slot of allSlots) {
      if (slot.sectionId !== id) continue;
      if (slot.date < today || slot.status === "Đã hủy") continue;
      slot.status = "Đã hủy";
      slotsToCancel.push(slot);
      cancelledSlotsCount++;
    }
    if (slotsToCancel.length > 0) {
      await repo.updateScheduleSlotsBatch(slotsToCancel);
    }

    // Nếu giáo viên của ca không còn ca nào khác trong lớp thì gỡ lớp khỏi assignedClassIds.
    if (sec.teacherId) {
      const remainSections = await repo.getClassSections(sec.classId);
      const stillTeaching = remainSections.some(
        (s) => s.id !== sec.id && s.teacherId === sec.teacherId && s.isActive !== false
      );
      if (!stillTeaching) {
        const teacher = await repo.getTeacherById(sec.teacherId);
        if (teacher && Array.isArray(teacher.assignedClassIds)) {
          teacher.assignedClassIds = teacher.assignedClassIds.filter((cid) => cid !== sec.classId);
          await repo.updateTeacher(teacher);
        }
      }
    }

    await repo.deleteClassSection(id);

    // Đồng bộ lại danh sách học viên lớp (class_students) = hợp các ca còn lại,
    // tránh class.studentIds bị lệch so với membership theo ca.
    const remainingSections = await repo.getClassSections(sec.classId);
    const unionIds = new Set<string>();
    for (const rs of remainingSections) {
      for (const sid of rs.studentIds || []) unionIds.add(sid);
    }
    const clsAfter = await repo.getClassById(sec.classId);
    if (clsAfter) {
      clsAfter.studentIds = Array.from(unionIds);
      await repo.updateClass(clsAfter);
    }

    await repo.addAuditLog({
      action: 'DELETE',
      userId: actorId,
      userName: auth.user.name,
      userRole: 'ADMIN',
      targetResource: 'CLASS_SECTION',
      targetId: id,
      details: `Xóa ca ${id} (${sec.name}) lớp ${sec.classId}; hủy ${cancelledSlotsCount} buổi học tương lai`,
    });

    return NextResponse.json({ success: true, cancelledSlotsCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi ca học';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
