import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/services/AuthService';
import { LocalRepository } from '../src/repositories/LocalRepository';

const SHA256_ADMIN123 = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

test('hashPassword: dùng cơ chế SHA-256 hex chuẩn', async () => {
  const auth = new AuthService(LocalRepository.getInstance());
  const a = await auth.hashPassword('admin123');
  const b = await auth.hashPassword('admin123');

  assert.equal(a, SHA256_ADMIN123);
  assert.equal(b, SHA256_ADMIN123);
  assert.equal(await auth.verifyPassword('admin123', a), true);
  assert.equal(await auth.verifyPassword('admin124', a), false);
});

test('verifyPassword: chấp nhận hash SHA-256 cũ và plaintext', async () => {
  const auth = new AuthService(LocalRepository.getInstance());
  assert.equal(await auth.verifyPassword('admin123', SHA256_ADMIN123), true);
  assert.equal(await auth.verifyPassword('admin124', SHA256_ADMIN123), false);
  assert.equal(await auth.verifyPassword('test1234', 'test1234'), true);
});

test('authenticate: giữ nguyên hash SHA-256, không tự đổi định dạng', async () => {
  const repo = LocalRepository.getInstance();
  const auth = new AuthService(repo);

  await repo.createUser({
    id: 'ST_HASH_UPGRADE',
    username: 'st_hash_upgrade',
    passwordHash: SHA256_ADMIN123,
    role: 'STUDENT',
    name: 'Học viên',
    isActive: true,
  });

  const before = await repo.getUserById('ST_HASH_UPGRADE');
  assert.equal(before?.passwordHash, SHA256_ADMIN123);

  const loggedIn = await auth.authenticate('st_hash_upgrade', 'admin123');
  assert.equal(loggedIn?.id, 'ST_HASH_UPGRADE');

  const after = await repo.getUserById('ST_HASH_UPGRADE');
  // Giữ nguyên định dạng SHA-256 cũ
  assert.equal(after?.passwordHash, SHA256_ADMIN123);

  assert.equal((await auth.authenticate('st_hash_upgrade', 'admin123'))?.id, 'ST_HASH_UPGRADE');
  assert.equal(await auth.authenticate('st_hash_upgrade', 'sai_mat_khau'), null);
});
