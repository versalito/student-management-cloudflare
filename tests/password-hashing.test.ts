import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/services/AuthService';
import { LocalRepository } from '../src/repositories/LocalRepository';

const SHA256_ADMIN123 = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

test('hashPassword: PBKDF2 có salt ngẫu nhiên, không lưu plaintext', async () => {
  const auth = new AuthService(LocalRepository.getInstance());
  const a = await auth.hashPassword('matkhau123');
  const b = await auth.hashPassword('matkhau123');

  assert.match(a, /^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b, 'Hai lần hash cùng mật khẩu phải khác nhau vì salt ngẫu nhiên');
  assert.ok(!a.includes('matkhau123'));
  const iterations = Number(a.split('$')[1]);
  assert.ok(iterations <= 100_000, 'workerd từ chối PBKDF2 > 100.000 vòng (DOMOperationError)');
  assert.equal(await auth.verifyPassword('matkhau123', a), true);
  assert.equal(await auth.verifyPassword('matkhau124', a), false);
});

test('verifyPassword: chấp nhận hash SHA-256 cũ để không khoá tài khoản', async () => {
  const auth = new AuthService(LocalRepository.getInstance());
  assert.equal(await auth.verifyPassword('admin123', SHA256_ADMIN123), true);
  assert.equal(await auth.verifyPassword('admin124', SHA256_ADMIN123), false);
});

test('authenticate: hash SHA-256 cũ tự nâng cấp thành PBKDF2 khi đăng nhập', async () => {
  const repo = LocalRepository.getInstance();
  const auth = new AuthService(repo);

  await repo.createUser({
    id: 'ST_HASH_UPGRADE',
    username: 'st_hash_upgrade',
    passwordHash: SHA256_ADMIN123,
    role: 'STUDENT',
    name: 'Học viên nâng cấp hash',
    isActive: true,
  });

  const before = await repo.getUserById('ST_HASH_UPGRADE');
  assert.equal(before?.passwordHash, SHA256_ADMIN123);

  const loggedIn = await auth.authenticate('st_hash_upgrade', 'admin123');
  assert.equal(loggedIn?.id, 'ST_HASH_UPGRADE');

  const after = await repo.getUserById('ST_HASH_UPGRADE');
  assert.match(String(after?.passwordHash), /^pbkdf2-sha256\$/);
  assert.ok(!auth.needsRehash(after?.passwordHash));

  // Đăng nhập lần hai vẫn đúng sau khi đã đổi định dạng.
  assert.equal((await auth.authenticate('st_hash_upgrade', 'admin123'))?.id, 'ST_HASH_UPGRADE');
  assert.equal(await auth.authenticate('st_hash_upgrade', 'sai_mat_khau'), null);
});
