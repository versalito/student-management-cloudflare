import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { AuthService } from '@/services/AuthService';

export const dynamic = 'force-dynamic';

/**
 * Sinh username cho giáo viên theo cú pháp gv_<tên>:
 * - Bỏ dấu tiếng Việt, chuyển thường, bỏ ký tự đặc biệt, nối từ bằng dấu gạch ngang.
 * - Ví dụ: "Nguyễn Văn Hòa" -> gv_nguyen-van-hoa.
 */
function slugifyTeacherUsername(name: string): string {
  const s = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return 'gv_' + (s || 'giangvien');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (id) {
    const teacher = await repo.getTeacherById(id);
    return NextResponse.json({ teacher });
  }

  // Tự động đồng bộ đối soát: Quét tất cả user có role TEACHER, nếu thiếu trong hồ sơ teachers thì tự động bổ sung ngay
  try {
    const allUsers = await repo.getAllUsers();
    const teacherUsers = allUsers.filter(u => u.role === 'TEACHER');
    let existingTeachers = await repo.getAllTeachers();
    const existingTeacherIds = new Set(existingTeachers.map(t => t.id));

    for (const u of teacherUsers) {
      if (!existingTeacherIds.has(u.id)) {
        try {
          const syncedTeacher = {
            id: u.id,
            name: u.name,
            phone: '0901234567',
            specialty: 'Bộ môn chung',
            hourlyRate: 300000,
            ratePerSession: 250000,
            status: 'Đang dạy' as const,
            assignedClassIds: [],
            createdAt: new Date().toISOString(),
          };
          await repo.createTeacher(syncedTeacher);
          existingTeacherIds.add(u.id);
        } catch (e) {
          console.warn('[AUTO-HEAL-TEACHER] Bỏ qua lỗi đồng bộ hồ sơ cho', u.id, e);
        }
      }
    }
  } catch (healErr) {
    console.warn('[AUTO-HEAL-SYNC-ERROR]:', healErr);
  }

  const teachers = await repo.getAllTeachers();
  return NextResponse.json({ teachers });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, specialty, hourlyRate = 300000, phone, bio, fastOnboarding = false } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Vui lòng nhập họ và tên giáo viên' }, { status: 400 });
    }

    const trimmedName = String(name).trim();

    // Tiếp nhận nhanh: chỉ cần họ tên, các trường còn lại điền giá trị mặc định.
    const effectiveSpecialty = fastOnboarding ? (specialty || 'Bộ môn chung') : specialty;
    const effectivePhone = fastOnboarding ? (phone || '0901234567') : phone;
    const effectiveBio = fastOnboarding ? (bio || 'Giảng viên phụ trách bộ môn chung') : bio;

    if (!effectiveSpecialty || !effectivePhone) {
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
      name: trimmedName,
      specialty: effectiveSpecialty,
      hourlyRate: Number(hourlyRate) || 300000,
      phone: effectivePhone,
      ratePerSession: Number(body.ratePerSession) || 250000,
      bio: effectiveBio || `Giảng viên phụ trách bộ môn ${effectiveSpecialty}`,
      status: 'Đang dạy' as const,
      assignedClassIds: [],
      createdAt: new Date().toISOString(),
    };

    // Bảng teachers có khoá ngoại trỏ sang users, nên tạo tài khoản đăng nhập trước.
    // Mật khẩu mặc định 123456.
    const defaultPassword = '123456';
    let finalUsername = fastOnboarding ? slugifyTeacherUsername(trimmedName) : newId.toLowerCase();
    try {
      const authService = new AuthService(repo);
      const existingUser = await repo.getUserById(newId);
      if (!existingUser) {
        let suffix = 2;
        while (await repo.getUserByUsername(finalUsername)) {
          finalUsername = `${fastOnboarding ? slugifyTeacherUsername(trimmedName) : newId.toLowerCase()}${suffix}`;
          suffix += 1;
        }
        await repo.createUser({
          id: newId,
          username: finalUsername,
          passwordHash: await authService.hashPassword(defaultPassword),
          role: 'TEACHER',
          name: newTeacher.name,
          isActive: true,
        });
      } else {
        finalUsername = existingUser.username;
      }
    } catch (userErr: any) {
      return NextResponse.json(
        { error: `Không tạo được tài khoản đăng nhập cho ${newId}: ${userErr?.message || userErr}` },
        { status: 500 }
      );
    }

    await repo.createTeacher(newTeacher);

    await repo.addAuditLog({
      action: 'CREATE',
      userId: 'ADMIN001',
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'TEACHER',
      targetId: newId,
      details: `Thêm giảng viên mới ${newId} - ${trimmedName} (${effectiveSpecialty})${fastOnboarding ? ' [Tiếp nhận nhanh]' : ''}`,
    });

    return NextResponse.json({
      success: true,
      teacher: newTeacher,
      defaultPassword,
      username: finalUsername,
      message: fastOnboarding
        ? `Tiếp nhận nhanh giáo viên ${newId} (${trimmedName}) thành công`
        : `Thêm giảng viên ${newId} thành công`,
    });
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
    const { id, name, specialty, phone, bio, status, ratePerSession, hourlyRate } = body;

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
      bio: bio !== undefined ? bio : existing.bio,
      status: status || existing.status,
      ratePerSession: ratePerSession !== undefined ? Number(ratePerSession) : existing.ratePerSession,
      hourlyRate: hourlyRate !== undefined ? Number(hourlyRate) : (ratePerSession !== undefined ? Number(ratePerSession) : existing.hourlyRate),
    };
    const updated = await repo.updateTeacher(updatedTeacher);

    // Đồng bộ ngược lại bảng Users nếu có thay đổi tên
    try {
      const u = await repo.getUserById(id);
      if (u) {
        let uChanged = false;
        if (name && u.name !== name) { u.name = name; uChanged = true; }
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
