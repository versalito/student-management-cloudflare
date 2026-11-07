import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { cachedJson } from '@/lib/cache/referenceCache';
import { AuthService } from '@/services/AuthService';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

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
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Học viên chỉ cần tên/ảnh/chuyên môn để hiển thị "GV phụ trách", không được
  // thấy SĐT, lương theo giờ, lương theo buổi hay tiểu sử của giáo viên.
  if (auth.user.role === 'STUDENT') {
    if (id) {
      const teacher = await repo.getTeacherById(id);
      if (!teacher) return NextResponse.json({ teacher: null });
      const { id: tid, name, specialty, bio } = teacher;
      return NextResponse.json({ teacher: { id: tid, name, specialty, bio } });
    }
    const teachers = await repo.getAllTeachers();
    return NextResponse.json({
      teachers: teachers.map(({ id: tid, name, specialty, bio }) => ({
        id: tid, name, specialty, bio,
      })),
    });
  }

  if (id) {
    const teacher = await repo.getTeacherById(id);
    return NextResponse.json({ teacher });
  }

  // GET là read-only: hồ sơ giáo viên thiếu được đối soát bằng
  // `POST /api/admin/reconcile` (npm run db:reconcile), không ghi trong lúc đọc.
  return cachedJson('teachers', 'all', () => repo.getAllTeachers(), (teachers) => ({ teachers }));
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

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
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
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
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

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
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
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
  const auth = await authenticate(request, ['ADMIN','TEACHER']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { id, name, specialty, phone, bio, status, ratePerSession, hourlyRate } = body;

    // Giáo viên chỉ sửa hồ sơ của chính mình, và không được đổi trạng thái hay mức lương.
    if (auth.user.role === 'TEACHER') {
      if (!isSelfOrStaff(auth.user, id)) {
        return NextResponse.json({ error: 'Không có quyền sửa hồ sơ giáo viên khác' }, { status: 403 });
      }
      if (status !== undefined || ratePerSession !== undefined || hourlyRate !== undefined) {
        return NextResponse.json(
          { error: 'Giáo viên không được sửa trạng thái hoặc mức lương' },
          { status: 403 }
        );
      }
    }

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
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
      targetResource: "TEACHER",
      targetId: id,
      details: "Cập nhật thông tin giảng viên " + id + " - " + name + " (Chuyên môn: " + specialty + ")",
    });

    return NextResponse.json({ success: true, teacher: updated, message: "Cập nhật giảng viên " + id + " thành công" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Lỗi khi cập nhật giảng viên" }, { status: 500 });
  }
}
