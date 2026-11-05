import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { BulkScheduleService } from '@/services/BulkScheduleService';
import { ShiftService } from '@/services/ShiftService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get('teacherId');
  const studentId = searchParams.get('studentId');
  const id = searchParams.get('id');

  try {
    if (id) {
      const cls = await repo.getClassById(id);
      return NextResponse.json({ class: cls });
    }

    // Lọc ở tầng dữ liệu (1–2 query) thay vì đọc toàn bộ lớp + ghi danh rồi lọc JS.
    let classes;
    if (studentId) {
      classes = await repo.getClassesByStudentId(studentId);
    } else if (teacherId) {
      classes = await repo.getClassesByTeacherId(teacherId);
    } else {
      classes = await repo.getAllClasses();
    }

    return NextResponse.json({ classes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải lớp học';
    return NextResponse.json({ classes: [], error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const {
      classId,
      name,
      code,
      subject,
      teacherId,
      roomId = "ONLINE",
      shiftId,
      startTime,
      endTime,
      scheduleDays,
      isRecurring,
      tuitionFee,
      meetingLink,
      actorId = 'ADMIN001'
    } = body;

    if (!classId) {
      return NextResponse.json({ error: 'Thiếu thông tin classId' }, { status: 400 });
    }

    const cls = await repo.getClassById(classId);
    if (!cls) {
      return NextResponse.json({ error: 'Không tìm thấy lớp học' }, { status: 404 });
    }

    let oldTeacherId = cls.teacherId;
    let newTeacher = null;

    if (name !== undefined) cls.name = name.trim();
    if (code !== undefined) cls.code = code.trim().toUpperCase();
    if (subject !== undefined) cls.subject = subject.trim();
    if (tuitionFee !== undefined) cls.tuitionFee = Number(tuitionFee);

    if (teacherId && teacherId !== oldTeacherId) {
      newTeacher = await repo.getTeacherById(teacherId);
      if (!newTeacher) {
        return NextResponse.json({ error: 'Không tìm thấy giảng viên được chỉ định' }, { status: 404 });
      }
      cls.teacherId = teacherId;
    }

    if (roomId !== undefined) {
      cls.roomId = roomId;
    }

    if (shiftId !== undefined) {
      cls.shiftId = Number(shiftId);
    }

    if (startTime !== undefined) {
      cls.startTime = startTime;
    }

    if (endTime !== undefined) {
      cls.endTime = endTime;
    }

    if (scheduleDays !== undefined && Array.isArray(scheduleDays)) {
      cls.scheduleDays = scheduleDays.map(Number);
    }

    if (isRecurring !== undefined) {
      cls.isRecurring = Boolean(isRecurring);
    }

    if (meetingLink !== undefined) {
      cls.meetingLink = meetingLink;
    }

    await repo.updateClass(cls);

    // 2. Cập nhật danh sách assignedClassIds của giáo viên cũ và mới (nếu đổi GV)
    if (teacherId && teacherId !== oldTeacherId && newTeacher) {
      if (oldTeacherId) {
        const oldTeacher = await repo.getTeacherById(oldTeacherId);
        if (oldTeacher && oldTeacher.assignedClassIds) {
          oldTeacher.assignedClassIds = oldTeacher.assignedClassIds.filter(cid => cid !== classId);
          await repo.updateTeacher(oldTeacher);
        }
      }

      if (!newTeacher.assignedClassIds) newTeacher.assignedClassIds = [];
      if (!newTeacher.assignedClassIds.includes(classId)) {
        newTeacher.assignedClassIds.push(classId);
        await repo.updateTeacher(newTeacher);
      }
    }

    // 3. Đồng bộ 2 chiều: Khi Admin đổi teacherId, roomId: roomId || "ONLINE", startTime, endTime, scheduleDays, shiftId, hoặc meetingLink:
    // Quét tất cả ScheduleSlot của lớp đó có date >= today, cập nhật các thuộc tính mới
    const today = new Date().toISOString().split('T')[0];
    const allSlots = await repo.getAllScheduleSlots();
    
    // Tìm thông tin shift nếu shiftId thay đổi mà không có startTime/endTime custom
    let shiftInfo = undefined;
    if (shiftId !== undefined) {
      const shifts = await ShiftService.getAllShifts();
      shiftInfo = shifts.find(s => s.id === Number(shiftId));
    }

    let syncedSlotsCount = 0;
    for (const slot of allSlots) {
      if (slot.classId === classId && slot.date >= today && slot.status !== 'Đã hủy') {
        let changed = false;

        if (teacherId !== undefined && slot.teacherId !== teacherId) {
          slot.teacherId = teacherId;
          changed = true;
        }

        if (roomId !== undefined && slot.roomId !== roomId) {
          slot.roomId = roomId;
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

        if (shiftId !== undefined) {
          const sNum = Number(shiftId);
          if (slot.shiftId !== sNum) {
            slot.shiftId = sNum;
            if (!startTime && !cls.startTime && shiftInfo) {
              slot.startTime = shiftInfo.startTime;
            }
            if (!endTime && !cls.endTime && shiftInfo) {
              slot.endTime = shiftInfo.endTime;
            }
            changed = true;
          }
        }

        if (cls.subject && slot.subject !== cls.subject) {
          slot.subject = cls.subject;
          changed = true;
        }

        if (meetingLink !== undefined && slot.meetingLink !== meetingLink) {
          slot.meetingLink = meetingLink;
          changed = true;
        }

        if (changed) {
          await repo.updateScheduleSlot(slot);
          syncedSlotsCount++;
        }
      }
    }

    // 4. Ghi Audit Log
    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actorId,
      userName: actorId === 'ADMIN001' ? 'Quản trị viên' : actorId,
      userRole: 'ADMIN',
      targetResource: 'CLASS_ASSIGNMENT',
      targetId: classId,
      details: `Cập nhật lớp ${classId} (${cls.name}) và đồng bộ ${syncedSlotsCount} ca học tương lai (date >= ${today})`,
    });

    return NextResponse.json({
      success: true,
      class: cls,
      syncedSlotsCount,
      message: `Đã cập nhật lớp ${cls.name} và đồng bộ ${syncedSlotsCount} ca học tương lai`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi cập nhật lớp học' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      code,
      subject,
      teacherId,
      roomId,
      shiftId = 1,
      startTime = '18:30',
      endTime = '20:30',
      scheduleDays = [2, 4, 6],
      isRecurring = true,
      tuitionFee = 1500000,
      meetingLink = '',
      autoGenerateSchedule = true,
      generateMonths = 3,
      actorId = 'ADMIN001',
    } = body;

    if (!name || !code || !subject || !teacherId) {
      return NextResponse.json({ error: 'Vui lòng điền đủ Tên lớp, Mã môn, Môn học và Giảng viên phụ trách' }, { status: 400 });
    }

    const parsedStartTime = (startTime || '18:30').trim();
    const parsedEndTime = (endTime || '20:30').trim();
    const parsedIsRecurring = isRecurring !== undefined ? Boolean(isRecurring) : true;

    const allClasses = await repo.getAllClasses();
    const maxNum = allClasses.reduce((max, c) => {
      const match = String(c.id || '').match(/^CLS(\d+)$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const nextNum = maxNum + 1;
    const newId = `CLS${nextNum.toString().padStart(2, '0')}`;

    const newClass = {
      id: newId,
      code: code.trim().toUpperCase(),
      name: name.trim(),
      subject: subject.trim(),
      teacherId,
      roomId,
      shiftId: Number(shiftId) || 1,
      startTime: parsedStartTime,
      endTime: parsedEndTime,
      scheduleDays: Array.isArray(scheduleDays) ? scheduleDays.map(Number) : [2, 4, 6],
      isRecurring: parsedIsRecurring,
      tuitionFee: Number(tuitionFee) || 0,
      meetingLink: meetingLink?.trim() || '',
      studentIds: [],
      status: 'Đang mở' as const,
      createdAt: new Date().toISOString(),
    };

    await repo.createClass(newClass);

    // Cập nhật assignedClassIds của giảng viên
    const teacher = await repo.getTeacherById(teacherId);
    if (teacher) {
      if (!teacher.assignedClassIds) teacher.assignedClassIds = [];
      if (!teacher.assignedClassIds.includes(newId)) {
        teacher.assignedClassIds.push(newId);
        await repo.updateTeacher(teacher);
      }
    }

    await repo.addAuditLog({
      action: 'CREATE',
      userId: actorId,
      userName: actorId === 'ADMIN001' ? 'Quản trị viên' : actorId,
      userRole: 'ADMIN',
      targetResource: 'CLASS',
      targetId: newId,
      details: `Tạo lớp học mới ${newId} - ${newClass.name} (${newClass.code}) phụ trách bởi ${teacher?.name || teacherId}`,
    });

    let bulkScheduleResult = null;
    // Nếu isRecurring = true hoặc autoGenerateSchedule = true: sinh lịch tự động từ ngày hôm nay đến hết generateMonths tháng tới (mặc định 3 tháng)
    const shouldGenerate = parsedIsRecurring || autoGenerateSchedule;
    if (shouldGenerate) {
      const bulkService = new BulkScheduleService(repo);
      const now = new Date();
      const startDate = now.toISOString().split('T')[0];
      const endDateObj = new Date(now);
      const monthsToAdd = Math.max(1, Number(generateMonths) || (parsedIsRecurring ? 3 : 1));
      endDateObj.setMonth(endDateObj.getMonth() + monthsToAdd);
      const endDate = endDateObj.toISOString().split('T')[0];

      bulkScheduleResult = await bulkService.generateRecurringSlots({
        classIds: [newId],
        startDate,
        endDate,
        shiftId: newClass.shiftId,
        startTime: newClass.startTime,
        endTime: newClass.endTime,
        scheduleDays: newClass.scheduleDays,
        overwriteExisting: false,
        actorId,
      });
    }

    return NextResponse.json({
      success: true,
      class: newClass,
      bulkScheduleResult,
      message: `Tạo lớp ${newClass.name} (${newId}) thành công!${
        bulkScheduleResult ? ` Đã tự động sinh ${bulkScheduleResult.summary.createdCount} ca học (${newClass.startTime} - ${newClass.endTime}) cho các ngày tới.` : ''
      }`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi tạo lớp học' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const actorId = searchParams.get('actorId') || 'ADMIN001';

    if (!id) {
      return NextResponse.json({ error: 'Thiếu mã lớp học cần xóa' }, { status: 400 });
    }

    const cls = await repo.getClassById(id);
    if (!cls) {
      return NextResponse.json({ error: 'Không tìm thấy lớp học' }, { status: 404 });
    }

    // Bỏ lớp khỏi assignedClassIds của giáo viên
    if (cls.teacherId) {
      const teacher = await repo.getTeacherById(cls.teacherId);
      if (teacher && teacher.assignedClassIds) {
        teacher.assignedClassIds = teacher.assignedClassIds.filter(cid => cid !== id);
        await repo.updateTeacher(teacher);
      }
    }

    // Tự động xóa (hoặc đánh dấu 'Đã hủy') tất cả ScheduleSlot của lớp đó có date >= today
    const today = new Date().toISOString().split('T')[0];
    const allSlots = await repo.getAllScheduleSlots();
    let cancelledSlotsCount = 0;

    for (const slot of allSlots) {
      if (slot.classId === id && slot.date >= today && slot.status !== 'Đã hủy') {
        slot.status = 'Đã hủy';
        await repo.updateScheduleSlot(slot);
        cancelledSlotsCount++;
      }
    }

    await repo.deleteClass(id);

    await repo.addAuditLog({
      action: 'DELETE',
      userId: actorId,
      userName: actorId === 'ADMIN001' ? 'Quản trị viên' : actorId,
      userRole: 'ADMIN',
      targetResource: 'CLASS',
      targetId: id,
      details: `Xóa lớp học ${id} - ${cls.name} (${cls.code}) và hủy ${cancelledSlotsCount} ca học tương lai (date >= ${today})`,
    });

    return NextResponse.json({
      success: true,
      cancelledSlotsCount,
      message: `Đã xóa lớp học ${id} (${cls.name}) và hủy ${cancelledSlotsCount} ca học tương lai thành công`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi xóa lớp học' }, { status: 500 });
  }
}
