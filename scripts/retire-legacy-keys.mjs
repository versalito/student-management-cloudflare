#!/usr/bin/env node
/**
 * Thu hồi khoá bí mật Supabase đã lộ và chuyển project sang khoá kiểu mới.
 *
 * Vì sao cần: JWT secret của project từng nằm trong git history repo công khai
 * `versalito/student-management-cloudflare` (commit `bd065ac` xoá khỏi
 * `wrangler.toml` nhưng blob vẫn còn) và trong `.env.local` của repo công khai
 * `versalito/student-management`. Với JWT secret đó, ai cũng tự ký được token
 * role `service_role` — bỏ qua toàn bộ RBAC — cho tới hạn 2036.
 *
 * Supabase KHÔNG có endpoint rotate JWT secret. Cách duy nhất thu hồi là:
 *   1. chuyển sang khoá mới (`sb_secret_*` / `sb_publishable_*`), cập nhật app;
 *   2. tắt legacy API keys  -> mọi JWT cũ (anon + service_role) chết ngay.
 *
 * Script này làm bước 2 và in ra chính xác bước 1, nên chạy nó SAU khi app đã
 * chạy được bằng khoá mới. Nếu chạy trước, Worker sẽ 401 toàn bộ.
 *
 * Cách dùng:
 *   1. Tạo access token: https://supabase.com/dashboard/account/tokens
 *   2. export SUPABASE_ACCESS_TOKEN=sbp_...
 *   3. node scripts/retire-legacy-keys.mjs --dry-run    # xem trước
 *   4. node scripts/retire-legacy-keys.mjs --confirm    # tắt legacy keys
 *   5. node scripts/retire-legacy-keys.mjs --re-enable  # khẩn cấp: bật lại
 */

const PROJECT_REF = 'mvcwdqzmvgjdwqnnxaxb';
const API = 'https://api.supabase.com/v1';

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--confirm') && !args.has('--re-enable');
const reEnable = args.has('--re-enable');

/** Gọi Management API, ném lỗi kèm body để không đoán mò khi 4xx. */
async function api(path, init = {}) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('Thiếu SUPABASE_ACCESS_TOKEN (xem https://supabase.com/dashboard/account/tokens)');

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

function mask(key) {
  if (!key) return '(empty)';
  return `${key.slice(0, 12)}…${key.slice(-6)} (len ${key.length})`;
}

async function main() {
  console.log(dryRun ? '=== DRY RUN (không thay đổi gì) ===' : reEnable ? '=== BẬT LẠI LEGACY KEYS ===' : '=== TẮT LEGACY KEYS ===');

  const keys = await api(`/projects/${PROJECT_REF}/api-keys?reveal=true`);
  for (const k of keys) {
    console.log(`  ${String(k.name || k.type).padEnd(16)} ${String(k.type).padEnd(12)} ${mask(k.api_key)}`);
  }

  const secret = keys.find((k) => k.type === 'secret');
  const publishable = keys.find((k) => k.type === 'publishable');
  const state = await api(`/projects/${PROJECT_REF}/api-keys/legacy`);
  console.log(`\nLegacy keys hiện đang: ${state.enabled ? 'BẬT' : 'TẮT'}`);

  if (dryRun) {
    if (!secret || !publishable) {
      console.log('\nProject chưa có khoá kiểu mới — tạo trong Dashboard → Project Settings → API Keys.');
      return;
    }
    console.log('\nKhi chạy với --confirm, script sẽ tắt legacy keys và các khoá dưới đây CHẾT:');
    for (const k of keys.filter((k) => k.type === 'legacy')) {
      console.log(`  ${k.name}: ${mask(k.api_key)}`);
    }
    console.log(`
TRƯỚC KHI CHẠY --confirm, đảm bảo app đã chạy bằng khoá mới:
  npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # dán: ${mask(secret?.api_key)}
  # NEXT_PUBLIC_SUPABASE_ANON_KEY trong wrangler.toml = ${mask(publishable?.api_key)}
  npm run deploy
Sau đó kiểm tra login + vài endpoint, rồi mới chạy --confirm.`);
    return;
  }

  const enabled = !reEnable;
  const res = await api(`/projects/${PROJECT_REF}/api-keys/legacy?enabled=${enabled}`, { method: 'PUT' });
  console.log(`\nKết quả: ${JSON.stringify(res)}`);

  if (enabled) {
    console.log('\nLegacy keys đã bật lại — chỉ làm bước này khi khẩn cấp (app chưa kịp đổi khoá).');
    return;
  }

  console.log(`
BƯỚC KIỂM CHỨNG (chạy ngay, đừng đợi):

  node scripts/verify-rls.mjs
  # khoá cũ phải trả 401 "Legacy API keys are disabled"
  # app phải vẫn 200 ở /api/auth/login và /api/bootstrap
`);
}

main().catch((err) => {
  console.error('LỖI:', err.message);
  process.exit(1);
});
