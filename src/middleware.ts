import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, readSessionToken, SESSION_COOKIE } from '@/lib/auth/session';
import type { Role } from '@/types/auth';

/**
 * Chặn ở tầng edge trước khi React render: không có cookie hợp lệ thì không vào
 * được shell của portal. Đây là lớp thứ nhất; lớp thứ hai là `withAuth()` trong
 * từng route handler (nguồn quyền thật, vì middleware có thể bị bypass bởi lỗi
 * cấu hình hoặc đường dẫn không khớp matcher).
 */

const PORTALS: { prefix: string; role: Role }[] = [
  { prefix: '/admin', role: 'ADMIN' },
  { prefix: '/teacher', role: 'TEACHER' },
  { prefix: '/student', role: 'STUDENT' },
];

const DASHBOARD: Record<Role, string> = {
  ADMIN: '/admin/dashboard',
  TEACHER: '/teacher/dashboard',
  STUDENT: '/student/dashboard',
};

export const config = {
  matcher: ['/admin/:path*', '/teacher/:path*', '/student/:path*'],
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const portal = PORTALS.find(p => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`));
  if (!portal) return NextResponse.next();

  const token = readSessionToken(request);
  let session = null;
  try {
    session = token ? await verifySessionToken(token) : null;
  } catch (err) {
    console.error('[MIDDLEWARE] Không xác thực được phiên:', err);
    session = null;
  }

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname + search);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (session.user.role !== portal.role) {
    return NextResponse.redirect(new URL(DASHBOARD[session.user.role], request.url));
  }

  return NextResponse.next();
}
