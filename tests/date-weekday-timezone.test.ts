import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dateToDayOfWeek } from '../src/utils/date';

/**
 * Ngày dạng YYYY-MM-DD là ngày lịch. Nếu tính thứ bằng `new Date(str).getDay()`,
 * kết quả phụ thuộc múi giờ máy chạy: Cloudflare Workers (UTC) lệch 1 ngày so với
 * Node local (Asia/Saigon) -> học sinh thấy sai buổi. Test này chạy lại hàm trong
 * tiến trình con với TZ=UTC để bắt lỗi đó.
 */
test('dateToDayOfWeek: quy ước 2=Thứ 2 ... 8=Chủ Nhật', () => {
  assert.equal(dateToDayOfWeek('2026-11-02'), 2); // Thứ 2
  assert.equal(dateToDayOfWeek('2026-11-06'), 6); // Thứ 6
  assert.equal(dateToDayOfWeek('2026-11-08'), 8); // Chủ Nhật
  assert.equal(dateToDayOfWeek(''), null);
  assert.equal(dateToDayOfWeek('khong-phai-ngay'), null);
});

test('dateToDayOfWeek: kết quả giống nhau khi máy chạy ở UTC (Workers)', () => {
  const script = `
    import('./src/utils/date.ts').then(m => {
      const f = m.dateToDayOfWeek || m.default?.dateToDayOfWeek;
      console.log([f('2026-11-02'), f('2026-11-06'), f('2026-11-08')].join(','));
    });
  `;
  const out = execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: 'UTC' },
    encoding: 'utf8',
  }).trim();

  assert.equal(out, '2,6,8');
});
