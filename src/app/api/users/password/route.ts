import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { AuthService } from '@/services/AuthService';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Người dùng tự đổi mật khẩu của chính mình.
 * Bắt buộc nhập đúng mật khẩu hiện tại, để người khác không đổi được khi máy đang mở.
 */
export async function PUT(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { userId, currentPassword, newPassword } = body || {};

    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Vui lòng nhập đủ mật khẩu hiện tại và mật khẩu mới' },
        { status: 400 }
      );
    }

    if (String(newPassword).length < 6) {
      return NextResponse.json({ error: 'Mật khẩu mới phải có tối thiểu 6 ký tự' }, { status: 400 });
    }

    if (String(newPassword) === String(currentPassword)) {
      return NextResponse.json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại' }, { status: 400 });
    }

    const user = await repo.getUserById(String(userId));
    if (!user) {
      return NextResponse.json({ error: 'Không tìm thấy tài khoản' }, { status: 404 });
    }

    const authService = new AuthService(repo);
    if (!(await authService.verifyPassword(String(currentPassword), user.passwordHash))) {
      return NextResponse.json({ error: 'Mật khẩu hiện tại không đúng' }, { status: 401 });
    }

    user.passwordHash = await authService.hashPassword(String(newPassword));
    await repo.updateUser(user);

    await repo.addAuditLog({
      action: 'UPDATE',
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      targetResource: 'USER_PASSWORD',
      targetId: user.id,
      details: 'Người dùng [' + user.id + '] (' + user.name + ') tự đổi mật khẩu',
    });

    return NextResponse.json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi khi đổi mật khẩu' }, { status: 500 });
  }
}
