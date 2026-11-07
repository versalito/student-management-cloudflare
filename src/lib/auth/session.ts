import { NextResponse } from 'next/server';
import type { Role } from '@/types/auth';
import { repo } from '@/repositories';

/**
 * Phiên đăng nhập phía server: cookie HttpOnly chứa payload ký HMAC-SHA256.
 *
 * Trước đây quyền hạn nằm ở `localStorage.active_user` do client tự ghi, nên
 * mọi endpoint API đều mở với bất kỳ ai biết URL. File này là nguồn quyền duy
 * nhất: mọi route handler gọi `requireUser()` và chỉ tin vào chữ ký ở đây.
 *
 * Chữ ký dùng WebCrypto để chạy được cả Node (test) lẫn workerd.
 */

export const SESSION_COOKIE = 'smc_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const TOKEN_VERSION = 'v1';
/** Secret chỉ dùng khi chạy test/local — production bắt buộc phải có SESSION_SECRET. */
export const DEV_SESSION_SECRET = 'dev-only-insecure-session-secret';
const DEV_SECRET = DEV_SESSION_SECRET;

export interface SessionUser {
  id: string;
  role: Role;
  username: string;
  name: string;
}

interface TokenPayload {
  uid: string;
  role: Role;
  username: string;
  name: string;
  iat: number;
  exp: number;
}

export interface Session {
  user: SessionUser;
  issuedAt: number;
  expiresAt: number;
}

function isProductionBackend(): boolean {
  // Fail closed: chỉ khi backend thật (Supabase) thiếu secret mới là lỗi cấu hình.
  return (process.env.DATA_SOURCE || 'supabase').toLowerCase() !== 'local';
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isProductionBackend()) {
    throw new Error(
      'SESSION_SECRET chưa được cấu hình (tối thiểu 32 ký tự). Chạy: wrangler secret put SESSION_SECRET'
    );
  }
  return DEV_SECRET;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

export async function signSession(value: string): Promise<string> {
  const key = await hmacKey(['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

/**
 * Tạo token phiên. `nowMs` chỉ dùng cho test.
 */
export async function createSessionToken(user: SessionUser, nowMs: number = Date.now()): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const payload: TokenPayload = {
    uid: user.id,
    role: user.role,
    username: user.username,
    name: user.name,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };
  const body = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const signedValue = `${TOKEN_VERSION}.${body}`;
  const signature = await signSession(signedValue);
  return `${signedValue}.${signature}`;
}

export async function verifySessionToken(token: string, nowMs: number = Date.now()): Promise<Session | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;

  const signedValue = `${parts[0]}.${parts[1]}`;
  const expected = await signSession(signedValue);
  // So sánh độ dài trước để tránh verify trên dữ liệu sai kích thước.
  if (expected.length !== parts[2].length) return null;

  let valid = false;
  try {
    const key = await hmacKey(['verify']);
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(parts[2]),
      enc.encode(signedValue)
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(dec.decode(base64UrlToBytes(parts[1])));
  } catch {
    return null;
  }

  if (!payload?.uid || !payload?.role || typeof payload.exp !== 'number') return null;
  const nowSeconds = Math.floor(nowMs / 1000);
  if (payload.exp <= nowSeconds) return null;

  return {
    user: { id: payload.uid, role: payload.role, username: payload.username, name: payload.name },
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const chunk of header.split(';')) {
    const idx = chunk.indexOf('=');
    if (idx < 0) continue;
    const name = chunk.slice(0, idx).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(chunk.slice(idx + 1).trim());
  }
  return out;
}

export function readSessionToken(request: Request): string | null {
  const cookies = parseCookies(request.headers.get('cookie'));
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];

  // Cho phép Bearer cho các client không phải browser (script, webhook test).
  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

  return null;
}

export async function getSession(request: Request): Promise<Session | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  return verifySessionToken(token);
}

