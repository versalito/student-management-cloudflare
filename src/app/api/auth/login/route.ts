import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { AuthService } from '@/services/AuthService';
import {
  SESSION_TTL_SECONDS,
  buildSessionCookie,
  createSessionToken,
  getSessionSecret,
} from '@/lib/auth/session';
import { clientIp } from '@/lib/auth/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Đăng nhập: xác thực mật khẩu, phát cookie phiên HttpOnly đã ký HMAC.
 * Từ đây mọi quyền hạn do server quyết định, client chỉ giữ bản sao để hiển thị.
 */
export async function POST(request: Request) {
  const genericError = () =>
    NextResponse.json(
      { success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' },
      { status: 401 }
    );

  try {
    // Chưa cấu hình secret ở môi trường thật thì không cấp phiên được — báo lỗi cấu hình.
    try {
      getSessionSecret();
    } catch (secretErr) {
      console.error('[Auth Login API] Thiếu SESSION_SECRET:', secretErr);
      return NextResponse.json(
        { success: false, error: 'Hệ thống chưa cấu hình khoá phiên đăng nhập' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { username, password } = body || {};

    if (!username || typeof username !== 'string' || !username.trim() ||
        !password || typeof password !== 'string' || !password.trim()) {
      return genericError();
    }

    const cleanUsername = username.trim();

    const authService = new AuthService(repo);
    const authenticatedUser = await authService.authenticate(cleanUsername, password);

    if (!authenticatedUser || !authenticatedUser.isActive) {
      console.warn(
        `[AUTH] Đăng nhập thất bại cho "${cleanUsername}" từ ${clientIp(request)}`
      );
      return genericError();
    }

    const token = await createSessionToken({
      id: authenticatedUser.id,
      role: authenticatedUser.role,
      username: authenticatedUser.username,
      name: authenticatedUser.name,
    });

    // Làm sạch user profile, không trả về passwordHash
    const { passwordHash, ...sanitizedUser } = authenticatedUser;

    const response = NextResponse.json(
      {
        success: true,
        user: sanitizedUser,
        expiresIn: SESSION_TTL_SECONDS,
        message: 'Đăng nhập thành công',
      },
      { status: 200 }
    );
    response.headers.append('Set-Cookie', buildSessionCookie(token, request));

    // Ghi audit log sau khi đã có phản hồi; await để không mất log khi isolate bị thu hồi.
    try {
      await repo.addAuditLog({
        userId: authenticatedUser.id,
        userName: authenticatedUser.name,
        userRole: authenticatedUser.role,
        action: 'LOGIN',
        targetResource: 'AUTH',
        targetId: authenticatedUser.id,
        details: `Người dùng [${authenticatedUser.id}] (${authenticatedUser.name}) đăng nhập hệ thống thành công`,
        ipAddress: clientIp(request),
      });
    } catch (auditErr) {
      console.error('[Audit Log Error] Failed to log login action:', auditErr);
    }

    return response;
  } catch (error) {
    console.error('[Auth Login API Error]:', error);
    return genericError();
  }
}
