import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/app/api/auth/login/route';
import { LocalRepository } from '../src/repositories/LocalRepository';
import { authed, sessionCookie } from './helpers/auth';

test('Auth API Suite: Kiểm tra xác thực đăng nhập qua /api/auth/login', async (t) => {
  const repo = LocalRepository.getInstance();

  await t.test('1. Đăng nhập sai mật khẩu -> nhận 401 Unauthorized', async () => {
    const req = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'wrongpassword',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401, 'Status code phải là 401 khi mật khẩu sai');

    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Tên đăng nhập hoặc mật khẩu không chính xác');
  });

  await t.test('2. Đăng nhập đúng mật khẩu (admin / admin123) -> nhận 200 OK và user profile sanitized', async () => {
    const req = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200, 'Status code phải là 200 khi đăng nhập thành công');

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.user, 'Phải có object user');
    assert.equal(body.user.username, 'admin');
    assert.equal(body.user.role, 'ADMIN');
    assert.equal(body.user.passwordHash, undefined, 'passwordHash tuyệt đối không được trả về');

    // Kiểm tra Audit Log đã được ghi nhận
    const logs = await repo.getAllAuditLogs();
    const loginLog = logs.find(l => l.action === 'LOGIN' && l.userId === body.user.id);
    assert.ok(loginLog, 'Audit log LOGIN phải được tạo');
  });

  await t.test('3. Đăng nhập bằng mã định danh viết hoa (ADMIN001 / admin123) -> nhận 200 OK', async () => {
    const req = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ADMIN001',
        password: 'admin123',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.id, 'ADMIN001');
  });

  await t.test('4. Đăng nhập tài khoản giáo viên (gv001 / teacher123) -> nhận 200 OK', async () => {
    const req = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'gv001',
        password: 'teacher123',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.role, 'TEACHER');
    assert.equal(body.user.passwordHash, undefined);
  });

  await t.test('5. Đăng nhập tài khoản học viên (st001 / student123) -> nhận 200 OK', async () => {
    const req = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'st001',
        password: 'student123',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.user.role, 'STUDENT');
    assert.equal(body.user.passwordHash, undefined);
  });

  await t.test('6. Tài khoản không tồn tại -> nhận 401 Unauthorized', async () => {
    const req = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'non_existent_user_9999',
        password: 'any_password',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Tên đăng nhập hoặc mật khẩu không chính xác');
  });

  await t.test('7. Tài khoản bị vô hiệu hóa (isActive = false) -> nhận 401 Unauthorized', async () => {
    // Tạo user bị vô hiệu hoá
    const disabledUser = {
      id: 'INACTIVE001',
      username: 'inactive_user',
      passwordHash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // admin123
      role: 'STUDENT' as const,
      name: 'Người dùng bị khóa',
      isActive: false,
    };
    await repo.createUser(disabledUser);

    const req = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'inactive_user',
        password: 'admin123',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401, 'User isActive=false không được phép đăng nhập');
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Tên đăng nhập hoặc mật khẩu không chính xác');
  });

  await t.test('8. Thiếu username hoặc password -> nhận 401 Unauthorized', async () => {
    const reqEmptyPass = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: '',
      }),
    });

    const res1 = await POST(reqEmptyPass);
    assert.equal(res1.status, 401);

    const reqEmptyUser = authed('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '   ',
        password: 'admin123',
      }),
    });

    const res2 = await POST(reqEmptyUser);
    assert.equal(res2.status, 401);
  });
});
