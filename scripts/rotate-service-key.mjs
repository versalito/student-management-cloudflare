#!/usr/bin/env node
/**
 * Xoay khoá `service_role` của Supabase và cập nhật secret cho Worker.
 *
 * Vì sao cần: khoá `service_role` hiện tại đã nằm trong git history của repo công
 * khai `versalito/student-management-cloudflare` (commit `bd065ac` xoá khỏi
 * `wrangler.toml` nhưng blob cũ vẫn còn) và trong `.env.local` của repo công khai
 * `versalito/student-management`. Khoá có hạn tới 2036 và bỏ qua toàn bộ RBAC ở
 * tầng API, nên phải coi là đã lộ vĩnh viễn.
 *
 * Cách dùng:
 *   1. Tạo access token: https://supabase.com/dashboard/account/tokens
 *   2. export SUPABASE_ACCESS_TOKEN=sbp_...
 *   3. node scripts/rotate-service-key.mjs --dry-run     # xem trước, không đổi gì
 *   4. node scripts/rotate-service-key.mjs --confirm     # rotate thật
 *
 * Lưu ý: rotate JWT secret làm **mọi** JWT cũ (kể cả anon key) mất hiệu lực, nên
 * anon key trong `wrangler.toml` phải cập nhật cùng lúc. Script in ra đúng các
 * lệnh cần chạy sau khi rotate.
 */

const PROJECT_REF = 'mvcwdqzmvgjdwqnnxaxb';
const API = 'https://api.supabase.com/v1';

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--confirm');

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
  console.log(dryRun ? '=== DRY RUN (không thay đổi gì) ===' : '=== ROTATE THẬT ===');

  const keys = await api(`/projects/${PROJECT_REF}/api-keys?reveal=true`);
  for (const k of keys) {
    console.log(`  ${String(k.name || k.type).padEnd(16)} ${mask(k.api_key)}`);
  }

  const legacy = keys.filter((k) => k.type === 'legacy' || k.name === 'service_role');
  if (legacy.length === 0) {
    console.log('\nKhông có khoá legacy/service_role để rotate (project có thể đã dùng khoá mới).');
  }

  if (dryRun) {
    console.log('\nSẽ gọi: POST /projects/' + PROJECT_REF + '/jwt/rotate (hoặc /api-keys/legacy/rotate)');
    console.log('Chạy lại với --confirm để thực hiện.');
    return;
  }

  // Ưu tiên endpoint rotate riêng cho legacy key (không đụng anon key nếu có thể).
  let rotated;
  try {
    rotated = await api(`/projects/${PROJECT_REF}/api-keys/legacy/rotate`, { method: 'POST' });
  } catch (err) {
    console.log(`\n/api-keys/legacy/rotate không dùng được (${err.message}).`);
    console.log('Thử rotate toàn bộ JWT secret: mọi JWT cũ sẽ hết hiệu lực.');
    rotated = await api(`/projects/${PROJECT_REF}/jwt/rotate`, { method: 'POST' });
  }

  console.log('\nĐã rotate. Khoá mới:');
  console.log(JSON.stringify(rotated, null, 2).replace(/eyJ[A-Za-z0-9._-]{40,}/g, (m) => mask(m)));

  console.log(`
BƯỚC TIẾP THEO (bắt buộc, nếu không Worker sẽ 401 toàn bộ):

  1. wrangler secret put SUPABASE_SERVICE_ROLE_KEY
     (dán khoá service_role mới khi được hỏi)

  2. Nếu anon key cũng đổi:
     - sửa NEXT_PUBLIC_SUPABASE_ANON_KEY trong wrangler.toml
     - wrangler deploy

  3. Xoá khoá khỏi lịch sử git (repo đã public nên chỉ là dọn dẹp, khoá cũ đã vô hiệu):
     git filter-repo --replace-text <(echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9==>REDACTED")
     (cần cài git-filter-repo; sau đó force-push và báo mọi collaborator clone lại)

  4. Gỡ .env.local khỏi repo versalito/student-management:
     gh api -X DELETE repos/versalito/student-management/contents/.env.local

  5. Kiểm chứng: node scripts/verify-rls.mjs && curl worker /api/bootstrap
`);
}

main().catch((err) => {
  console.error('LỖI:', err.message);
  process.exit(1);
});
