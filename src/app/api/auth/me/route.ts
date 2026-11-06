import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { buildLogoutCookie, getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Trả về người dùng của phiên hiện tại. Đây là nguồn sự thật cho client. */
export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Đọc lại từ DB để phản ánh ngay việc bị khoá/đổi tên, và để token cũ không
  // giữ quyền sau khi tài khoản bị vô hiệu hoá.
  const user = await repo.getUserById(session.user.id);
  if (!user || !user.isActive) {
    const response = NextResponse.json({ user: null }, { status: 401 });
    response.headers.append('Set-Cookie', buildLogoutCookie());
    return response;
  }

  const { passwordHash, ...sanitizedUser } = user;
  return NextResponse.json({ user: sanitizedUser });
}

/** Đăng xuất: xoá cookie phiên. */
export async function DELETE(request: Request) {
  const session = await getSession(request);
  if (session) {
    try {
      await repo.addAuditLog({
        userId: session.user.id,
        userName: session.user.name,
        userRole: session.user.role,
        action: 'LOGOUT',
        targetResource: 'AUTH',
        targetId: session.user.id,
        details: `Người dùng [${session.user.id}] đăng xuất`,
      });
    } catch (err) {
      console.error('[Audit Log Error] Failed to log logout action:', err);
    }
  }

  const response = NextResponse.json({ success: true });
  response.headers.append('Set-Cookie', buildLogoutCookie());
  return response;
}
