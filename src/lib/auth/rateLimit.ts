import { NextResponse } from 'next/server';

/**
 * Giới hạn số lần đăng nhập sai theo cặp (IP + username).
 *
 * Trước đây endpoint login nhận 15 lần sai liên tiếp mà không có phản ứng gì,
 * trong khi mật khẩu mặc định của giáo viên/học sinh là `123456` — đủ để dò
 * hàng loạt tài khoản.
 *
 * Bộ đếm dùng Cloudflare KV (binding `RATE_LIMIT_KV`) khi chạy trên Workers và
 * rơi về bộ nhớ trong tiến trình khi chạy `next start`/test. KV không có phép
 * tăng nguyên tử, nên cửa sổ cố định có thể đếm thiếu vài lần khi request đồng
 * thời — chấp nhận được cho mục tiêu chặn dò mật khẩu, không dùng cho quota
 * tính tiền.
 */

export interface RateLimitPolicy {
  /** Số lần thất bại tối đa trong cửa sổ. */
  maxFailures: number;
  /** Độ dài cửa sổ tính bằng giây. */
  windowSeconds: number;
}

export const LOGIN_RATE_LIMIT: RateLimitPolicy = { maxFailures: 5, windowSeconds: 300 };

interface CounterStore {
  get(key: string): Promise<number>;
  increment(key: string, windowSeconds: number): Promise<number>;
  reset(key: string): Promise<void>;
}

const memoryCounters = new Map<string, { count: number; expiresAt: number }>();

const memoryStore: CounterStore = {
  async get(key) {
    const entry = memoryCounters.get(key);
    if (!entry) return 0;
    if (entry.expiresAt <= Date.now()) {
      memoryCounters.delete(key);
      return 0;
    }
    return entry.count;
  },
  async increment(key, windowSeconds) {
    const now = Date.now();
    const entry = memoryCounters.get(key);
    if (!entry || entry.expiresAt <= now) {
      const fresh = { count: 1, expiresAt: now + windowSeconds * 1000 };
      memoryCounters.set(key, fresh);
      return fresh.count;
    }
    entry.count += 1;
    return entry.count;
  },
  async reset(key) {
    memoryCounters.delete(key);
  },
};

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

function getKvBinding(): KvLike | null {
  // Binding chỉ tồn tại trong workerd; import động để Node/test không vỡ.
  try {
    // `require` (không phải import tĩnh) để bundle Node/test không kéo module
    // Workers-only vào; binding chỉ có thật khi chạy trong workerd.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@opennextjs/cloudflare') as {
      getCloudflareContext?: () => { env?: Record<string, unknown> };
    };
    const env = mod.getCloudflareContext?.()?.env as Record<string, unknown> | undefined;
    const kv = env?.RATE_LIMIT_KV as KvLike | undefined;
    return kv && typeof kv.get === 'function' ? kv : null;
  } catch {
    return null;
  }
}

const kvStore = (kv: KvLike): CounterStore => ({
  async get(key) {
    const raw = await kv.get(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  },
  async increment(key, windowSeconds) {
    const next = (await this.get(key)) + 1;
    await kv.put(key, String(next), { expirationTtl: windowSeconds });
    return next;
  },
  async reset(key) {
    await kv.delete(key);
  },
});

function store(): CounterStore {
  const kv = getKvBinding();
  return kv ? kvStore(kv) : memoryStore;
}

export function rateLimitKey(scope: string, identity: string): string {
  return `rl:${scope}:${identity.toLowerCase()}`;
}

/** Lấy IP của client sau Cloudflare; rơi về header chuẩn khi chạy local. */
export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function getFailureCount(key: string): Promise<number> {
  return store().get(key);
}

export async function registerFailure(key: string, policy: RateLimitPolicy): Promise<number> {
  return store().increment(key, policy.windowSeconds);
}

export async function clearFailures(key: string): Promise<void> {
  await store().reset(key);
}

export function tooManyAttemptsResponse(policy: RateLimitPolicy): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: `Sai mật khẩu quá ${policy.maxFailures} lần. Vui lòng thử lại sau ${Math.ceil(policy.windowSeconds / 60)} phút.`,
    },
    {
      status: 429,
      headers: { 'Retry-After': String(policy.windowSeconds) },
    }
  );
}

/** Dùng cho test: xoá toàn bộ bộ đếm trong bộ nhớ. */
export function __resetRateLimitMemory(): void {
  memoryCounters.clear();
}
