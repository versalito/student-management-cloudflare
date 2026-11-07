import test from 'node:test';
import assert from 'node:assert/strict';
import { quotePgValue } from '../src/repositories/SupabaseRepository';

/**
 * PostgREST đọc `or=(...)` theo cú pháp riêng: `,` ngăn cách điều kiện, `(`
 * `)` mở/đóng nhóm. Giá trị người dùng nhập mà không được quote thì chính
 * người dùng điều khiển được bộ lọc.
 *
 * Lỗi thật gặp trên production 2026-11-07: `GET /api/users?id=nope,role.eq.ADMIN`
 * và `?id=%` đều làm route trả 500 (một phần vì `maybeSingle()` ném lỗi khi
 * `%` khớp mọi dòng).
 */
test('PostgREST filter quoting: giá trị người dùng không phá được cú pháp or()', async (t) => {
  await t.test('bọc giá trị trong nháy kép', () => {
    assert.equal(quotePgValue('ADMIN001'), '"ADMIN001"');
  });

  await t.test('dấu phẩy nằm trong giá trị, không tạo điều kiện mới', () => {
    assert.equal(quotePgValue('nope,role.eq.ADMIN'), '"nope,role.eq.ADMIN"');
  });

  await t.test('ngoặc đơn không đóng được nhóm điều kiện', () => {
    assert.equal(quotePgValue('a)b'), '"a)b"');
    assert.equal(quotePgValue('%'), '"%"');
  });

  await t.test('nháy kép trong giá trị được escape để không đóng chuỗi sớm', () => {
    assert.equal(quotePgValue('a"b'), '"a\\"b"');
    // Ghép vào biểu thức thật: chỉ còn đúng 2 dấu nháy bao ngoài.
    const expr = `id.eq.${quotePgValue('x" ,role.eq.ADMIN')},username.eq.${quotePgValue('x')}`;
    assert.equal(expr, 'id.eq."x\\" ,role.eq.ADMIN",username.eq."x"');
  });
});
