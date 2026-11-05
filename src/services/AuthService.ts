import { IRepository } from '@/repositories/IRepository';
import { User, Role, SessionContext, PermissionAction, Resource } from '@/types/auth';

/**
 * Hash mật khẩu bằng PBKDF2-HMAC-SHA256 (WebCrypto) — chạy được cả Node lẫn
 * Cloudflare Workers, không phụ thuộc node:crypto.
 *
 * Định dạng lưu: pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>
 * Hash cũ (SHA-256 hex, không salt) vẫn đăng nhập được và tự nâng cấp khi user
 * đăng nhập thành công.
 */
const HASH_PREFIX = 'pbkdf2-sha256';
/**
 * workerd (Cloudflare Workers) giới hạn cứng số vòng PBKDF2 — vượt cap sẽ ném
 * DOMOperationError, đúng lý do bản 210.000 vòng hỏng trên Workers nhưng chạy
 * được ở Node. 100.000 là mức trần Workers chấp nhận.
 */
const HASH_ITERATIONS = 100_000;
const HASH_BITS = 256;
const SALT_BYTES = 16;
const LEGACY_SHA256_HEX = /^[0-9a-f]{64}$/i;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derivePbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** So sánh không phụ thuộc thời gian để không rò rỉ tiền tố đúng qua timing. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function legacySha256(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPasswordHash(passwordPlain: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash) return false;

  if (LEGACY_SHA256_HEX.test(storedHash)) {
    const legacy = await legacySha256(passwordPlain);
    return timingSafeEqualBytes(new TextEncoder().encode(legacy), new TextEncoder().encode(storedHash.toLowerCase()));
  }

  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;

  const salt = base64ToBytes(parts[2]);
  const expected = base64ToBytes(parts[3]);
  const actual = await derivePbkdf2(passwordPlain, salt, iterations);
  return timingSafeEqualBytes(actual, expected);
}

export class AuthService {
  constructor(private repo: IRepository) {}

  public async hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const derived = await derivePbkdf2(password, salt, HASH_ITERATIONS);
    return `${HASH_PREFIX}$${HASH_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
  }

  public async verifyPassword(passwordPlain: string, storedHash: string | undefined): Promise<boolean> {
    return verifyPasswordHash(passwordPlain, storedHash);
  }

  public needsRehash(storedHash: string | undefined): boolean {
    return !!storedHash && !storedHash.startsWith(`${HASH_PREFIX}$`);
  }

  public async authenticate(username: string, passwordPlain: string): Promise<User | null> {
    const user = await this.repo.getUserByUsername(username);
    if (!user || !user.isActive) return null;

    if (!(await verifyPasswordHash(passwordPlain, user.passwordHash))) {
      return null;
    }

    // Nâng cấp hash cũ (SHA-256 không salt) ngay lần đăng nhập đầu tiên.
    if (this.needsRehash(user.passwordHash)) {
      try {
        const upgradedHash = await this.hashPassword(passwordPlain);
        await this.repo.updateUser({ ...user, passwordHash: upgradedHash });
        user.passwordHash = upgradedHash;
      } catch (error) {
        console.error('[AuthService] Không nâng cấp được hash mật khẩu:', error);
      }
    }

    return user;
  }

  /**
   * Kiểm tra quyền RBAC: Role có được thực hiện Action trên Resource hay không?
   */
  public checkPermission(role: Role, action: PermissionAction, resource: Resource): boolean {
    if (role === 'ADMIN') {
      return true; // Admin có toàn quyền
    }

    if (role === 'TEACHER') {
      switch (resource) {
        case 'SCHEDULE':
          return ['READ', 'UPDATE'].includes(action);
        case 'ATTENDANCE':
          return ['READ', 'CREATE', 'UPDATE'].includes(action);
        case 'STUDENT':
          return action === 'READ';
        case 'TEACHER':
          return action === 'READ';
        case 'PAYROLL':
          return action === 'READ';
        case 'REQUEST':
          return ['READ', 'UPDATE', 'APPROVE'].includes(action);
        case 'TUITION':
          return false; // Giáo viên không được truy cập thông tin học phí tài chính nhạy cảm
        case 'AUDIT':
          return false; // Chỉ admin xem audit
        default:
          return false;
      }
    }

    if (role === 'STUDENT') {
      switch (resource) {
        case 'SCHEDULE':
          return action === 'READ';
        case 'ATTENDANCE':
          return action === 'READ';
        case 'STUDENT':
          return ['READ', 'UPDATE'].includes(action);
        case 'REQUEST':
          return ['READ', 'CREATE'].includes(action);
        case 'TUITION':
          return ['READ', 'UPDATE'].includes(action); // Update khi nộp tiền/QR
        case 'TEACHER':
          return action === 'READ';
        case 'PAYROLL':
        case 'AUDIT':
          return false;
        default:
          return false;
      }
    }

    return false;
  }

  /**
   * Data Isolation Guard:
   * Ngăn chặn việc User role này truy cập dữ liệu của User khác.
   */
  public canAccessStudentData(currentUser: User, targetStudentId: string): boolean {
    if (currentUser.role === 'ADMIN') return true;
    if (currentUser.role === 'STUDENT') {
      return currentUser.id === targetStudentId;
    }
    // Teacher: chỉ được xem nếu student nằm trong lớp mình dạy (sẽ check thêm qua Repo nếu cần)
    return true;
  }

  public async canTeacherManageClass(currentUser: User, classId: string): Promise<boolean> {
    if (currentUser.role === 'ADMIN') return true;
    if (currentUser.role !== 'TEACHER') return false;
    const cls = await this.repo.getClassById(classId);
    return cls?.teacherId === currentUser.id;
  }

  public async canTeacherManageSchedule(currentUser: User, slotId: string): Promise<boolean> {
    if (currentUser.role === 'ADMIN') return true;
    if (currentUser.role !== 'TEACHER') return false;
    const slot = await this.repo.getScheduleSlotById(slotId);
    return slot?.teacherId === currentUser.id;
  }
}
