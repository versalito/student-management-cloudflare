'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { TuitionInvoice } from '@/types/finance';
import { AdminBankConfig, DEFAULT_BANK_CONFIG, SUPPORTED_BANKS } from '@/types/bank';
import { generateVietQRUrl } from '@/utils/vietqr';
import { BankWebhookSimulator } from '@/components/tuition/BankWebhookSimulator';
import { SessionPackage } from '@/types/package';
import {
  Button,
  Card,
  CardHeader,
  StatCard,
  Badge,
  TuitionBadge,
  Field,
  Input,
  Textarea,
  Select,
  Sheet,
  SegmentedControl,
  SearchInput,
  DataTable,
  Pager,
  EmptyState,
  useToast,
} from '@/components/ui';
import type { Column } from '@/components/ui/DataTable';
import {
  Package,
  Pencil,
  Trash2,
  Receipt,
  Plus,
  CreditCard,
  QrCode,
  Copy,
  Wallet,
  TrendingUp,
  AlertTriangle,
  Building2,
  Zap,
  CheckCircle2,
} from 'lucide-react';

const STATUS_TABS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'Đã nộp', label: 'Đã nộp' },
  { value: 'Còn nợ', label: 'Còn nợ' },
  { value: 'Quá hạn', label: 'Quá hạn' },
  { value: 'Miễn giảm', label: 'Miễn giảm' },
  { value: 'Đã hủy', label: 'Đã hủy' },
];

const money = (v: number) => (v || 0).toLocaleString('vi-VN') + ' đ';

