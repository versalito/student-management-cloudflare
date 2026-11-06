'use client';

import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, Save, ShieldCheck } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useApp } from '@/context/AppContext';

/**
 * Ô đổi mật khẩu dùng chung cho cả ba cổng.
 * Người dùng tự nhập mật khẩu hiện tại rồi đặt mật khẩu mới.
 */
export const ChangePasswordCard: React.FC<{ className?: string }> = ({ className }) => {
  const toast = useToast();
  const { currentUser } = useApp();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (!currentPassword) {
      toast.error('Nhập mật khẩu hiện tại của bạn');
      return;
    }
    if (!newPassword) {
      toast.error('Nhập mật khẩu mới');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Xác nhận mật khẩu mới không khớp');
      return;
    }
    if (newPassword === currentPassword) {
      toast.error('Mật khẩu mới phải khác mật khẩu hiện tại');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/users/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đổi mật khẩu thành công');
        reset();
      } else {
        toast.error(data.error || 'Đổi mật khẩu thất bại');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi kết nối mạng');
    } finally {
      setSaving(false);
    }
  };

  const inputType = showPasswords ? 'text' : 'password';

  return (
    <Card className={className}>
      <CardHeader
        icon={<KeyRound size={18} />}
        title="Đổi mật khẩu"
        subtitle="Dùng mật khẩu hiện tại để đặt mật khẩu mới cho tài khoản của bạn"
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Mật khẩu hiện tại" required>
          <Input
            type={inputType}
            autoComplete="current-password"
            placeholder="Nhập mật khẩu đang dùng"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Mật khẩu mới" required>
            <Input
              type={inputType}
              autoComplete="new-password"
              placeholder="Nhập mật khẩu mới"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="Nhập lại mật khẩu mới" required>
            <Input
              type={inputType}
              autoComplete="new-password"
              placeholder="Nhập lại mật khẩu mới"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </Field>
        </div>

        <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(e) => setShowPasswords(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-primary,#2563eb)] cursor-pointer"
          />
          <span className="inline-flex items-center gap-1.5">
            {showPasswords ? <EyeOff size={14} /> : <Eye size={14} />}
            Hiện mật khẩu
          </span>
        </label>

        <div className="pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-primary shrink-0" />
            Sau khi đổi, lần đăng nhập sau bạn dùng mật khẩu mới.
          </p>
          <Button type="submit" loading={saving} icon={<Save size={16} />}>
            Lưu mật khẩu mới
          </Button>
        </div>
      </form>
    </Card>
  );
};
