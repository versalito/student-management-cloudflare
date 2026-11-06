import { repo } from '@/repositories';
import { NextResponse } from 'next/server';
import { AuthService } from '@/services/AuthService';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

// Không bao giờ trả passwordHash ra ngoài. Chỉ giữ lại các trường cần cho giao diện.
function sanitizeUser<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const role = searchParams.get('role');
  const search = searchParams.get('search')?.toLowerCase();
  const id = searchParams.get('id');

  if (id) {
    const user = await repo.getUserById(id);
    return NextResponse.json({ user: user ? sanitizeUser(user) : null });
  }

  let users = await repo.getAllUsers();
  if (role) {
    users = users.filter(u => u.role === role);
  }
  if (search) {
    users = users.filter(u => 
      u.id.toLowerCase().includes(search) || 
      u.name.toLowerCase().includes(search) ||
      u.username.toLowerCase().includes(search)
    );
  }

  return NextResponse.json({ users: users.map(sanitizeUser) });
}

export async function PUT(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const { userId, newPassword, newName, isActive } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Thiếu thông tin userId' }, { status: 400 });
    }

    const user = await repo.getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Không tìm thấy tài khoản người dùng' }, { status: 404 });
    }

    const authService = new AuthService(repo);

    // Đổi mật khẩu
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'Mật khẩu phải có tối thiểu 6 ký tự' }, { status: 400 });
      }
      user.passwordHash = await authService.hashPassword(newPassword);
    }

    if (newName) user.name = newName;
    if (typeof isActive === 'boolean') user.isActive = isActive;

    await repo.updateUser(user);

    // Đồng bộ 2 chiều: Khi đổi tên ở Quản lý tài khoản, tự động cập nhật sang Hồ sơ Học sinh hoặc Giảng viên
    if (user.role === 'STUDENT') {
      try {
        const student = await repo.getStudentById(user.id);
        if (student) {
          if (newName) student.name = newName;
          await repo.updateStudent(student);
        }
      } catch (err) {
        console.error('[SYNC-USER-TO-STUDENT-ERROR]:', err);
      }
    } else if (user.role === 'TEACHER') {
      try {
        const teacher = await repo.getTeacherById(user.id);
        if (teacher) {
          if (newName) teacher.name = newName;
          await repo.updateTeacher(teacher);
        }
      } catch (err) {
        console.error('[SYNC-USER-TO-TEACHER-ERROR]:', err);
      }
    }

    // Ghi Audit Log
    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actorId,
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'USER_ACCOUNT',
      targetId: userId,
      details: newPassword 
        ? `Đổi mật khẩu tài khoản [${userId}] (${user.name})` 
        : `Cập nhật thông tin tài khoản [${userId}]`,
    });

    return NextResponse.json({
      success: true,
      user: sanitizeUser(user),
      message: `Cập nhật tài khoản ${user.name} (${userId}) thành công!`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi cập nhật tài khoản' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const { username, name, role = 'STUDENT', password = 'password123' } = body;

    if (!username || !name) {
      return NextResponse.json({ error: 'Vui lòng nhập tên đăng nhập và họ tên' }, { status: 400 });
    }

    const existing = await repo.getUserByUsername(username);
    if (existing) {
      return NextResponse.json({ error: `Tên đăng nhập ${username} đã tồn tại` }, { status: 400 });
    }

    const authService = new AuthService(repo);
    const id = username.toUpperCase();

    const newUser = {
      id,
      username: username.toLowerCase(),
      passwordHash: await authService.hashPassword(password),
      role,
      name,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    await repo.createUser(newUser);

    await repo.addAuditLog({
      action: 'CREATE',
      userId: actorId,
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'USER_ACCOUNT',
      targetId: id,
      details: `Tạo tài khoản mới [${id}] - ${name} (Vai trò: ${role})`,
    });

    // Chiều 2 - Đồng bộ tự động: Nếu tạo tài khoản vai trò TEACHER, tự sinh hồ sơ giảng viên nếu chưa tồn tại
    if (role === 'TEACHER') {
      try {
        const existingTeacher = await repo.getTeacherById(id);
        if (!existingTeacher) {
          const newTeacher = {
            id,
            name: newUser.name,
            phone: body.phone || '0901234567',
            specialty: body.specialty || 'Bộ môn chung',
            hourlyRate: 300000,
            ratePerSession: 250000,
            status: 'Đang dạy' as const,
            assignedClassIds: [],
            createdAt: new Date().toISOString(),
          };
          await repo.createTeacher(newTeacher);

          await repo.addAuditLog({
            action: 'CREATE',
            userId: actorId,
            userName: 'Quản trị viên',
            userRole: 'ADMIN',
            targetResource: 'TEACHER',
            targetId: id,
            details: `Tự động đồng bộ hồ sơ giảng viên [${id}] từ tài khoản người dùng`,
          });
        }
      } catch (syncTeacherErr: any) {
        console.error(`[SYNC-TEACHER-ERROR] Không thể tự động tạo hồ sơ giảng viên cho [${id}]:`, syncTeacherErr);
      }
    }

    // Chiều 2 - Đồng bộ tự động: Nếu tạo tài khoản vai trò STUDENT, tự sinh bản ghi học sinh nếu chưa tồn tại
    if (role === 'STUDENT') {
      try {
        const existingStudent = await repo.getStudentById(id);
        if (!existingStudent) {
          const newStudent = {
            id,
            name: newUser.name,
            phone: body.phone || '0900000000',
            dateOfBirth: body.dateOfBirth || '2008-01-01',
            gender: (body.gender || 'Nam') as 'Nam' | 'Nữ',
            address: body.address || 'TP. Hồ Chí Minh',
            status: 'Đang học' as const,
            enrolledClassIds: [],
            createdAt: new Date().toISOString(),
          };
          await repo.createStudent(newStudent);

          await repo.addAuditLog({
            action: 'CREATE',
            userId: actorId,
            userName: 'Quản trị viên',
            userRole: 'ADMIN',
            targetResource: 'STUDENT',
            targetId: id,
            details: `Tự động đồng bộ hồ sơ học viên [${id}] từ tài khoản người dùng`,
          });
        }
      } catch (syncStudentErr: any) {
        console.error(`[SYNC-STUDENT-ERROR] Không thể tự động tạo hồ sơ học viên cho [${id}]:`, syncStudentErr);
      }
    }

    return NextResponse.json({
      success: true,
      user: sanitizeUser(newUser),
      message: `Đã tạo tài khoản ${newUser.name} (${newUser.id}) thành công!`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi tạo tài khoản' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const { searchParams } = new URL(request.url);
    let userId = searchParams.get('id') || searchParams.get('userId');

    // Trường hợp gửi qua JSON body
    if (!userId && request.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = await request.json();
        userId = body.userId || body.id;
      } catch (e) {
        // bỏ qua lỗi parse json nếu rỗng
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Thiếu thông tin mã tài khoản (id / userId)' }, { status: 400 });
    }

    // 1. Chặn xóa tài khoản Super Admin mặc định
    if (userId.toUpperCase() === 'ADMIN001' || userId.toLowerCase() === 'admin') {
      return NextResponse.json(
        { error: 'Không được phép xóa tài khoản Quản Trị Viên mặc định của hệ thống' },
        { status: 403 }
      );
    }

    // 2. Chặn tự xóa chính mình
    if (actorId && userId.toUpperCase() === actorId.toUpperCase()) {
      return NextResponse.json(
        { error: 'Bạn không thể tự xóa tài khoản của chính mình' },
        { status: 400 }
      );
    }

    // 3. Kiểm tra tài khoản tồn tại
    const user = await repo.getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Không tìm thấy tài khoản người dùng cần xóa' }, { status: 404 });
    }

    if (user.username.toLowerCase() === 'admin') {
      return NextResponse.json(
        { error: 'Không được phép xóa tài khoản Quản Trị Viên mặc định của hệ thống' },
        { status: 403 }
      );
    }

    // 4. Thực hiện xóa trong repo
    const success = await repo.deleteUser(userId);
    if (!success) {
      return NextResponse.json({ error: 'Không thể xóa tài khoản từ cơ sở dữ liệu' }, { status: 500 });
    }

    // 5. Ghi nhận Audit Log
    await repo.addAuditLog({
      action: 'DELETE',
      userId: actorId,
      userName: 'Quản trị viên',
      userRole: 'ADMIN',
      targetResource: 'USER_ACCOUNT',
      targetId: userId,
      details: `Xóa tài khoản người dùng [${userId}] (${user.name} - Vai trò: ${user.role})`,
    });

    return NextResponse.json({
      success: true,
      message: `Đã xóa tài khoản ${user.name} (${userId}) thành công!`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Lỗi hệ thống khi xóa tài khoản' },
      { status: 500 }
    );
  }
}
