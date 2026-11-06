#!/usr/bin/env node
/**
 * Kiểm chứng khoá RLS: dùng đúng ANON KEY công khai (nằm trong wrangler.toml)
 * và thử đọc từng bảng PostgREST đang phơi ra. Kỳ vọng: 0 dòng hoặc 401/403.
 *
 * Danh sách bảng là danh sách cố định vì Supabase chỉ cho service_role đọc
 * OpenAPI root (/rest/v1/), nên không thể tự liệt kê bằng anon key.
 * Thêm bảng mới vào DEFAULT_TABLES khi schema thay đổi.
 *
 * Chạy: node scripts/verify-rls.mjs            (exit 1 nếu còn rò rỉ)
 *       node scripts/verify-rls.mjs --verbose  (in cả bảng sạch)
 */
import { readFileSync } from 'node:fs';

const verbose = process.argv.includes('--verbose');

const DEFAULT_TABLES = [
  'app_settings',
  'attendance_records',
  'audit_logs',
  'class_requests',
  'class_section_students',
  'class_sections',
  'class_students',
  'classes',
  'notifications',
  'schedule_slots',
  'session_packages',
  'student_session_bookings',
  'student_slot_swaps',
  'students',
  'teacher_payroll_periods',
  'teachers',
  'time_shifts',
  'tuition_invoices',
  'users',
];

function readWrangler() {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const grab = (name) => {
    const m = toml.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
    if (!m) throw new Error(`Không tìm thấy ${name} trong wrangler.toml`);
    return m[1];
  };
  return { url: grab('NEXT_PUBLIC_SUPABASE_URL'), anonKey: grab('NEXT_PUBLIC_SUPABASE_ANON_KEY') };
}

const { url, anonKey } = readWrangler();
const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

async function probe(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, Range: '0-0', 'Prefer': 'count=exact' },
  });
  if (res.status === 401 || res.status === 403) return { table, verdict: 'denied' };
  if (!res.ok) {
    const body = await res.text();
    if (/permission denied|does not exist/i.test(body)) return { table, verdict: 'denied' };
    return { table, verdict: 'error', detail: `HTTP ${res.status} ${body.slice(0, 80)}` };
  }
  const range = res.headers.get('content-range') || '';
  const count = range.includes('/') ? Number(range.split('/').pop()) : null;
  const rows = await res.json();
  if ((count ?? 0) > 0 || (Array.isArray(rows) && rows.length > 0)) {
    return { table, verdict: 'leak', count: count ?? rows.length };
  }
  return { table, verdict: 'empty' };
}

const results = await Promise.all(DEFAULT_TABLES.map(probe));
const leaks = results.filter((r) => r.verdict === 'leak');
const errors = results.filter((r) => r.verdict === 'error');

for (const r of results) {
  if (r.verdict === 'leak') console.log(`LEAK   ${r.table}  đọc được ${r.count} dòng`);
  else if (r.verdict === 'error') console.log(`ERROR  ${r.table}  ${r.detail}`);
  else if (verbose) console.log(`${r.verdict.toUpperCase().padEnd(6)} ${r.table}`);
}

console.log(
  `\n${DEFAULT_TABLES.length} bảng: ${leaks.length} rò rỉ, ${errors.length} lỗi, ` +
    `${DEFAULT_TABLES.length - leaks.length - errors.length} kín.`,
);
if (leaks.length || errors.length) process.exit(1);
