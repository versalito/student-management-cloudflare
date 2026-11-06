/**
 * Cache dữ liệu tham chiếu (classes / teachers / shifts / packages) ở edge.
 *
 * Vì sao: mỗi trang quản trị đều đọc lại 3–4 bảng tham chiếu gần như không đổi.
 * Worker → PostgREST là round trip đắt nhất trong đường đọc (~150–350 ms mỗi
 * query), nên hit cache ở `caches.default` biến 250 ms thành 5–20 ms.
 *
 * Chống dữ liệu cũ (stale) bằng 3 lớp:
 *  1. TTL ngắn (30 s) — trần cứng cho mọi trường hợp.
 *  2. Version key theo scope: mỗi lần ghi dữ liệu tham chiếu thì tăng version,
 *     cache key đổi -> entry cũ không còn được đọc.
 *  3. Version trong bộ nhớ của isolate hiện tại: request ghi và request đọc lại
 *     ngay sau đó thường về cùng isolate, nên admin sửa xong thấy dữ liệu mới
 *     ngay, không phải chờ KV đồng bộ.
 *
 * Giới hạn đã biết: KV là eventually consistent (tới ~60 s giữa các colo), nên
 * một colo khác có thể còn đọc version cũ — nhưng khi đó TTL 30 s vẫn chặn.
 * Cache tắt hoàn toàn khi môi trường không có Cache API (Node/`next start`,
 * test) nên test không bao giờ đọc dữ liệu của test khác.
 */

import { NextResponse } from 'next/server';

/** TTL mặc định cho dữ liệu tham chiếu — khớp PERF_OPTIMIZATION_SPEC §5 (2.2). */
export const REFERENCE_TTL_SECONDS = 30;

/**
 * Một scope chung cho toàn bộ dữ liệu tham chiếu: ghi vào bất kỳ bảng nào
 * (lớp, ca, giáo viên, gói buổi) đều làm mới cache. Ghi tham chiếu rất thưa nên
 * đánh đổi này rẻ hơn nhiều so với việc theo dõi 4 version riêng.
 */
export const REFERENCE_CACHE_SCOPE = 'reference';

export type CacheStatus = 'hit' | 'miss' | 'bypass';

export interface CachedResult<T> {
  value: T;
  status: CacheStatus;
}

const CACHE_ORIGIN = 'https://reference-cache.internal';
const VERSION_PREFIX = 'ref:version:';

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function isCacheLike(value: unknown): value is CacheLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'match' in value &&
    typeof value.match === 'function' &&
    'put' in value &&
    typeof value.put === 'function'
  );
}

function edgeCache(): CacheLike | null {
  // `caches.default` chỉ có trong workerd; Node/`next start` không có -> bypass.
  const scope: unknown = globalThis;
  if (typeof scope !== 'object' || scope === null || !('caches' in scope)) return null;
  const globalCaches: unknown = scope.caches;
  if (typeof globalCaches !== 'object' || globalCaches === null || !('default' in globalCaches)) {
    return null;
  }
  const cache: unknown = globalCaches.default;
  return isCacheLike(cache) ? cache : null;
}

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function isKvLike(value: unknown): value is KvLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof value.get === 'function' &&
    'put' in value &&
    typeof value.put === 'function'
  );
}

function getKvBinding(): KvLike | null {
  // Binding chỉ tồn tại trong workerd; require động để Node/test không vỡ.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@opennextjs/cloudflare') as {
      getCloudflareContext?: () => { env?: Record<string, unknown> };
    };
    const env = mod.getCloudflareContext?.()?.env;
    const kv = env ? env.RATE_LIMIT_KV : undefined;
    return isKvLike(kv) ? kv : null;
  } catch {
    return null;
  }
}

/** Version tăng trong bộ nhớ isolate — có hiệu lực ngay, không phụ thuộc KV. */
const localVersions = new Map<string, number>();

async function readVersion(scope: string): Promise<string> {
  const local = localVersions.get(scope) || 0;
  const kv = getKvBinding();
  if (!kv) return `l${local}`;
  try {
    const remote = await kv.get(`${VERSION_PREFIX}${scope}`);
    return `l${local}-k${remote || '0'}`;
  } catch {
    // KV lỗi thì vẫn dùng được version cục bộ, không làm hỏng request đọc.
    return `l${local}`;
  }
}

/**
 * Tăng version của một scope sau khi ghi dữ liệu.
 * Đồng bộ trong isolate; KV (nếu có binding) cập nhật nền, lỗi bị nuốt có chủ ý
 * vì TTL 30 s đã là trần an toàn.
 */
export function bumpReferenceVersion(scope: string): void {
  localVersions.set(scope, (localVersions.get(scope) || 0) + 1);
  const kv = getKvBinding();
  if (!kv) return;
  void kv
    .put(`${VERSION_PREFIX}${scope}`, `${Date.now()}-${Math.random().toString(36).slice(2)}`, {
      expirationTtl: 24 * 60 * 60,
    })
    .catch(() => undefined);
}

/**
 * Đọc qua cache. `producer` chỉ chạy khi miss.
 * Không có Cache API (Node, test, `next start`) -> `bypass`, luôn gọi `producer`.
 */
export async function withReferenceCache<T>(
  scope: string,
  key: string,
  producer: () => Promise<T>,
  ttlSeconds: number = REFERENCE_TTL_SECONDS
): Promise<CachedResult<T>> {
  const cache = edgeCache();
  if (!cache) {
    return { value: await producer(), status: 'bypass' };
  }

  // Một version chung cho toàn bộ dữ liệu tham chiếu: bảng nào ghi cũng làm mới
  // mọi entry, nên không thể xảy ra trường hợp bump một bảng mà bảng khác cũ.
  const version = await readVersion(REFERENCE_CACHE_SCOPE);
  const url = `${CACHE_ORIGIN}/${scope}/${version}/${key}`;
  const cacheKey = new Request(url);

  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      return { value: (await hit.json()) as T, status: 'hit' };
    }
  } catch {
    // Cache hỏng/không đọc được: coi như miss.
  }

  const value = await producer();

  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(value), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${ttlSeconds}`,
        },
      })
    );
  } catch {
    // Ghi cache lỗi không được làm hỏng response.
  }

  return { value, status: 'miss' };
}

/** Gắn header quan sát `X-Cache` cho response trả về browser/CI. */
export function withCacheHeader(response: NextResponse, status: CacheStatus): NextResponse {
  response.headers.set('X-Cache', status.toUpperCase());
  return response;
}

/**
 * Đọc dữ liệu tham chiếu qua cache rồi trả response JSON kèm header `X-Cache`.
 * Dùng chung cho các route GET chỉ-đọc (classes/teachers/shifts/packages).
 */
export async function cachedJson<T>(
  scope: string,
  key: string,
  producer: () => Promise<T>,
  shape: (value: T) => Record<string, unknown>
): Promise<NextResponse> {
  const result = await withReferenceCache(scope, key, producer);
  return withCacheHeader(NextResponse.json(shape(result.value)), result.status);
}

/** Dùng cho test: xoá version trong bộ nhớ của mọi scope. */
export function __resetReferenceVersions(): void {
  localVersions.clear();
}