export default function AdminTuitionPage() {
  const toast = useToast();

  const [invoices, setInvoices] = useState<TuitionInvoice[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'invoices' | 'packages'>('invoices');

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [students, setStudents] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);

  const [studentId, setStudentId] = useState('');
  const [title, setTitle] = useState('');
  const [originalAmount, setOriginalAmount] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [bankConfig, setBankConfig] = useState<AdminBankConfig>(DEFAULT_BANK_CONFIG);
  const [savingBank, setSavingBank] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  const [packages, setPackages] = useState<SessionPackage[]>([]);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<SessionPackage | null>(null);
  const [pkgName, setPkgName] = useState('');
  const [pkgSessionCount, setPkgSessionCount] = useState<number | string>(10);
  const [pkgPrice, setPkgPrice] = useState<number | string>(1000000);
  const [pkgIsActive, setPkgIsActive] = useState(true);
  const [pkgDescription, setPkgDescription] = useState('');
  const [isSavingPkg, setIsSavingPkg] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [deletingPackage, setDeletingPackage] = useState<SessionPackage | null>(null);
  const [isDeletingPkg, setIsDeletingPkg] = useState(false);

  const [updatingInvoice, setUpdatingInvoice] = useState<TuitionInvoice | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>('Đã nộp');
  const [updateMethod, setUpdateMethod] = useState<string>('Tiền mặt');
  const [updatePaidDate, setUpdatePaidDate] = useState<string>('');
  const [updateNotes, setUpdateNotes] = useState<string>('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [viewingQrInvoice, setViewingQrInvoice] = useState<TuitionInvoice | null>(null);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/finance');
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (e) {
      console.error('Error fetching invoices:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchBankConfig = async () => {
    try {
      const res = await fetch('/api/settings/bank');
      const data = await res.json();
      if (data.success && data.bankConfig) {
        setBankConfig(data.bankConfig);
      }
    } catch (e) {
      console.error('Error fetching bank config:', e);
    }
  };

  const fetchPackages = async () => {
    try {
      const res = await fetch('/api/packages');
      const data = await res.json();
      if (data.success && data.packages) {
        setPackages(data.packages);
      }
    } catch (e) {
      console.error('Error fetching packages:', e);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchBankConfig();
    fetchPackages();
  }, []);

  const openCreatePackageModal = () => {
    setEditingPackage(null);
    setPkgName('');
    setPkgSessionCount(10);
    setPkgPrice(1000000);
    setPkgIsActive(true);
    setPkgDescription('');
    setPackageError(null);
    setIsPackageModalOpen(true);
  };

  const openEditPackageModal = (pkg: SessionPackage) => {
    setEditingPackage(pkg);
    setPkgName(pkg.name);
    setPkgSessionCount(pkg.sessionCount);
    setPkgPrice(pkg.price);
    setPkgIsActive(pkg.isActive);
    setPkgDescription(pkg.description || '');
    setPackageError(null);
    setIsPackageModalOpen(true);
  };

  const handleSavePackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPkg(true);
    setPackageError(null);

    try {
      const isEdit = Boolean(editingPackage);
      const url = '/api/packages';
      const method = isEdit ? 'PUT' : 'POST';
      const bodyPayload: any = {
        name: pkgName,
        sessionCount: Number(pkgSessionCount),
        price: Number(pkgPrice),
        isActive: pkgIsActive,
        description: pkgDescription,


      };
      if (isEdit && editingPackage) {
        bodyPayload.id = editingPackage.id;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không lưu được gói');
      }

      setIsPackageModalOpen(false);
      toast.success(isEdit ? 'Đã cập nhật gói ' + editingPackage?.name : 'Đã tạo gói ' + pkgName);
      await fetchPackages();
    } catch (err: any) {
      setPackageError(err.message || 'Không kết nối được máy chủ');
    } finally {
      setIsSavingPkg(false);
    }
  };

  const handleTogglePackageActive = async (pkg: SessionPackage) => {
    try {
      const res = await fetch('/api/packages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pkg.id,
          isActive: !pkg.isActive,


        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success((pkg.isActive ? 'Đã ẩn gói ' : 'Đã mở bán gói ') + pkg.name);
        await fetchPackages();
      }
    } catch (err) {
      console.error('Error toggling package:', err);
    }
  };

  const handleDeletePackage = async () => {
    if (!deletingPackage) return;
    setIsDeletingPkg(true);
    try {
      const res = await fetch('/api/packages?id=' + deletingPackage.id, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('Đã xoá gói ' + deletingPackage.name);
        setDeletingPackage(null);
        await fetchPackages();
      }
    } catch (err) {
      console.error('Error deleting package:', err);
    } finally {
      setIsDeletingPkg(false);
    }
  };

  const openCreateModal = async () => {
    setIsCreateModalOpen(true);
    setFormError(null);
    const next15Days = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setDueDate(next15Days);
    setStudentId('');
    setTitle('');
    setOriginalAmount('');
    setSessionCount(0);
    setNotes('');

    if (students.length === 0) {
      try {
        setLoadingOptions(true);
        const resStudents = await fetch('/api/students?limit=all');
        const dataStudents = await resStudents.json();
        setStudents((dataStudents.students || []).map((s: any) => ({
          id: s.id,
          name: s.name,
        })));
      } catch (err) {
        console.error('Error fetching students for modal:', err);
      } finally {
        setLoadingOptions(false);
      }
    }
  };

  const openStatusModal = (inv: TuitionInvoice) => {
    setUpdatingInvoice(inv);
    setUpdateStatus(inv.status);
    setUpdateMethod(inv.paymentMethod || 'Tiền mặt');
    setUpdatePaidDate(inv.paidDate || new Date().toISOString().split('T')[0]);
    setUpdateNotes('');
    setUpdateError(null);
  };

  const handleUpdateStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updatingInvoice) return;

    setIsUpdatingStatus(true);
    setUpdateError(null);

    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_STATUS',
          invoiceId: updatingInvoice.id,
          status: updateStatus,
          paymentMethod: (updateStatus === 'Đã nộp' || updateStatus === 'Miễn giảm') ? updateMethod : undefined,
          paidDate: (updateStatus === 'Đã nộp' || updateStatus === 'Miễn giảm') ? updatePaidDate : undefined,
          transactionCode: updateStatus === 'Đã nộp' ? (updatingInvoice.transactionCode || 'MANUAL-' + Date.now()) : undefined,
          reason: updateNotes.trim() || undefined,
          note: updateNotes.trim() || undefined,


        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Cập nhật thất bại');
      }

      setUpdatingInvoice(null);
      toast.success('Hoá đơn ' + updatingInvoice.id + ' chuyển sang ' + updateStatus);
      await fetchInvoices();
    } catch (err: any) {
      setUpdateError(err.message || 'Không kết nối được máy chủ');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSaveBankConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBank(true);
    setBankError(null);

    try {
      const res = await fetch('/api/settings/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bankConfig),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không lưu được tài khoản');
      }

      try {
        localStorage.setItem('admin_bank_config', JSON.stringify(data.bankConfig));
      } catch (e) {}

      setIsBankModalOpen(false);
      toast.success('Đã lưu tài khoản nhận tiền');
    } catch (err: any) {
      setBankError(err.message || 'Không kết nối được máy chủ');
    } finally {
      setSavingBank(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!studentId) {
      setFormError('Chọn học viên trước.');
      return;
    }
    if (!title.trim()) {
      setFormError('Nhập tiêu đề khoản thu.');
      return;
    }
    if (!originalAmount || Number(originalAmount) <= 0) {
      setFormError('Số tiền phải lớn hơn 0.');
      return;
    }
    if (!dueDate) {
      setFormError('Chọn hạn nộp.');
      return;
    }

    const finalAmount = Number(originalAmount);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE',
          studentId,
          title: title.trim(),
          originalAmount: Number(originalAmount),
          sessionCount: Number(sessionCount) || 0,
          finalAmount,
          dueDate,
          notes: notes.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Không tạo được hoá đơn.');
      }

      toast.success('Đã tạo hoá đơn ' + (result.invoice?.id || ''));
      setIsCreateModalOpen(false);
      await fetchInvoices();
    } catch (err: any) {
      setFormError(err.message || 'Không kết nối được máy chủ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = invoices.filter(inv => {
    const q = searchTerm.toLowerCase();
    const matchSearch =
      inv.studentId.toLowerCase().includes(q) ||
      inv.id.toLowerCase().includes(q) ||
      (inv.classId && inv.classId.toLowerCase().includes(q)) ||
      (inv.title || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'ALL' || inv.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const paginatedInvoices = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (st: string) => {
    setStatusFilter(st);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const totalAmount = invoices.reduce((s, i) => s + i.amount, 0);
  const totalPaid = invoices.reduce((s, i) => s + i.paidAmount, 0);
  const totalDebt = invoices.reduce((s, i) => s + i.remainingAmount, 0);

  const columns: Column<TuitionInvoice>[] = [
    {
      key: 'id',
      header: 'Mã HĐ',
      render: (inv) => <span className="font-mono font-semibold text-foreground">{inv.id}</span>,
    },
    {
      key: 'student',
      header: 'Học viên',
      render: (inv) => <span className="font-mono text-primary-ink font-semibold">{inv.studentId}</span>,
    },
    {
      key: 'title',
      header: 'Khoản thu',
      render: (inv) => (
        <div className="max-w-[220px]">
          <p className="text-foreground font-medium truncate">{inv.title || 'Học phí'}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {inv.packageName && (
              <Badge tone="primary">
                {inv.packageName}
                {inv.packagePrice != null ? ' - ' + money(inv.packagePrice) : ''}
              </Badge>
            )}
            {inv.note && (
              <span className="text-[12px] text-muted-foreground truncate" title={inv.note}>
                {inv.note}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'sessions',
      header: 'Số buổi',
      align: 'center',
      render: (inv) =>
        inv.sessionCount ? (
          <Badge tone="primary">{inv.sessionCount} buổi</Badge>
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
    },
    {
      key: 'amount',
      header: 'Tổng tiền',
      align: 'right',
      render: (inv) => <span className="font-semibold tabular">{money(inv.amount)}</span>,
    },
    {
      key: 'paid',
      header: 'Đã nộp',
      align: 'right',
      render: (inv) => <span className="tabular text-success font-semibold">{money(inv.paidAmount)}</span>,
    },
    {
      key: 'remaining',
      header: 'Còn lại',
      align: 'right',
      render: (inv) => (
        <span className={inv.remainingAmount > 0 ? 'tabular text-danger font-semibold' : 'tabular text-muted-foreground'}>
          {money(inv.remainingAmount)}
        </span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Hạn nộp',
      render: (inv) => <span className="text-muted-foreground tabular">{inv.dueDate}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (inv) => <TuitionBadge status={inv.status} />,
    },
    {
      key: 'actions',
      header: 'Hành động',
      align: 'right',
      render: (inv) => (
        <div className="flex items-center justify-end gap-2">
          {inv.remainingAmount > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon={<QrCode size={14} />}
              onClick={() => setViewingQrInvoice(inv)}
            >
              QR
            </Button>
          )}
          {inv.status !== 'Đã hủy' && (
            <Button size="sm" variant="secondary" onClick={() => openStatusModal(inv)}>
              Thu tiền
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Học phí"
          subtitle="Hoá đơn, công nợ và các gói buổi học bán cho học sinh"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <SegmentedControl
              items={[
                { value: 'invoices', label: 'Hoá đơn' },
                { value: 'packages', label: 'Gói combo', count: packages.length },
              ]}
              value={view}
              onChange={(v) => setView(v as 'invoices' | 'packages')}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<Zap size={15} />}
                onClick={() => setShowSimulator(!showSimulator)}
              >
                Mô phỏng webhook
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Building2 size={15} />}
                onClick={() => {
                  setIsBankModalOpen(true);
                  setBankError(null);
                }}
              >
                Tài khoản nhận tiền
              </Button>
              {view === 'invoices' ? (
                <Button size="sm" icon={<Plus size={16} />} onClick={openCreateModal}>
                  Tạo hoá đơn
                </Button>
              ) : (
                <Button size="sm" icon={<Plus size={16} />} onClick={openCreatePackageModal}>
                  Thêm gói
                </Button>
              )}
            </div>
          </div>

          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <StatCard
              label="Tổng phải thu"
              value={money(totalAmount)}
              hint={invoices.length + ' hoá đơn'}
              icon={<Receipt size={20} />}
              tone="primary"
            />
            <StatCard
              label="Đã thu"
              value={money(totalPaid)}
              hint={((totalPaid / (totalAmount || 1)) * 100).toFixed(0) + '% trên tổng phải thu'}
              icon={<TrendingUp size={20} />}
              tone="success"
            />
            <StatCard
              label="Còn nợ"
              value={money(totalDebt)}
              hint="Cần nhắc học sinh"
              icon={<AlertTriangle size={20} />}
              tone="danger"
            />
          </section>

          {showSimulator && (
            <BankWebhookSimulator
              invoices={invoices}
              onSuccess={() => {
                fetchInvoices();
                toast.success('Đã ghi nhận giao dịch, công nợ vừa được làm mới');
              }}
            />
          )}

          {view === 'invoices' ? (
            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <SearchInput
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Tìm mã hoá đơn, mã học sinh, khoản thu"
                  className="w-full lg:w-96"
                />
                <SegmentedControl items={STATUS_TABS} value={statusFilter} onChange={handleStatusFilterChange} />
              </div>

              <DataTable
                columns={columns}
                rows={paginatedInvoices}
                rowKey={(inv) => inv.id}
                loading={loading}
                emptyIcon={<Receipt size={24} />}
                emptyTitle="Chưa có hoá đơn"
                emptyDescription="Tạo hoá đơn mới hoặc mở bán gói combo để học sinh tự chọn."
                renderMobile={(inv) => (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{inv.title || 'Học phí'}</p>
                        <p className="text-[12px] text-muted-foreground font-mono">
                          {inv.id} · {inv.studentId}
                        </p>
                      </div>
                      <TuitionBadge status={inv.status} />
                    </div>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-muted-foreground">
                        {inv.sessionCount ? inv.sessionCount + ' buổi · ' : ''}Hạn {inv.dueDate}
                      </span>
                      <span className={inv.remainingAmount > 0 ? 'font-semibold text-danger tabular' : 'font-semibold text-success tabular'}>
                        {inv.remainingAmount > 0 ? 'Còn ' + money(inv.remainingAmount) : money(inv.amount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" variant="secondary" fullWidth onClick={() => openStatusModal(inv)}>
                        Thu tiền
                      </Button>
                      {inv.remainingAmount > 0 && (
                        <Button size="sm" variant="secondary" fullWidth onClick={() => setViewingQrInvoice(inv)}>
                          Mã QR
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                footer={
                  <Pager
                    page={currentPage}
                    pageSize={pageSize}
                    total={filtered.length}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={handlePageSizeChange}
                  />
                }
              />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground">
                Gói đang mở bán sẽ hiện cho học sinh chọn khi thanh toán. Số tiền và số buổi do bạn đặt.
              </p>

              {packages.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<Package size={24} />}
                    title="Chưa có gói nào"
                    description="Thêm gói 10 buổi, 20 buổi... để học sinh chọn nhanh khi thanh toán."
                    action={
                      <Button icon={<Plus size={16} />} onClick={openCreatePackageModal}>
                        Thêm gói
                      </Button>
                    }
                  />
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {packages.map(pkg => (
                    <Card key={pkg.id} className={pkg.isActive ? '' : 'opacity-70'}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[12px] font-semibold text-muted-foreground">{pkg.id}</span>
                        <Badge tone={pkg.isActive ? 'success' : 'neutral'} dot>
                          {pkg.isActive ? 'Đang mở bán' : 'Đã ẩn'}
                        </Badge>
                      </div>

                      <h4 className="mt-3 font-bold text-foreground">{pkg.name}</h4>
                      <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2 min-h-[38px]">
                        {pkg.description || 'Chưa có mô tả.'}
                      </p>

                      <div className="mt-4 pt-3 border-t border-line flex items-end justify-between">
                        <div>
                          <p className="text-[12px] text-muted-foreground">{pkg.sessionCount} buổi</p>
                          <p className="text-lg font-extrabold text-foreground tabular">{money(pkg.price)}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9"
                            title={pkg.isActive ? 'Ẩn gói' : 'Mở bán'}
                            onClick={() => handleTogglePackageActive(pkg)}
                          >
                            {pkg.isActive ? <EyeOffIcon /> : <EyeIcon />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9"
                            title="Sửa gói"
                            onClick={() => openEditPackageModal(pkg)}
                          >
                            <Pencil size={16} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-danger"
                            title="Xoá gói"
                            onClick={() => setDeletingPackage(pkg)}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        <Sheet
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          title="Tạo hoá đơn"
          description="Hoá đơn riêng cho một học sinh, kèm số buổi và ghi chú."
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
                Huỷ
              </Button>
              <Button type="submit" form="create-invoice-form" loading={isSubmitting}>
                Tạo hoá đơn
              </Button>
            </>
          }
        >
          <form id="create-invoice-form" onSubmit={handleCreateSubmit} className="space-y-4">
            {formError && (
              <p className="text-[13px] font-medium text-danger bg-danger-soft rounded-field px-3 py-2">{formError}</p>
            )}

            <Field label="Học viên" required>
              <Select
                value={studentId}
                onChange={e => {
                  setStudentId(e.target.value);
                  const found = students.find(s => s.id === e.target.value);
                  if (found && !title) {
                    const now = new Date();
                    const month = (now.getMonth() + 1).toString().padStart(2, '0') + '/' + now.getFullYear();
                    setTitle('Học phí ' + found.name + ' - Tháng ' + month);
                  }
                }}
                disabled={loadingOptions}
                required
              >
                <option value="">{loadingOptions ? 'Đang tải...' : 'Chọn học viên'}</option>
                {students.map(st => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.id})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Tiêu đề khoản thu" required>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="VD: Học phí tháng 09/2026"
                required
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Số tiền (VNĐ)" required>
                <Input
                  type="number"
                  min={1}
                  value={originalAmount}
                  onChange={e => setOriginalAmount(e.target.value)}
                  placeholder="2500000"
                  className="tabular"
                  required
                />
              </Field>
              <Field label="Số buổi" hint="Để trống nếu không theo buổi">
                <Input
                  type="number"
                  min={0}
                  value={sessionCount}
                  onChange={e => setSessionCount(Number(e.target.value))}
                  className="tabular"
                />
              </Field>
            </div>

            <div className="rounded-field bg-primary-soft px-4 py-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-primary-ink">Tổng thu</span>
              <span className="text-base font-extrabold text-primary-ink tabular">
                {money(Math.max(0, Number(originalAmount || 0)))}
              </span>
            </div>

            <Field label="Hạn nộp" required>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
            </Field>

            <Field label="Ghi chú">
              <Textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="VD: Học phí khoá chuyên đề, đóng 2 đợt"
              />
            </Field>
          </form>
        </Sheet>

        <Sheet
          isOpen={isPackageModalOpen}
          onClose={() => setIsPackageModalOpen(false)}
          title={editingPackage ? 'Sửa gói combo' : 'Thêm gói combo'}
          description="Số tiền và số buổi học sinh nhận được khi mua gói."
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsPackageModalOpen(false)}>
                Huỷ
              </Button>
              <Button type="submit" form="package-form" loading={isSavingPkg}>
                {editingPackage ? 'Lưu thay đổi' : 'Tạo gói'}
              </Button>
            </>
          }
        >
          <form id="package-form" onSubmit={handleSavePackageSubmit} className="space-y-4">
            {packageError && (
              <p className="text-[13px] font-medium text-danger bg-danger-soft rounded-field px-3 py-2">{packageError}</p>
            )}

            <Field label="Tên gói" required>
              <Input
                value={pkgName}
                onChange={e => setPkgName(e.target.value)}
                placeholder="VD: Gói 10 buổi cơ bản"
                required
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Số buổi" required>
                <Input
                  type="number"
                  min={1}
                  value={pkgSessionCount}
                  onChange={e => setPkgSessionCount(e.target.value)}
                  className="tabular"
                  required
                />
              </Field>
              <Field label="Giá tiền (VNĐ)" required>
                <Input
                  type="number"
                  min={0}
                  value={pkgPrice}
                  onChange={e => setPkgPrice(e.target.value)}
                  className="tabular"
                  required
                />
              </Field>
            </div>

            <Field label="Mô tả">
              <Textarea
                rows={3}
                value={pkgDescription}
                onChange={e => setPkgDescription(e.target.value)}
                placeholder="VD: 10 buổi, lớp tối đa 8 bạn"
              />
            </Field>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pkgIsActive}
                onChange={e => setPkgIsActive(e.target.checked)}
                className="w-4 h-4 rounded accent-primary cursor-pointer"
              />
              <span className="flex flex-col">
                <span className="text-[13px] font-medium text-foreground">Hiển thị trên Portal học sinh</span>
                <span className="text-[11px] text-muted-foreground">Tắt sẽ ẩn gói này khỏi Portal học sinh (dùng khi soạn gói trước, mở bán sau).</span>
              </span>
            </label>
          </form>
        </Sheet>

        <Sheet
          isOpen={Boolean(updatingInvoice)}
          onClose={() => setUpdatingInvoice(null)}
          title="Thu tiền"
          description={updatingInvoice ? updatingInvoice.id + ' · ' + updatingInvoice.studentId : undefined}
          footer={
            <>
              <Button variant="secondary" onClick={() => setUpdatingInvoice(null)}>
                Huỷ
              </Button>
              <Button type="submit" form="status-form" loading={isUpdatingStatus}>
                Lưu
              </Button>
            </>
          }
        >
          <form id="status-form" onSubmit={handleUpdateStatusSubmit} className="space-y-4">
            {updateError && (
              <p className="text-[13px] font-medium text-danger bg-danger-soft rounded-field px-3 py-2">{updateError}</p>
            )}

            {updatingInvoice && (
              <div className="rounded-field bg-muted px-4 py-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tổng thu</span>
                  <span className="font-semibold tabular">{money(updatingInvoice.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Đã nộp</span>
                  <span className="font-semibold text-success tabular">{money(updatingInvoice.paidAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Còn nợ</span>
                  <span className="font-semibold text-danger tabular">{money(updatingInvoice.remainingAmount)}</span>
                </div>
              </div>
            )}

            <Field label="Trạng thái" required>
              <div className="grid grid-cols-2 gap-2">
                {['Đã nộp', 'Còn nợ', 'Miễn giảm', 'Quá hạn'].map(st => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setUpdateStatus(st)}
                    className={
                      'h-11 rounded-field border text-[13px] font-semibold transition cursor-pointer ' +
                      (updateStatus === st
                        ? 'border-primary bg-primary-soft text-primary-ink'
                        : 'border-line bg-card text-muted-foreground hover:bg-muted')
                    }
                  >
                    {st}
                  </button>
                ))}
              </div>
            </Field>

            {updateStatus === 'Đã nộp' && (
              <div className="space-y-4 pt-1">
                <Field label="Cách thu">
                  <Select value={updateMethod} onChange={e => setUpdateMethod(e.target.value)}>
                    <option value="Tiền mặt">Tiền mặt tại quầy</option>
                    <option value="Chuyển khoản VietQR">Chuyển khoản VietQR</option>
                    <option value="Chuyển khoản thủ công">Chuyển khoản ngân hàng</option>
                    <option value="Thẻ ATM/POS">Thẻ ngân hàng / POS</option>
                  </Select>
                </Field>
                <Field label="Ngày thu">
                  <Input type="date" value={updatePaidDate} onChange={e => setUpdatePaidDate(e.target.value)} />
                </Field>
              </div>
            )}

            <Field label="Lý do / Ghi chú" required hint="Ghi vào nhật ký để đối soát sau này.">
              <Textarea
                rows={2}
                value={updateNotes}
                onChange={e => setUpdateNotes(e.target.value)}
                placeholder="VD: Thu tiền mặt tại quầy"
                required
              />
            </Field>
          </form>
        </Sheet>

        <Sheet
          isOpen={isBankModalOpen}
          onClose={() => setIsBankModalOpen(false)}
          title="Tài khoản nhận tiền"
          description="Dùng để sinh mã VietQR cho hoá đơn."
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsBankModalOpen(false)}>
                Đóng
              </Button>
              <Button type="submit" form="bank-form" loading={savingBank}>
                Lưu
              </Button>
            </>
          }
        >
          <form id="bank-form" onSubmit={handleSaveBankConfig} className="space-y-4">
            {bankError && (
              <p className="text-[13px] font-medium text-danger bg-danger-soft rounded-field px-3 py-2">{bankError}</p>
            )}

            <Field label="Ngân hàng" required>
              <Select
                value={bankConfig.bankId}
                onChange={e => {
                  const bId = e.target.value;
                  const found = SUPPORTED_BANKS.find(b => b.id === bId);
                  setBankConfig({
                    ...bankConfig,
                    bankId: bId,
                    bankName: found ? found.name : bId,
                  });
                }}
                required
              >
                {SUPPORTED_BANKS.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.shortName} - {b.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Số tài khoản" required>
              <Input
                value={bankConfig.accountNumber}
                onChange={e => setBankConfig({ ...bankConfig, accountNumber: e.target.value })}
                placeholder="0987654321"
                className="font-mono"
                required
              />
            </Field>

            <Field label="Chủ tài khoản" hint="Viết hoa, không dấu." required>
              <Input
                value={bankConfig.accountName}
                onChange={e => setBankConfig({ ...bankConfig, accountName: e.target.value.toUpperCase() })}
                placeholder="NGUYEN VAN A"
                className="font-mono uppercase"
                required
              />
            </Field>
          </form>
        </Sheet>

        <Sheet
          isOpen={Boolean(viewingQrInvoice)}
          onClose={() => setViewingQrInvoice(null)}
          title="Mã QR chuyển khoản"
          description={viewingQrInvoice ? viewingQrInvoice.id + ' · ' + viewingQrInvoice.studentId : undefined}
          size="sm"
        >
          {viewingQrInvoice && (
            <div className="space-y-4">
              <div className="rounded-card border border-line bg-muted p-4 flex justify-center">
                { }
                <img
                  src={generateVietQRUrl({
                    bankId: bankConfig.bankId,
                    accountNumber: bankConfig.accountNumber,
                    accountName: bankConfig.accountName,
                    amount: viewingQrInvoice.remainingAmount,
                    studentId: viewingQrInvoice.studentId,
                    invoiceId: viewingQrInvoice.id,
                  })}
                  alt="VietQR"
                  className="w-56 h-auto rounded-field"
                />
              </div>

              <div className="rounded-field bg-muted px-4 py-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Còn nợ</span>
                  <span className="font-semibold text-danger tabular">{money(viewingQrInvoice.remainingAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nội dung CK</span>
                  <span className="font-mono font-semibold">TUI {viewingQrInvoice.studentId} {viewingQrInvoice.id}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  fullWidth
                  icon={<Copy size={15} />}
                  onClick={() => {
                    navigator.clipboard.writeText(bankConfig.accountNumber);
                    toast.success('Đã copy số tài khoản');
                  }}
                >
                  Số tài khoản
                </Button>
                <Button
                  fullWidth
                  icon={<Copy size={15} />}
                  onClick={() => {
                    navigator.clipboard.writeText('TUI ' + viewingQrInvoice.studentId + ' ' + viewingQrInvoice.id);
                    toast.success('Đã copy nội dung chuyển khoản');
                  }}
                >
                  Nội dung CK
                </Button>
              </div>
            </div>
          )}
        </Sheet>

        <Sheet
          isOpen={Boolean(deletingPackage)}
          onClose={() => setDeletingPackage(null)}
          title="Xoá gói combo"
          description={deletingPackage ? 'Gói ' + deletingPackage.name + ' sẽ bị xoá khỏi danh mục.' : undefined}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeletingPackage(null)}>
                Giữ lại
              </Button>
              <Button variant="danger" loading={isDeletingPkg} onClick={handleDeletePackage}>
                Xoá gói
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-muted-foreground">
            Hoá đơn đã tạo từ gói này vẫn giữ nguyên. Học sinh sẽ không còn thấy gói trong mục thanh toán.
          </p>
        </Sheet>
      </div>
    </RoleGuard>
  );
}

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M6.61 6.61A18.6 18.6 0 0 0 2 12s3.5 8 10 8a9.1 9.1 0 0 0 5.39-1.61" />
    <path d="m2 2 20 20" />
  </svg>
);
