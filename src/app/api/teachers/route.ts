import { NextResponse } from 'next/server';
import { repo } from '@/repositories';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const teacher = await repo.getTeacherById(id);
      return NextResponse.json({ teacher });
    }

    // Đọc thuần 1 query (classes embed). Đối soát hồ sơ thiếu: POST /api/admin/reconcile.
    const teachers = await repo.getAllTeachers();
    return NextResponse.json({ teachers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải giảng viên';
    return NextResponse.json({ teachers: [], error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, specialty, hourlyRate = 300000, phone, email, bio } = body;

    if (!name || !specialty || !phone) {
      return NextResponse.json({ error: 'Vui lòng điền đủ họ tên, chuyên môn và số điện thoại' }, { status: 400 });
    }

    const allTeachers = await repo.getAllTeachers();
    const maxTeacherNumber = allTeachers.reduce((max, teacher) => {
      const match = String(teacher.id || '').match(/^GV(\d+)$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const nextNum = maxTeacherNumber + 1;
    const newId = `GV${nextNum.toString().padStart(3, '0')}`;

    const newTeacher = {
      id: newId,
      name,
      specialty,
      hourlyRate: Number(hourlyRate) || 300000,
      phone,
      email: email?.trim() || undefined,
      ratePerSession: Number(body.ratePerSession) || 250000,
      bio: bio || `Giảng viên phụ trách bộ môn ${specialty}`,
      status: 'Đang dạy' as const,
      assignedClassIds: [],
      createdAt: new Date().toISOString(),
    };

    await repo.createTeacher(newTeacher);

    await repo.addAuditLog({
      action: 'CREATE',
      userId: 'ADMIN001',
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'TEACHER',
      targetId: newId,
      details: `Thêm giảng viên mới ${newId} - ${name} (${specialty})`,
    });

    return NextResponse.json({ success: true, teacher: newTeacher, message: `Thêm giảng viên ${newId} thành công` });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi tạo giảng viên' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Thiếu mã giảng viên cần xoá' }, { status: 400 });
    }

    const teacher = await repo.getTeacherById(id);
    if (!teacher) {
      return NextResponse.json({ error: 'Không tìm thấy giảng viên' }, { status: 404 });
    }

    // 1. Gỡ liên kết giảng viên khỏi tất cả các lớp đang phụ trách
    try {
      const allClasses = await repo.getAllClasses();
      const assignedClasses = allClasses.filter(c => c.teacherId === id);
      for (const cls of assignedClasses) {
        cls.teacherId = '';
        await repo.updateClass(cls);
      }
    } catch (e) {
      console.warn('[DELETE-TEACHER] Gỡ liên kết lớp học:', e);
    }

    // 2. Gỡ liên kết trong các ca học schedule_slots
    try {
      const allSlots = await repo.getScheduleSlotsByTeacherId(id);
      for (const slot of allSlots) {
        slot.teacherId = '';
        await repo.updateScheduleSlot(slot);
      }
    } catch (e) {
      console.warn('[DELETE-TEACHER] Gỡ liên kết ca học:', e);
    }

    // 3. Xóa giáo viên trong repository
    await repo.deleteTeacher(id);

    // 4. Xóa luôn tài khoản User tương ứng để tránh bị hàm auto-heal phục hồi lại
    try {
      await repo.deleteUser(id);
    } catch (e) {
      console.warn('[DELETE-TEACHER] Xóa tài khoản user:', e);
    }

    // 5. Ghi Audit Log
    await repo.addAuditLog({
      action: 'DELETE',
      userId: 'ADMIN001',
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'TEACHER',
      targetId: id,
      details: `Xoá giảng viên ${id} - ${teacher.name} (Đã tháo gỡ phân công các lớp và xoá tài khoản)`,
    });

    return NextResponse.json({ success: true, message: `Đã xoá giảng viên ${id} (${teacher.name}) thành công!` });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi xoá giảng viên' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, name, specialty, phone, email, bio, status, ratePerSession, hourlyRate } = body;

    if (!id || !name || !specialty) {
      return NextResponse.json({ error: "Vui lòng cung cấp ID, họ tên và chuyên môn" }, { status: 400 });
    }

    const existing = await repo.getTeacherById(id);
    if (!existing) {
      return NextResponse.json({ error: "Không tìm thấy giảng viên" }, { status: 404 });
    }

    const updatedTeacher = {
      ...existing,
      name,
      specialty,
      phone: phone || existing.phone,
      email: email || existing.email,
      bio: bio !== undefined ? bio : existing.bio,
      status: status || existing.status,
      ratePerSession: ratePerSession !== undefined ? Number(ratePerSession) : existing.ratePerSession,
      hourlyRate: hourlyRate !== undefined ? Number(hourlyRate) : (ratePerSession !== undefined ? Number(ratePerSession) : existing.hourlyRate),
    };
    const updated = await repo.updateTeacher(updatedTeacher);

    // Đồng bộ ngược lại bảng Users nếu có thay đổi tên/email
    try {
      const u = await repo.getUserById(id);
      if (u) {
        let uChanged = false;
        if (name && u.name !== name) { u.name = name; uChanged = true; }
        if (email && u.email !== email) { u.email = email; uChanged = true; }
        if (uChanged) await repo.updateUser(u);
      }
    } catch (err) {
      console.error('[SYNC-TEACHER-TO-USER-ERROR]:', err);
    }

    await repo.addAuditLog({
      action: "UPDATE",
      userId: "ADMIN001",
      userName: "Quản trị viên",
      userRole: "ADMIN",
      targetResource: "TEACHER",
      targetId: id,
      details: "Cập nhật thông tin giảng viên " + id + " - " + name + " (Chuyên môn: " + specialty + ")",
    });

    return NextResponse.json({ success: true, teacher: updated, message: "Cập nhật giảng viên " + id + " thành công" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Lỗi khi cập nhật giảng viên" }, { status: 500 });
  }
}
