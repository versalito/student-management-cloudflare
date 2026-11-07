import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import { AuthService } from '../src/services/AuthService';
import { PUT as changePassword } from '../src/app/api/users/password/route';
import { authedAsStudent } from './helpers/auth';

/** Đổi mật khẩu luôn chạy dưới phiên của chính chủ tài khoản. */
function req(body: Record<string, unknown>, actorId: string = String(body.userId ?? '')) {
  return authedAsStudent(actorId)('http://localhost/api/users/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Self-service Password Change Suite', () => {
  const userId = 'ST_PWD_TEST_01';
  const auth = new AuthService(repo);

  async function ensureUser() {
    const existing = await repo.getUserById(userId);
    if (existing) {
      existing.passwordHash = await auth.hashPassword('matkhau_cu');
      existing.isActive = true;
      await repo.updateUser(existing);
      return;
    }
    await repo.createUser({
      id: userId,
      username: 'st_pwd_01',
      passwordHash: await auth.hashPassword('matkhau_cu'),
      role: 'STUDENT',
      name: 'Học viên đổi mật khẩu',
      isActive: true,
    });
  }

  it('1. Sai mật khẩu hiện tại thì bị từ chối', async () => {
    await ensureUser();
    const res = await changePassword(req({ userId, currentPassword: 'sai_mat_khau', newPassword: 'matkhau_moi' }));
    const data = await res.json();
    assert.equal(res.status, 401);
    assert.ok(String(data.error).includes('hiện tại'));
  });

  it('2. Không áp đặt độ dài tối thiểu, nhưng mật khẩu rỗng thì bị từ chối', async () => {
    await ensureUser();
    const res = await changePassword(req({ userId, currentPassword: 'matkhau_cu', newPassword: '' }));
    assert.equal(res.status, 400);

    // Mật khẩu ngắn (4 ký tự) vẫn đổi được theo chính sách của trung tâm.
    const ok = await changePassword(req({ userId, currentPassword: 'matkhau_cu', newPassword: '1234' }));
    assert.equal(ok.status, 200);
    const loggedIn = await auth.authenticate('st_pwd_01', '1234');
    assert.equal(loggedIn?.id, userId);
  });

  it('3. Mật khẩu mới trùng mật khẩu hiện tại thì bị từ chối', async () => {
    await ensureUser();
    const res = await changePassword(req({ userId, currentPassword: 'matkhau_cu', newPassword: 'matkhau_cu' }));
    assert.equal(res.status, 400);
  });

  it('4. Thiếu tham số thì bị từ chối', async () => {
    const res = await changePassword(req({ userId }));
    assert.equal(res.status, 400);
  });

  it('5. Tài khoản không tồn tại thì trả 404', async () => {
    const res = await changePassword(req({ userId: 'KHONG_TON_TAI', currentPassword: 'a123456', newPassword: 'b123456' }));
    assert.equal(res.status, 404);
  });

  it('7. Không đổi được mật khẩu của người khác, kể cả khi biết mật khẩu hiện tại của họ', async () => {
    await ensureUser();
    // Học viên khác cầm đúng mật khẩu của nạn nhân vẫn bị chặn: đây từng là lỗ
    // hổng chiếm tài khoản (học viên đổi được mật khẩu của quản trị viên vì
    // mật khẩu mặc định ai cũng biết).
    const res = await changePassword(
      req({ userId, currentPassword: 'matkhau_cu', newPassword: 'chiem_tai_khoan' }, 'ST_KHAC_01')
    );
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.ok(String(data.error).includes('chính mình'));
    // Mật khẩu của nạn nhân không đổi.
    assert.equal((await auth.authenticate('st_pwd_01', 'matkhau_cu'))?.id, userId);
  });

  it('6. Đúng mật khẩu hiện tại thì đổi được và mật khẩu mới dùng để đăng nhập', async () => {
    await ensureUser();
    const res = await changePassword(req({ userId, currentPassword: 'matkhau_cu', newPassword: 'matkhau_moi' }));
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    // Mật khẩu cũ không còn dùng được
    assert.equal(await auth.authenticate('st_pwd_01', 'matkhau_cu'), null);
    // Mật khẩu mới đăng nhập được
    const loggedIn = await auth.authenticate('st_pwd_01', 'matkhau_moi');
    assert.equal(loggedIn?.id, userId);
  });
});