export function buildSessionCookie(token: string, request?: Request): string {
  const secure = request ? new URL(request.url).protocol === 'https:' : true;
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export class ApiAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Chặn request không có phiên hợp lệ hoặc sai vai trò.
 * Trả về `SessionUser` khi hợp lệ, ném ApiAuthError khi không.
 */
export async function requireUser(request: Request, allowedRoles?: readonly Role[]): Promise<SessionUser> {
  let session: Session | null;
  try {
    session = await getSession(request);
  } catch (err) {
    console.error('[AUTH] Không xác thực được phiên:', err);
    throw new ApiAuthError('Hệ thống chưa cấu hình khoá phiên đăng nhập', 500);
  }

  if (!session) {
    throw new ApiAuthError('Chưa đăng nhập hoặc phiên đã hết hạn', 401);
  }
  // Token chỉ chứng minh "đã đăng nhập lúc ký"; trạng thái tài khoản có thể đổi
  // sau đó. Khoá tài khoản mà phiên cũ vẫn dùng được thì việc khoá vô nghĩa,
  // nên mỗi request phải đọc lại `isActive` từ DB.
  const user = await repo.getUserById(session.user.id);
  if (!user || !user.isActive) {
    throw new ApiAuthError('Tài khoản đã bị khoá hoặc không còn tồn tại', 401);
  }
  if (allowedRoles && !allowedRoles.includes(session.user.role)) {
    throw new ApiAuthError('Tài khoản không có quyền thực hiện thao tác này', 403);
  }
  return session.user;
}

export type AuthResult =
  | { user: SessionUser; response?: undefined }
  | { user?: undefined; response: Response };

/**
 * Dạng dùng trong route handler đã có sẵn `request`:
 *   const auth = await authenticate(request, ['ADMIN']);
 *   if (auth.response) return auth.response;
 *   const user = auth.user;
 */
export async function authenticate(request: Request, allowedRoles?: readonly Role[]): Promise<AuthResult> {
  try {
    return { user: await requireUser(request, allowedRoles) };
  } catch (err) {
    const authError = err as ApiAuthError;
    const status = authError instanceof ApiAuthError ? authError.status : 500;
    const message = authError instanceof ApiAuthError ? authError.message : 'Lỗi xác thực';
    return { response: NextResponse.json({ error: message }, { status }) };
  }
}

/**
 * Bọc một handler API: xác thực trước, chỉ chạy handler khi hợp lệ.
 * Lỗi auth trả JSON thống nhất; lỗi khác vẫn để handler tự xử lý.
 */
export function withAuth<Args extends unknown[]>(
  allowedRoles: readonly Role[] | null,
  handler: (request: Request, user: SessionUser, ...args: Args) => Promise<Response>
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    let user: SessionUser;
    try {
      user = await requireUser(request, allowedRoles ?? undefined);
    } catch (err) {
      const authError = err as ApiAuthError;
      const status = authError instanceof ApiAuthError ? authError.status : 401;
      return NextResponse.json({ error: authError?.message || 'Không có quyền truy cập' }, { status });
    }
    return handler(request, user, ...args);
  };
}

/**
 * Chặn truy cập dữ liệu của người khác: học viên **và giáo viên** chỉ thấy chính mình.
 *
 * Trước đây hàm trả `true` cho mọi tài khoản TEACHER, nên bất kỳ chỗ nào dùng nó
 * làm chốt chặn (sửa hồ sơ giáo viên, sổ chấm công, đổi ca…) đều mở cho toàn bộ
 * giáo viên. Phạm vi rộng của giáo viên (học viên/lớp mình dạy) phải kiểm riêng
 * bằng `teacherTeachesStudent` / `teacherTeachesClass`, không dựa vào hàm này.
 */
export function isSelfOrStaff(user: SessionUser, targetId: string | null | undefined): boolean {
  if (user.role === 'ADMIN') return true;
  if (!targetId) return false;
  return targetId.toUpperCase() === user.id.toUpperCase();
}
