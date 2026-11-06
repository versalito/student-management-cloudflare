import { createHmac } from 'node:crypto';
import { DEV_SESSION_SECRET, SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionUser } from '@/lib/auth/session';

/**
 * Test-only: mint token phiên đúng định dạng `v1.<payload>.<hmac>` mà
 * `verifySessionToken` chấp nhận, nhưng ký đồng bộ bằng node:crypto
 * (WebCrypto chỉ có API async nên không dùng được trong helper sync).
 */

export const adminUser: SessionUser = {
  id: 'ADMIN001',
  role: 'ADMIN',
  username: 'admin',
  name: 'Quản trị viên',
};

export const teacherUser: SessionUser = {
  id: 'GV001',
  role: 'TEACHER',
  username: 'gv001',
  name: 'Giáo viên 001',
};

export const studentUser: SessionUser = {
  id: 'ST001',
  role: 'STUDENT',
  username: 'st001',
  name: 'Học viên 001',
};

export function sessionToken(user: SessionUser = adminUser, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload = {
    uid: user.id,
    role: user.role,
    username: user.username,
    name: user.name,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signedValue = `v1.${body}`;
  const signature = createHmac('sha256', DEV_SESSION_SECRET).update(signedValue).digest('base64url');
  return `${signedValue}.${signature}`;
}

export function sessionCookie(user: SessionUser = adminUser): string {
  return `${SESSION_COOKIE}=${sessionToken(user)}`;
}

/** `new Request(...)` + cookie phiên, giữ nguyên helper sync trong test cũ. */
export function authed(
  input: string | URL,
  init: RequestInit = {},
  user: SessionUser = adminUser,
): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', sessionCookie(user));
  return new Request(input, { ...init, headers });
}

/** Như `authed` nhưng cho phép chọn vai trò. */
export function authedAs(user: SessionUser) {
  return (input: string | URL, init: RequestInit = {}): Request => authed(input, init, user);
}

/** Session của một học viên bất kỳ (dùng cho luồng self-service). */
export function studentSession(id: string): SessionUser {
  return { id, role: 'STUDENT', username: id.toLowerCase(), name: `Học viên ${id}` };
}

/** Như `authed` nhưng với vai trò học viên của chính `id` trong payload. */
export function authedAsStudent(id: string) {
  return (input: string | URL, init: RequestInit = {}): Request =>
    authed(input, init, studentSession(id));
}
