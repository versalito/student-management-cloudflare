#!/usr/bin/env node
/**
 * Chặn build production nếu bundle còn mật khẩu dev / cờ dev.
 *
 * Bối cảnh lỗi thật (2026-11-07): `next build` nạp `.env.local` ở MỌI môi
 * trường, kể cả khi `NODE_ENV=production`. Biến `NEXT_PUBLIC_ENABLE_DEV_ROLE_SWITCHER=true`
 * trong đó được inline vào JS client, nên trang `/login` trên production hiện
 * nút "Đăng nhập nhanh (Dev)" và bấm một cái là vào thẳng ADMIN001.
 *
 * Script này quét output build (`.next/static` + `.open-next`) tìm mật khẩu dev
 * đã biết và cờ dev đang bật; thấy là exit 1 để CI/deploy dừng.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['.next/static', '.open-next'];
const FORBIDDEN = [
  { pattern: /admin123/, label: 'mật khẩu dev "admin123"' },
  { pattern: /teacher123/, label: 'mật khẩu dev "teacher123"' },
  { pattern: /student123/, label: 'mật khẩu dev "student123"' },
  { pattern: /Đăng nhập nhanh \(Dev\)/, label: 'khối đăng nhập nhanh (Dev)' },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // thư mục chưa tồn tại (vd. chưa build .open-next)
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|json|txt|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(root));
if (files.length === 0) {
  console.error('[check-no-dev-credentials] Không tìm thấy output build nào để quét.');
  process.exit(1);
}

const violations = [];
for (const file of files) {
  let content;
  try {
    if (statSync(file).size > 8 * 1024 * 1024) continue;
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(content)) violations.push({ file, label: rule.label });
  }
}

if (violations.length > 0) {
  console.error('[check-no-dev-credentials] Bundle production còn thông tin dev:');
  for (const v of violations) console.error(`  - ${v.file}: ${v.label}`);
  console.error('  Sửa: bỏ các biến dev khỏi .env.local / .env.production, rồi build lại.');
  process.exit(1);
}

console.log(`[check-no-dev-credentials] OK — đã quét ${files.length} file, không có mật khẩu dev.`);
