'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { TuitionInvoice } from '@/types/finance';
import { SessionPackage } from '@/types/package';
import { AdminBankConfig, DEFAULT_BANK_CONFIG } from '@/types/bank';
import { generateVietQRUrl } from '@/utils/vietqr';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, TuitionBadge } from '@/components/ui/Badge';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Receipt,
  QrCode,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Package,
  Sparkles,
  Loader2,
  Trash2,
} from 'lucide-react';

function money(v?: number) {
  if (!v) return '0đ';
  return v.toLocaleString('vi-VN') + 'đ';
}

export default function StudentTuitionPage() {
  const { currentUser, isReady } = useApp();
  const toast = useToast();

  const [invoices, setInvoices] = useState<TuitionInvoice[]>([]);
  const [packages, setPackages] = useState<SessionPackage[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<TuitionInvoice | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [buyingPackageId, setBuyingPackageId] = useState<string | null>(null);
  const [cancelingInvoiceId, setCancelingInvoiceId] = useState<string | null>(null);

  const [bankConfig, setBankConfig] = useState<AdminBankConfig>(DEFAULT_BANK_CONFIG);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loadBankConfig = async () => {
    try {
      const res = await fetch('/api/settings/bank');
      const data = await res.json();
      if (data.success && data.bankConfig) {
        setBankConfig(data.bankConfig);
      }
    } catch (e) {
      console.error('Không thể tải thông tin ngân hàng:', e);
    }
  };

  const loadPackages = async () => {
    try {
      setLoadingPackages(true);
      const res = await fetch('/api/packages?activeOnly=true');
      const data = await res.json();
      if (data.success && data.packages) {
        setPackages(data.packages);
      }
    } catch (e) {
      console.error('Error loading packages:', e);
    } finally {
      setLoadingPackages(false);
    }
  };

  const loadInvoices = async () => {
    if (!isReady || !currentUser?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance?studentId=${currentUser.id}`);
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
    loadBankConfig();
    loadPackages();
  }, [currentUser, isReady]);

  // Khi tab quay lại focus, làm mới danh sách gói để gói admin vừa tạo hiện ngay mà không cần F5.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadPackages();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', loadPackages);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', loadPackages);
    };
  }, []);

  const activeInvoices = invoices.filter((i) => i.status !== 'Đã hủy');
  const totalBilled = activeInvoices.reduce((s, i) => s + i.amount, 0);
  const totalPaid = activeInvoices.reduce((s, i) => s + i.paidAmount, 0);
  const totalDebt = activeInvoices.reduce((s, i) => s + i.remainingAmount, 0);

  const packageStats = activeInvoices.reduce(
    (acc, inv) => {
      if (inv.sessionCount) {
        acc.totalSessions += inv.sessionCount;
        acc.usedSessions += inv.usedSessions || 0;
        acc.remainingSessions += Math.max(0, inv.sessionCount - (inv.usedSessions || 0));
      }
      return acc;
    },
    { totalSessions: 0, usedSessions: 0, remainingSessions: 0 }
  );

  const handleOpenPayment = (inv: TuitionInvoice) => {
    setSelectedInvoice(inv);
    setShowQrModal(true);
  };

  const handleCancelInvoice = async (inv: TuitionInvoice) => {
    if (!currentUser?.id) return;
    const ok = window.confirm(
      `Huỷ thanh toán "${inv.packageName || inv.title}" (${money(inv.amount)})?\n\nGói chưa thanh toán sẽ được đánh dấu "Đã hủy" và không còn tính vào công nợ của bạn.`
    );
    if (!ok) return;

    setCancelingInvoiceId(inv.id);
    try {
      const res = await fetch(`/api/finance?invoiceId=${inv.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể hủy gói đã chọn');
      }

      toast.success('Đã hủy thanh toán. Hóa đơn được đánh dấu Đã hủy.');
      await loadInvoices();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Lỗi kết nối khi hủy thanh toán');
      return false;
    } finally {
      setCancelingInvoiceId(null);
    }
  };

  /** Huỷ ngay trong modal thanh toán: xong thì đóng luôn. */
  const handleCancelPayment = async () => {
    if (!selectedInvoice) return;
    const cancelled = await handleCancelInvoice(selectedInvoice);
    if (cancelled) {
      setShowQrModal(false);
      setSelectedInvoice(null);
    }
  };

  const handleCopyText = (text: string, fieldName: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`Đã sao chép ${label}`);
    setTimeout(() => {
      setCopiedField(null);
    }, 2500);
  };

  const handleSelectPackage = async (pkg: SessionPackage) => {
    if (!currentUser?.id) return;
    setBuyingPackageId(pkg.id);

    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PURCHASE_PACKAGE',
          studentId: currentUser.id,
          packageId: pkg.id,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Có lỗi xảy ra khi tạo hóa đơn gói');
      }

      toast.success(`Đã chọn ${pkg.name}. Hóa đơn ${data.invoice.id} đã được tạo.`);
      await loadInvoices();
      setSelectedInvoice(data.invoice);
      setShowQrModal(true);
    } catch (err: any) {
      toast.error(err.message || 'Lỗi kết nối khi chọn gói học');
    } finally {
      setBuyingPackageId(null);
    }
  };

  const invoiceColumns: Column<TuitionInvoice>[] = [
    {
      key: 'id',
      header: 'Mã HĐ',
      render: (inv) => <span className="font-mono font-bold text-xs">{inv.id}</span>,
    },
    {
      key: 'title',
      header: 'Khoản thu / Gói học',
      render: (inv) => (
        <div>
          <div className="font-semibold text-foreground">{inv.title}</div>
          {inv.packageName && (
            <span className="inline-block text-[11px] font-mono text-primary bg-primary-soft px-2 py-0.5 rounded-pill mt-0.5">
              Gói: {inv.packageName}
              {inv.packagePrice != null ? ' • ' + money(inv.packagePrice) : ''}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'sessions',
      header: 'Tiến độ buổi',
      align: 'center',
      render: (inv) => {
        const used = inv.usedSessions || 0;
        const total = inv.sessionCount || 0;
        const remaining = Math.max(0, total - used);
        if (total <= 0) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex flex-col items-center">
            <span className="text-[12px] font-semibold text-foreground tabular">
              Còn {remaining}/{total} buổi
            </span>
            <span className="text-[11px] text-muted-foreground tabular mt-0.5">Đã học: {used}</span>
          </div>
        );
      },
    },
    {
      key: 'amount',
      header: 'Số tiền',
      render: (inv) => <span className="font-semibold tabular text-foreground">{money(inv.amount)}</span>,
    },
    {
      key: 'paidAmount',
      header: 'Đã nộp',
      render: (inv) => <span className="font-semibold tabular text-success">{money(inv.paidAmount)}</span>,
    },
    {
      key: 'remainingAmount',
      header: 'Còn thiếu',
      render: (inv) => <span className="font-bold tabular text-danger">{money(inv.remainingAmount)}</span>,
    },
    {
      key: 'dueDate',
      header: 'Hạn nộp',
      render: (inv) => <span className="text-muted-foreground text-xs">{inv.dueDate}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (inv) => <TuitionBadge status={inv.status} />,
    },
    {
      key: 'action',
      header: 'Thao tác',
      align: 'right',
      render: (inv) =>
        inv.status === 'Đã hủy' ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
            <Trash2 size={14} /> Đã hủy
          </span>
        ) : inv.remainingAmount > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenPayment(inv);
              }}
              icon={<QrCode size={14} />}
            >
              Quét QR
            </Button>
            {inv.paidAmount === 0 && (
              <Button
                size="sm"
                variant="danger-outline"
                loading={cancelingInvoiceId === inv.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelInvoice(inv);
                }}
                icon={<Trash2 size={14} />}
              >
                Hủy gói
              </Button>
            )}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-success">
            <CheckCircle2 size={14} /> Đã nộp đủ
          </span>
        ),
    },
  ];

  return (
    <RoleGuard allowedRoles={['STUDENT', 'ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Học phí & Gói buổi học"
          subtitle={`Tra cứu công nợ, chọn gói học và thanh toán cho học viên ${currentUser?.name || ''}`}
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Thống kê 4 ô */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Tổng học phí"
              value={money(totalBilled)}
              hint="Kế hoạch và gói đã chọn"
              icon={<Receipt size={20} />}
              tone="primary"
            />
            <StatCard
              label="Đã thanh toán"
              value={money(totalPaid)}
              hint="Đã thanh toán qua hệ thống"
              icon={<CheckCircle2 size={20} />}
              tone="success"
            />
            <StatCard
              label="Số tiền còn nợ"
              value={money(totalDebt)}
              hint="Cần thanh toán trước hạn"
              icon={<AlertCircle size={20} />}
              tone="danger"
            />
            <StatCard
              label="Số buổi học còn lại"
              value={`${packageStats.remainingSessions}/${packageStats.totalSessions}`}
              hint={`Đã học: ${packageStats.usedSessions} buổi`}
              icon={<Sparkles size={20} />}
              tone="info"
            />
          </div>

          {/* Mục 1: Gói combo tự chọn */}
          <Card padded className="space-y-4">
            <CardHeader
              title="Gói buổi học tự chọn"
              subtitle="Chủ động chọn gói học linh hoạt. Hệ thống sẽ tự động tạo hóa đơn và mã VietQR thanh toán."
              icon={<Package size={20} />}
              action={<Badge tone="primary">{packages.length} gói khả dụng</Badge>}
            />

            {loadingPackages ? (
              <div className="py-10 text-center text-muted-foreground text-xs flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin text-primary" />
                <span>Đang tải danh sách gói học...</span>
              </div>
            ) : packages.length === 0 ? (
              <EmptyState
                icon={<Package size={28} />}
                title="Chưa có gói học nào được mở"
                description="Hiện tại trung tâm chưa phát hành gói học mới. Vui lòng liên hệ quản trị viên."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="bg-card border border-line rounded-card p-5 shadow-card hover:shadow-pop transition flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone="primary">{pkg.sessionCount} buổi học</Badge>
                          {pkg.createdAt && Date.now() - new Date(pkg.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000 && (
                            <Badge tone="success" dot>Mới</Badge>
                          )}
                        </div>
                        <span className="text-xs font-mono font-medium text-muted-foreground">
                          {pkg.id}
                        </span>
                      </div>

                      <h4 className="text-base font-bold text-foreground leading-snug">{pkg.name}</h4>

                      <p className="text-xs text-muted-foreground line-clamp-2 min-h-[34px]">
                        {pkg.description || 'Chương trình học tiêu chuẩn, kèm tài liệu và bài tập thực hành.'}
                      </p>

                      <div className="pt-3 border-t border-line">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase">Học phí trọn gói</p>
                        <p className="text-xl font-extrabold text-foreground tabular mt-0.5">
                          {money(pkg.price)}
                        </p>
                        <p className="text-[11px] text-muted-foreground tabular mt-0.5">
                          ~ {money(Math.round(pkg.price / pkg.sessionCount))} / buổi
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 pt-2">
                      <Button
                        variant="primary"
                        fullWidth
                        loading={buyingPackageId === pkg.id}
                        onClick={() => handleSelectPackage(pkg)}
                        icon={<QrCode size={16} />}
                      >
                        Mua gói & Quét QR
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Mục 2: Lịch sử hóa đơn & gói học */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-[15px] font-bold text-foreground">Lịch sử hóa đơn & gói học</h3>
                <p className="text-[13px] text-muted-foreground">
                  Theo dõi tiến độ thanh toán và số buổi học đã mua
                </p>
              </div>
              <span className="text-xs font-mono text-muted-foreground bg-muted px-3 py-1 rounded-pill self-start sm:self-auto">
                Mã HV: {currentUser?.id}
              </span>
            </div>

            <DataTable<TuitionInvoice>
              columns={invoiceColumns}
              rows={invoices}
              rowKey={(inv) => inv.id}
              loading={loading}
              emptyIcon={<Receipt size={28} />}
              emptyTitle="Chưa có hóa đơn nào"
              emptyDescription="Bạn chưa có hóa đơn hoặc gói buổi học nào. Hãy chọn gói ở phía trên để bắt đầu."
              renderMobile={(inv) => {
                const used = inv.usedSessions || 0;
                const total = inv.sessionCount || 0;
                const remaining = Math.max(0, total - used);

                return (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono font-bold text-xs text-muted-foreground">{inv.id}</span>
                        <h4 className="font-semibold text-foreground text-sm mt-0.5">{inv.title}</h4>
                        {inv.packageName && (
                          <span className="inline-block text-[11px] font-mono text-primary bg-primary-soft px-2 py-0.5 rounded-pill mt-0.5">
                            Gói: {inv.packageName}
                            {inv.packagePrice != null ? ' • ' + money(inv.packagePrice) : ''}
                          </span>
                        )}
                      </div>
                      <TuitionBadge status={inv.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div>
                        <span className="text-muted-foreground block">Học phí:</span>
                        <span className="font-semibold tabular text-foreground">{money(inv.amount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Đã nộp:</span>
                        <span className="font-semibold tabular text-success">{money(inv.paidAmount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Còn thiếu:</span>
                        <span className="font-bold tabular text-danger">{money(inv.remainingAmount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Hạn nộp:</span>
                        <span className="text-foreground">{inv.dueDate}</span>
                      </div>
                    </div>

                    {total > 0 && (
                      <div className="text-xs bg-muted p-2 rounded-field flex items-center justify-between">
                        <span className="text-muted-foreground">Tiến độ buổi:</span>
                        <span className="font-semibold text-foreground tabular">
                          Còn {remaining} / {total} buổi (đã học {used})
                        </span>
                      </div>
                    )}

                    {inv.status === 'Đã hủy' ? (
                      <div className="text-center py-1 text-xs font-semibold text-muted-foreground flex items-center justify-center gap-1">
                        <Trash2 size={14} /> Đã hủy
                      </div>
                    ) : inv.remainingAmount > 0 ? (
                      <div className="space-y-2">
                        <Button
                          size="sm"
                          variant="primary"
                          fullWidth
                          onClick={() => handleOpenPayment(inv)}
                          icon={<QrCode size={14} />}
                        >
                          Quét QR thanh toán
                        </Button>
                        {inv.paidAmount === 0 && (
                          <Button
                            size="sm"
                            variant="danger-outline"
                            fullWidth
                            loading={cancelingInvoiceId === inv.id}
                            onClick={() => handleCancelInvoice(inv)}
                            icon={<Trash2 size={14} />}
                          >
                            Hủy gói
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-1 text-xs font-semibold text-success flex items-center justify-center gap-1">
                        <CheckCircle2 size={14} /> Đã hoàn thành
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>

          {/* Sheet Thanh toán VietQR Napas247 */}
          {selectedInvoice && (
            <Sheet
              isOpen={showQrModal}
              onClose={() => {
                setShowQrModal(false);
                setSelectedInvoice(null);
              }}
              title="Thanh toán học phí"
              description="Chuyển khoản theo mã VietQR bên dưới. Quản trị sẽ đối soát sao kê và xác nhận học phí."
              size="md"
              footer={
                <div className="flex items-center justify-end gap-2 w-full">
                  <Button variant="secondary" onClick={() => setShowQrModal(false)}>
                    Đóng
                  </Button>
                  <Button
                    variant="danger-outline"
                    loading={cancelingInvoiceId === selectedInvoice.id}
                    onClick={handleCancelPayment}
                    icon={<Trash2 size={14} />}
                  >
                    Huỷ thanh toán
                  </Button>
                </div>
              }
            >
              <div className="space-y-4 text-center">
                <div className="p-3 bg-muted rounded-card border border-line inline-block">
                    <img
                      src={generateVietQRUrl({
                        bankId: bankConfig.bankId,
                        accountNumber: bankConfig.accountNumber,
                        accountName: bankConfig.accountName,
                        amount: selectedInvoice.remainingAmount,
                        studentId: selectedInvoice.studentId,
                        invoiceId: selectedInvoice.id,
                        template: 'compact2',
                      })}
                      alt="Mã VietQR Thanh Toán Học Phí"
                      className="w-60 h-auto mx-auto rounded-field shadow-soft"
                    />
                  </div>

                  <div className="bg-muted p-4 rounded-card border border-line text-left space-y-2.5 text-xs">
                    <div className="flex justify-between items-center py-1 border-b border-line">
                      <span className="text-muted-foreground">Ngân hàng:</span>
                      <span className="font-bold text-foreground text-right">
                        {bankConfig.bankName} ({bankConfig.bankId})
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-line">
                      <span className="text-muted-foreground">Số tài khoản:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-foreground text-sm">
                          {bankConfig.accountNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText(bankConfig.accountNumber, 'acc_num', 'Số tài khoản')
                          }
                          className="p-1 hover:bg-card rounded-field text-muted-foreground hover:text-foreground transition cursor-pointer"
                          title="Sao chép số tài khoản"
                        >
                          {copiedField === 'acc_num' ? (
                            <Check size={14} className="text-success" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-line">
                      <span className="text-muted-foreground">Chủ tài khoản:</span>
                      <span className="font-bold text-foreground uppercase">{bankConfig.accountName}</span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-line">
                      <span className="text-muted-foreground">Số tiền:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-danger text-sm tabular">
                          {money(selectedInvoice.remainingAmount)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText(
                              selectedInvoice.remainingAmount.toString(),
                              'amount',
                              'Số tiền'
                            )
                          }
                          className="p-1 hover:bg-card rounded-field text-muted-foreground hover:text-foreground transition cursor-pointer"
                          title="Sao chép số tiền"
                        >
                          {copiedField === 'amount' ? (
                            <Check size={14} className="text-success" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="p-3 bg-card border border-line rounded-field flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold text-muted-foreground block">
                          Nội dung chuyển khoản (bắt buộc):
                        </span>
                        <span className="font-mono font-extrabold text-foreground text-sm tracking-wide truncate block">
                          {`TUI ${selectedInvoice.studentId} ${selectedInvoice.id}`}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          handleCopyText(
                            `TUI ${selectedInvoice.studentId} ${selectedInvoice.id}`,
                            'content',
                            'Nội dung'
                          )
                        }
                        icon={
                          copiedField === 'content' ? (
                            <Check size={13} className="text-success" />
                          ) : (
                            <Copy size={13} />
                          )
                        }
                      >
                        Sao chép
                      </Button>
                    </div>
                  </div>

                <p className="text-[12px] text-muted-foreground">
                  Mở ứng dụng ngân hàng bất kỳ để quét mã VietQR trên hoặc nhập thông tin chuyển khoản chính xác theo cú pháp.
                </p>
              </div>
            </Sheet>
          )}
        </main>
      </div>
    </RoleGuard>
  );
}

