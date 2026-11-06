import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from '../src/repositories';
import { PUT as updateTeacherRoute, GET as getTeacherRoute } from '../src/app/api/teachers/route';
import { authed, sessionCookie } from './helpers/auth';

describe('Teacher Management & Edit Profile Suite', () => {
  it('1. Cập nhật thông tin giảng viên qua API PUT /api/teachers với bộ môn tự do dạng text', async () => {
    // Lấy giảng viên GV001 hiện tại
    const gv1 = await repo.getTeacherById('GV001');
    assert.ok(gv1, 'GV001 phải tồn tại');

    // Gọi API PUT cập nhật
    const req = authed('http://localhost/api/teachers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'GV001',
        name: 'Thầy Nguyễn Văn A (Master)',
        specialty: 'Toán Olympic & Luyện Thi Chuyên', // Text tự do theo yêu cầu người dùng
        phone: '0988776655',
        bio: 'Hơn 10 năm kinh nghiệm bồi dưỡng học sinh giỏi',
        status: 'Đang dạy'
      })
    });

    const res = await updateTeacherRoute(req);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.teacher.specialty, 'Toán Olympic & Luyện Thi Chuyên');
    assert.equal(data.teacher.name, 'Thầy Nguyễn Văn A (Master)');

    // Kiểm tra trong repo
    const updated = await repo.getTeacherById('GV001');
    assert.equal(updated?.specialty, 'Toán Olympic & Luyện Thi Chuyên');
    assert.equal(updated?.phone, '0988776655');
  });

  it('2. Kiểm tra ghi nhận Audit Log khi cập nhật giảng viên', async () => {
    const logs = await repo.getAllAuditLogs();
    const updateLog = logs.find(l => l.action === 'UPDATE' && l.targetId === 'GV001');
    assert.ok(updateLog, 'Phải có Audit Log UPDATE cho GV001');
  });
});
