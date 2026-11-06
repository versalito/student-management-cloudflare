'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { User, Role } from '@/types/auth';
import { DataTable, Pager, Column } from '@/components/ui/DataTable';
import { SegmentedControl, TabItem } from '@/components/ui/Tabs';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Card, StatCard } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { ChangePasswordCard } from '@/components/account/ChangePasswordCard';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useApp } from '@/context/AppContext';
import {
  Users,
  Shield,
  GraduationCap,
  UserCheck,
  Plus,
  Edit,
  KeyRound,
  Trash2,
  AlertTriangle,
  Lock,
  Info,
} from 'lucide-react';

const ROLE_LABELS: Record<Role, { label: string; tone: 'danger' | 'info' | 'primary' }> = {
  ADMIN: { label: 'Quản trị viên', tone: 'danger' },
  TEACHER: { label: 'Giáo viên', tone: 'info' },
  STUDENT: { label: 'Học viên', tone: 'primary' },
};

export default function AdminAccountsPage() {
  const toast = useToast();
  const { currentUser } = useApp();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Phân trang
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // Sheet Chỉnh sửa thông tin
  const [editingProfileUser, setEditingProfileUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Sheet Đổi mật khẩu
  const [editingPasswordUser, setEditingPasswordUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Sheet Tạo tài khoản mới
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUserFormData, setNewUserFormData] = useState({
    username: '',
    name: '',
    role: 'STUDENT' as Role,
    password: 'password123',
  });

  // Sheet Xác nhận xóa
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      console.error(e);
      toast.error('Không thể tải danh sách tài khoản');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfileUser) return;
    if (!editName.trim()) {
      toast.error('Vui lòng nhập họ và tên');
      return;
    }

    setIsUpdatingProfile(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingProfileUser.id,
          newName: editName.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || ('Cập nhật tài khoản ' + editName + ' thành công'));
        setEditingProfileUser(null);
        await loadUsers();
      } else {
        toast.error(data.error || 'Cập nhật tài khoản thất bại');
      }
    } catch (err: any) {
      toast.error(err.message || 'Lỗi mạng khi cập nhật');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPasswordUser) return;

    if (!newPassword) {
      toast.error('Nhập mật khẩu mới');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Xác nhận mật khẩu mới không khớp');
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingPasswordUser.id,
          newPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || ('Đã đổi mật khẩu cho ' + editingPasswordUser.name));
        setEditingPasswordUser(null);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(data.error || 'Đổi mật khẩu thất bại');
      }
    } catch (err: any) {
      toast.error(err.message || 'Lỗi mạng khi đổi mật khẩu');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserFormData.username.trim() || !newUserFormData.name.trim()) {
      toast.error('Vui lòng nhập tên đăng nhập và họ tên');
      return;
    }

    setIsCreatingUser(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUserFormData),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Tạo tài khoản mới thành công');
        setShowCreateSheet(false);
        setNewUserFormData({
          username: '',
          name: '',
          role: 'STUDENT',
          password: 'password123',
        });
        await loadUsers();
      } else {
        toast.error(data.error || 'Tạo tài khoản thất bại');
      }
    } catch (err: any) {
      toast.error(err.message || 'Lỗi mạng khi tạo tài khoản');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteConfirmUser) return;
    setIsDeleting(true);

    try {
      const res = await fetch('/api/users?id=' + encodeURIComponent(deleteConfirmUser.id), {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || ('Đã xóa tài khoản ' + deleteConfirmUser.name));
        setDeleteConfirmUser(null);
        await loadUsers();
      } else {
        toast.error(data.error || 'Xóa tài khoản thất bại');
      }
    } catch (err: any) {
      toast.error(err.message || 'Lỗi mạng khi xóa tài khoản');
    } finally {
      setIsDeleting(false);
    }
  };

  // Thống kê nhanh
  const stats = useMemo(() => {
    const adminCount = users.filter((u) => u.role === 'ADMIN').length;
    const teacherCount = users.filter((u) => u.role === 'TEACHER').length;
    const studentCount = users.filter((u) => u.role === 'STUDENT').length;
    return {
      total: users.length,
      admin: adminCount,
      teacher: teacherCount,
      student: studentCount,
    };
  }, [users]);

  const roleTabs: TabItem<string>[] = useMemo(() => {
    return [
      { value: 'ALL', label: 'Tất cả', count: users.length },
      { value: 'ADMIN', label: 'Quản trị viên', count: stats.admin },
      { value: 'TEACHER', label: 'Giáo viên', count: stats.teacher },
      { value: 'STUDENT', label: 'Học viên', count: stats.student },
    ];
  }, [users.length, stats.admin, stats.teacher, stats.student]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.id?.toLowerCase().includes(q) ||
        u.name?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q)
      );
    });
  }, [users, roleFilter, searchTerm]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginatedUsers = useMemo(() => {
    return filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filtered, currentPage, pageSize]);

  const isSuperAdmin = (u: User) => {
    return u.id.toUpperCase() === 'ADMIN001' || u.username.toLowerCase() === 'admin';
  };

  const columns: Column<User>[] = [
    {
      key: 'user',
      header: 'Tài khoản & Người dùng',
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name} size={38} />
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-[14px] leading-tight truncate">{row.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[11px] font-bold text-foreground">{row.id}</span>
              <span className="font-mono text-[11px] text-muted-foreground">@{row.username}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Vai trò',
      className: 'w-36 whitespace-nowrap',
      render: (row) => {
        const cfg = ROLE_LABELS[row.role] || { label: row.role, tone: 'primary' };
        return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
      },
    },
    {
      key: 'status',
      header: 'Trạng thái',
      className: 'w-32 whitespace-nowrap',
      render: (row) => (
        <Badge tone={row.isActive !== false ? 'success' : 'neutral'} dot>
          {row.isActive !== false ? 'Hoạt động' : 'Tạm khóa'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      className: 'w-36 whitespace-nowrap',
      render: (row) => {
        const fixed = isSuperAdmin(row);
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-primary"
              onClick={() => {
                setEditingProfileUser(row);
                setEditName(row.name || '');
              }}
              aria-label="Sửa thông tin"
            >
              <Edit size={15} />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-primary"
              onClick={() => {
                setEditingPasswordUser(row);
                setNewPassword('');
                setConfirmPassword('');
              }}
              aria-label="Đổi mật khẩu"
            >
              <KeyRound size={15} />
            </Button>

            {fixed ? (
              <span className="inline-block px-2 py-1 text-[11px] font-semibold text-subtle-foreground bg-muted rounded-pill cursor-not-allowed">
                Cố định
              </span>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-danger"
                onClick={() => setDeleteConfirmUser(row)}
                aria-label="Xóa tài khoản"
              >
                <Trash2 size={15} />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Tài khoản & Phân quyền"
          subtitle="Quản lý thông tin đăng nhập, cấp quyền và đổi mật khẩu cho toàn hệ thống"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Đổi mật khẩu cho chính tài khoản đang đăng nhập */}
          <ChangePasswordCard />

          {/* Thống kê tài khoản */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Tổng số tài khoản"
              value={stats.total}
              icon={<Users size={20} />}
              tone="primary"
            />
            <StatCard
              label="Quản trị viên"
              value={stats.admin}
              icon={<Shield size={20} />}
              tone="danger"
            />
            <StatCard
              label="Tài khoản giáo viên"
              value={stats.teacher}
              icon={<UserCheck size={20} />}
              tone="info"
            />
            <StatCard
              label="Tài khoản học viên"
              value={stats.student}
              icon={<GraduationCap size={20} />}
              tone="primary"
            />
          </div>

          {/* Bộ lọc, tìm kiếm & Nút tạo mới */}
          <Card padded={false} className="p-3 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <SearchInput
                value={searchTerm}
                onChange={(v) => {
                  setSearchTerm(v);
                  setCurrentPage(1);
                }}
                placeholder="Tìm mã ID, tên hiển thị, username..."
                className="w-full sm:w-80"
              />

              <Button
                variant="primary"
                icon={<Plus size={16} />}
                onClick={() => setShowCreateSheet(true)}
              >
                Thêm tài khoản mới
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-line">
              <SegmentedControl
                items={roleTabs}
                value={roleFilter}
                onChange={(v) => {
                  setRoleFilter(v);
                  setCurrentPage(1);
                }}
              />
              <p className="text-[12px] text-muted-foreground tabular shrink-0">
                Hiển thị <span className="font-bold text-foreground">{filtered.length}</span> / {users.length} tài khoản
              </p>
            </div>
          </Card>

          {/* Bảng dữ liệu */}
          <DataTable
            columns={columns}
            rows={paginatedUsers}
            rowKey={(row) => row.id}
            loading={loading}
            emptyTitle="Không tìm thấy tài khoản"
            emptyDescription="Chưa có tài khoản nào phù hợp với bộ lọc hiện tại."
            emptyIcon={<Users size={28} />}
            renderMobile={(row) => {
              const cfg = ROLE_LABELS[row.role] || { label: row.role, tone: 'primary' };
              const fixed = isSuperAdmin(row);

              return (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={row.name} size={38} />
                      <div>
                        <p className="font-bold text-foreground text-[14px] leading-tight">{row.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[11px] font-bold text-foreground">{row.id}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">@{row.username}</span>
                        </div>
                      </div>
                    </div>
                    <Badge tone={cfg.tone}>{cfg.label}</Badge>
                  </div>

                  <div className="text-[12px] space-y-1 pt-1 border-t border-line">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Trạng thái:</span>
                      <Badge tone={row.isActive !== false ? 'success' : 'neutral'} dot>
                        {row.isActive !== false ? 'Hoạt động' : 'Tạm khóa'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-line">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Edit size={14} />}
                      onClick={() => {
                        setEditingProfileUser(row);
                        setEditName(row.name || '');
                      }}
                    >
                      Sửa thông tin
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<KeyRound size={14} />}
                      onClick={() => {
                        setEditingPasswordUser(row);
                        setNewPassword('');
                        setConfirmPassword('');
                      }}
                    >
                      Đổi mật khẩu
                    </Button>
                    {!fixed && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger-soft/20"
                        icon={<Trash2 size={14} />}
                        onClick={() => setDeleteConfirmUser(row)}
                      >
                        Xóa
                      </Button>
                    )}
                  </div>
                </div>
              );
            }}
            footer={
              <Pager
                page={currentPage}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setCurrentPage(1);
                }}
              />
            }
          />
        </main>

        {/* Sheet Cập nhật thông tin */}
        <Sheet
          isOpen={!!editingProfileUser}
          onClose={() => setEditingProfileUser(null)}
          title="Cập nhật tài khoản"
          description={editingProfileUser ? ('Mã ID: ' + editingProfileUser.id + ' (' + editingProfileUser.role + ')') : undefined}
          footer={
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
              <Button variant="secondary" onClick={() => setEditingProfileUser(null)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={isUpdatingProfile}
                onClick={handleUpdateProfile}
              >
                Lưu thông tin
              </Button>
            </div>
          }
        >
          <form onSubmit={handleUpdateProfile} className="space-y-4 pt-1">
            <Field label="Họ và tên" required>
              <Input
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </Field>

            <div className="p-3 rounded-field bg-primary-soft/40 border border-primary-soft text-primary-ink text-[12px] flex items-start gap-2 leading-relaxed">
              <Info size={16} className="shrink-0 mt-0.5" />
              <span>
                <strong>Đồng bộ tự động:</strong> Khi bạn thay đổi họ tên, hệ thống sẽ tự động cập nhật ngay lập tức sang hồ sơ tại mục Quản lý học sinh hoặc Quản lý giáo viên tương ứng.
              </span>
            </div>
          </form>
        </Sheet>

        {/* Sheet Đổi mật khẩu */}
        <Sheet
          isOpen={!!editingPasswordUser}
          onClose={() => setEditingPasswordUser(null)}
          title="Đổi mật khẩu tài khoản"
          description={editingPasswordUser ? ('Tài khoản: ' + editingPasswordUser.name + ' (' + editingPasswordUser.id + ')') : undefined}
          footer={
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
              <Button variant="secondary" onClick={() => setEditingPasswordUser(null)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={isChangingPassword}
                onClick={handleChangePassword}
              >
                Lưu mật khẩu mới
              </Button>
            </div>
          }
        >
          <form onSubmit={handleChangePassword} className="space-y-4 pt-1">
            <Field label="Mật khẩu mới" required>
              <Input
                type="password"
                required
                placeholder="Nhập mật khẩu mới"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>

            <Field label="Xác nhận mật khẩu mới" required>
              <Input
                type="password"
                required
                placeholder="Nhập lại mật khẩu mới"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
          </form>
        </Sheet>

        {/* Sheet Thêm tài khoản mới */}
        <Sheet
          isOpen={showCreateSheet}
          onClose={() => setShowCreateSheet(false)}
          title="Thêm tài khoản mới"
          description="Tạo tài khoản đăng nhập và phân quyền truy cập hệ thống"
          footer={
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
              <Button variant="secondary" onClick={() => setShowCreateSheet(false)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={isCreatingUser}
                onClick={handleCreateUser}
              >
                Tạo tài khoản
              </Button>
            </div>
          }
        >
          <form onSubmit={handleCreateUser} className="space-y-4 pt-1">
            <Field label="Tên đăng nhập (Username)" required hint="Viết liền, không dấu (ví dụ: gv_nguyenan hoặc st001)">
              <Input
                required
                placeholder="Ví dụ: gv_nguyenan"
                value={newUserFormData.username}
                onChange={(e) => setNewUserFormData({ ...newUserFormData, username: e.target.value })}
              />
            </Field>

            <Field label="Họ và tên hiển thị" required>
              <Input
                required
                placeholder="Ví dụ: Nguyễn Văn An"
                value={newUserFormData.name}
                onChange={(e) => setNewUserFormData({ ...newUserFormData, name: e.target.value })}
              />
            </Field>

            <Field label="Vai trò hệ thống" required>
              <Select
                value={newUserFormData.role}
                onChange={(e) => setNewUserFormData({ ...newUserFormData, role: e.target.value as Role })}
              >
                <option value="STUDENT">Học viên (Student)</option>
                <option value="TEACHER">Giáo viên (Teacher)</option>
                <option value="ADMIN">Quản trị viên (Admin)</option>
              </Select>
            </Field>

            <Field label="Mật khẩu khởi tạo" required hint="Mặc định: password123 (người dùng có thể đổi sau)">
              <Input
                type="text"
                required
                value={newUserFormData.password}
                onChange={(e) => setNewUserFormData({ ...newUserFormData, password: e.target.value })}
              />
            </Field>
          </form>
        </Sheet>

        {/* Sheet Xác nhận xóa tài khoản */}
        <Sheet
          isOpen={!!deleteConfirmUser}
          onClose={() => !isDeleting && setDeleteConfirmUser(null)}
          title="Xác nhận xóa tài khoản"
          size="sm"
          footer={
            <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
              <Button
                variant="secondary"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmUser(null)}
              >
                Hủy
              </Button>
              <Button
                variant="danger"
                loading={isDeleting}
                icon={<Trash2 size={15} />}
                onClick={handleDeleteUser}
              >
                Xóa vĩnh viễn
              </Button>
            </div>
          }
        >
          {deleteConfirmUser && (
            <div className="space-y-3 pt-1 text-[13px]">
              <div className="p-3.5 rounded-field bg-muted space-y-1.5 border border-line">
                <p className="font-semibold text-foreground text-sm">{deleteConfirmUser.name}</p>
                <p className="font-mono text-[12px] text-muted-foreground">Mã ID: {deleteConfirmUser.id} (@{deleteConfirmUser.username})</p>
                <p className="text-[12px] text-muted-foreground">
                  Vai trò: <span className="font-semibold text-foreground">{deleteConfirmUser.role}</span>
                </p>
              </div>

              <div className="p-3 rounded-field bg-danger-soft/40 border border-danger-soft text-danger text-[12px] flex items-start gap-2 leading-relaxed">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>
                  Thao tác này sẽ xóa vĩnh viễn quyền truy cập của người dùng này khỏi hệ thống và không thể hoàn tác.
                </span>
              </div>
            </div>
          )}
        </Sheet>
      </div>
    </RoleGuard>
  );
}
