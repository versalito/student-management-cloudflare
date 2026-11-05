'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/common/Header';
import { PaginationControls } from '@/components/common/PaginationControls';
import { Modal } from '@/components/common/Modal';
import { RoleGuard } from '@/components/common/RoleGuard';
import { TuitionInvoice } from '@/types/finance';
import { AdminBankConfig, DEFAULT_BANK_CONFIG, SUPPORTED_BANKS } from '@/types/bank';
import { generateVietQRUrl } from '@/utils/vietqr';
import { BankWebhookSimulator } from '@/components/tuition/BankWebhookSimulator';
import { SessionPackage } from '@/types/package';
import { 
  Package, 
  Edit, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Receipt, 
  Search, 
  Filter, 
  AlertCircle, 
  CheckCircle, 
  Plus, 
  CreditCard, 
  QrCode, 
  Settings, 
  Check, 
  Copy, 
  Loader2 
} from 'lucide-react';

export default function AdminTuitionPage() {
  const [invoices, setInvoices] = useState<TuitionInvoice[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Modal Create states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [students, setStudents] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);

  // Form states (Tạo hóa đơn học phí)
  const [studentId, setStudentId] = useState('');
  const [title, setTitle] = useState('');
  const [originalAmount, setOriginalAmount] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Bank Settings states
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [bankConfig, setBankConfig] = useState<AdminBankConfig>(DEFAULT_BANK_CONFIG);
  const [savingBank, setSavingBank] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  // Modal Cập nhật trạng thái thanh toán thủ công
  // Session Packages CRUD states
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
  const [showPackagesView, setShowPackagesView] = useState(false);

  const [updatingInvoice, setUpdatingInvoice] = useState<TuitionInvoice | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>('Đã nộp');
  const [updateMethod, setUpdateMethod] = useState<string>('Tiền mặt');
  const [updatePaidDate, setUpdatePaidDate] = useState<string>('');
  const [updateNotes, setUpdateNotes] = useState<string>('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Modal View QR for specific Invoice
  const [viewingQrInvoice, setViewingQrInvoice] = useState<TuitionInvoice | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

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
        try {
          localStorage.setItem('admin_bank_config', JSON.stringify(data.bankConfig));
        } catch (e) {}
      } else {
        const local = localStorage.getItem('admin_bank_config');
        if (local) setBankConfig(JSON.parse(local));
      }
    } catch (e) {
      try {
        const local = localStorage.getItem('admin_bank_config');
        if (local) setBankConfig(JSON.parse(local));
      } catch (err) {}
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchBankConfig();
    fetchPackages();
  }, []);

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
        actorId: 'ADMIN001',
        actorName: 'Quản trị viên',
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
        throw new Error(data.error || 'Lỗi khi lưu gói buổi học');
      }

      setIsPackageModalOpen(false);
      setToastMessage({
        type: 'success',
        text: isEdit ? `Đã cập nhật gói ${editingPackage?.name}!` : `Đã tạo gói mới "${pkgName}"!`,
      });
      setTimeout(() => setToastMessage(null), 4000);
      await fetchPackages();
    } catch (err: any) {
      setPackageError(err.message || 'Lỗi kết nối khi lưu gói');
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
          actorId: 'ADMIN001',
          actorName: 'Quản trị viên',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToastMessage({
          type: 'success',
          text: `Đã ${!pkg.isActive ? 'bật' : 'tắt'} hiển thị gói "${pkg.name}"!`,
        });
        setTimeout(() => setToastMessage(null), 4000);
        await fetchPackages();
      }
    } catch (err) {
      console.error('Error toggling package:', err);
    }
  };

  const handleDeletePackage = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa gói "${name}" không?`)) return;
    try {
      const res = await fetch(`/api/packages?id=${id}&actorId=ADMIN001`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToastMessage({
          type: 'success',
          text: `Đã xóa gói "${name}"!`,
        });
        setTimeout(() => setToastMessage(null), 4000);
        await fetchPackages();
      }
    } catch (err) {
      console.error('Error deleting package:', err);
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
        const resStudents = await fetch('/api/students?limit=1000');
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
          transactionCode: updateStatus === 'Đã nộp' ? (updatingInvoice.transactionCode || `MANUAL-${Date.now()}`) : undefined,
          reason: updateNotes.trim() || undefined,
          note: updateNotes.trim() || undefined,
          actorId: 'ADMIN001',
          actorName: 'Quản trị viên',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Cập nhật trạng thái thất bại');
      }

      setUpdatingInvoice(null);
      setToastMessage({
        type: 'success',
        text: `Đã cập nhật trạng thái hóa đơn ${updatingInvoice.id} thành "${updateStatus}"!`,
      });
      setTimeout(() => setToastMessage(null), 4000);
      await fetchInvoices();
    } catch (err: any) {
      setUpdateError(err.message || 'Lỗi mạng hoặc hệ thống');
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
        throw new Error(data.error || 'Lỗi khi lưu cấu hình ngân hàng');
      }

      try {
        localStorage.setItem('admin_bank_config', JSON.stringify(data.bankConfig));
      } catch (e) {}

      setIsBankModalOpen(false);
      setToastMessage({
        type: 'success',
        text: 'Cập nhật tài khoản ngân hàng VietQR thành công!',
      });
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      setBankError(err.message || 'Lỗi mạng khi lưu tài khoản');
    } finally {
      setSavingBank(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!studentId) {
      setFormError('Vui lòng chọn học viên.');
      return;
    }
    if (!title.trim()) {
      setFormError('Vui lòng nhập tiêu đề hóa đơn.');
      return;
    }
    if (!originalAmount || Number(originalAmount) <= 0) {
      setFormError('Số tiền phải lớn hơn 0 VNĐ.');
      return;
    }

    const finalAmount = Number(originalAmount);
    if (finalAmount <= 0) {
      setFormError('Số tiền phải lớn hơn 0 VNĐ.');
      return;
    }
    if (!dueDate) {
      setFormError('Vui lòng chọn hạn nộp.');
      return;
    }

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
        throw new Error(result.error || 'Có lỗi xảy ra khi tạo hóa đơn.');
      }

      setToastMessage({
        type: 'success',
        text: `Tạo hóa đơn học phí ${result.invoice?.id || ''} thành công!`,
      });
      setTimeout(() => setToastMessage(null), 4000);
      setIsCreateModalOpen(false);
      await fetchInvoices();
    } catch (err: any) {
      setFormError(err.message || 'Lỗi kết nối khi tạo hóa đơn.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = invoices.filter(inv => {
    const matchSearch = 
      inv.studentId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.classId && inv.classId.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchStatus = statusFilter === 'ALL' || inv.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
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

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen bg-slate-50/70 font-sans text-slate-800">
        <Header 
          title="Quản lý Học phí & Công nợ" 
          subtitle="Theo dõi nguồn thu học phí, cấu hình VietQR động và quản lý hóa đơn" 
        />

        <main className="p-6 max-w-7xl mx-auto w-full space-y-6">
          {/* Toast thông báo */}
          {toastMessage && (
            <div className={`p-4 rounded-xl text-sm font-semibold flex items-center justify-between shadow-sm transition ${
              toastMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}>
              <div className="flex items-center gap-2">
                {toastMessage.type === 'success' ? <CheckCircle className="text-emerald-600 shrink-0" size={18} /> : <AlertCircle className="text-rose-600 shrink-0" size={18} />}
                <span>{toastMessage.text}</span>
              </div>
              <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
            </div>
          )}

          {/* Metric Cards - Atelier Architectural Accounting Strip */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Tổng Công Nợ Phải Thu</span>
                <span className="text-xs font-mono font-bold text-slate-400">#HĐ: {invoices.length}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 tracking-tight">
                  {totalAmount.toLocaleString('vi-VN')}
                </span>
                <span className="text-xs text-slate-400 font-medium">VNĐ</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                Gồm học phí tháng & các gói buổi học đã xuất
              </div>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Đã Thu Thực Tế (Gạch Nợ)</span>
                <span className="text-xs font-mono font-bold text-emerald-700">
                  {((totalPaid / (totalAmount || 1)) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-700 tracking-tight">
                  {totalPaid.toLocaleString('vi-VN')}
                </span>
                <span className="text-xs text-slate-400 font-medium">VNĐ</span>
              </div>
              <div className="mt-2 text-[11px] text-emerald-700 font-medium flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Đã đối soát khớp VietQR Napas247
              </div>
            </div>

            <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Còn Nợ / Đang Quá Hạn</span>
                <span className="text-xs font-mono font-bold text-rose-600">Đốc thúc</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold font-mono text-rose-700 tracking-tight">
                  {totalDebt.toLocaleString('vi-VN')}
                </span>
                <span className="text-xs text-slate-400 font-medium">VNĐ</span>
              </div>
              <div className="mt-2 text-[11px] text-rose-600 font-medium flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                Cần gửi thông báo nhắc lịch học phí
              </div>
            </div>
          </section>

          {/* Filter Bar & Action Buttons */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="relative w-full md:w-80">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm theo mã SV, mã HĐ..."
                value={searchTerm}
                onChange={e => handleSearchChange(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-indigo-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                {['ALL', 'Đã nộp', 'Còn nợ', 'Miễn giảm', 'Quá hạn'].map(st => (
                  <button
                    key={st}
                    onClick={() => handleStatusFilterChange(st)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                      statusFilter === st ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {st === 'ALL' ? 'Tất cả' : st}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPackagesView(!showPackagesView)}
                  className={`flex items-center gap-1.5 px-3 py-2 border text-xs font-semibold rounded-lg transition shadow-xs cursor-pointer ${
                    showPackagesView 
                      ? 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700' 
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <Package size={14} className={showPackagesView ? "text-white" : "text-purple-600"} />
                  <span>Quản lý Gói ({packages.length})</span>
                </button>

                <button
                  onClick={() => {
                    setIsBankModalOpen(true);
                    setBankError(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition shadow-xs cursor-pointer"
                >
                  <Settings size={14} className="text-slate-500" />
                  <span>Cài đặt Ngân hàng</span>
                </button>

                <button
                  onClick={openCreateModal}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
                >
                  <Plus size={15} />
                  <span>Tạo Hóa Đơn</span>
                </button>
              </div>
            </div>
          </div>

          {/* Bank Webhook Simulator */}
          {showSimulator && (
            <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-300">
              <BankWebhookSimulator 
                invoices={invoices} 
                onSuccess={() => {
                  fetchInvoices();
                  setToastMessage({
                    type: 'success',
                    text: 'Webhook ngân hàng đã kích hoạt thành công! Dữ liệu công nợ đã được làm mới.',
                  });
                }} 
              />
            </div>
          )}

                    {/* Panel Quản lý Gói Buổi Học */}
          {showPackagesView && (
            <div className="bg-white rounded-2xl border border-purple-200 p-5 shadow-xs space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-purple-100">
                <div className="flex items-center gap-2">
                  <Package className="text-purple-600" size={20} />
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Danh Mục Gói Buổi Học (Session Packages)</h3>
                    <p className="text-xs text-slate-500">Cấu hình các gói 10, 20, 30 buổi để học sinh tự chọn mua hoặc kế toán phân bổ</p>
                  </div>
                </div>
                <button
                  onClick={openCreatePackageModal}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  <Plus size={14} />
                  <span>Thêm Gói Mới</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {packages.map(pkg => (
                  <div 
                    key={pkg.id} 
                    className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                      pkg.isActive ? 'bg-purple-50/40 border-purple-200' : 'bg-slate-50 border-slate-200 opacity-70'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold text-purple-700 bg-white px-2 py-0.5 rounded border border-purple-200">
                          {pkg.id}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          pkg.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {pkg.isActive ? 'Đang kích hoạt' : 'Đã ẩn'}
                        </span>
                      </div>

                      <h4 className="font-bold text-slate-800 text-sm">{pkg.name}</h4>
                      <p className="text-xs text-slate-500 line-clamp-2 min-h-[32px]">
                        {pkg.description || 'Không có mô tả chi tiết.'}
                      </p>

                      <div className="pt-2 border-t border-purple-100 flex items-baseline justify-between">
                        <span className="text-xs text-slate-600 font-medium">Số buổi: <strong className="text-slate-800">{pkg.sessionCount}</strong></span>
                        <span className="text-sm font-extrabold font-mono text-purple-700">
                          {pkg.price.toLocaleString('vi-VN')} đ
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 mt-3 border-t border-purple-100/70 flex items-center justify-between gap-1.5">
                      <button
                        onClick={() => handleTogglePackageActive(pkg)}
                        className="p-1.5 text-xs text-slate-600 hover:text-purple-700 hover:bg-white rounded transition flex items-center gap-1 cursor-pointer"
                        title={pkg.isActive ? 'Tắt hiển thị' : 'Bật hiển thị'}
                      >
                        {pkg.isActive ? <ToggleRight className="text-emerald-600" size={18} /> : <ToggleLeft className="text-slate-400" size={18} />}
                        <span className="text-[11px] font-semibold">{pkg.isActive ? 'Bật' : 'Tắt'}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditPackageModal(pkg)}
                          className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-white rounded transition cursor-pointer"
                          title="Chỉnh sửa gói"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => handleDeletePackage(pkg.id, pkg.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded transition cursor-pointer"
                          title="Xóa gói"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                  <tr>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Mã HĐ</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Học viên</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Gói / Khoản thu</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3 text-center">Số buổi</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Khoản thu</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Đã nộp</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Còn lại</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Hạn nộp</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Trạng thái</th>
                    <th className="whitespace-nowrap px-3 sm:px-4 py-3">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedInvoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 font-mono font-bold text-slate-800 whitespace-nowrap">{inv.id}</td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 font-mono font-bold text-indigo-600 whitespace-nowrap">{inv.studentId}</td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 font-medium text-slate-800 max-w-xs truncate">
                        <div>{inv.title || 'Học phí'}</div>
                        {inv.packageId && (
                          <span className="inline-block text-[10px] font-mono text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-100 mt-0.5">
                            Gói: {inv.packageId}
                          </span>
                        )}
                        {inv.note && (
                          <div className="text-[10px] text-slate-400 italic truncate" title={inv.note}>
                            Lý do: {inv.note}
                          </div>
                        )}
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-center whitespace-nowrap font-mono text-xs">
                        {inv.sessionCount ? (
                          <span className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                            {inv.sessionCount} buổi
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 font-semibold font-mono whitespace-nowrap">{inv.amount.toLocaleString('vi-VN')} đ</td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-emerald-600 font-semibold font-mono whitespace-nowrap">{inv.paidAmount.toLocaleString('vi-VN')} đ</td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-rose-600 font-semibold font-mono whitespace-nowrap">{inv.remainingAmount.toLocaleString('vi-VN')} đ</td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 text-slate-500 whitespace-nowrap">{inv.dueDate}</td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap">
                        <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] whitespace-nowrap inline-flex border ${
                          inv.status === 'Đã nộp'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : inv.status === 'Miễn giảm'
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : inv.status === 'Quá hạn'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 sm:py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openStatusModal(inv)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold transition cursor-pointer"
                          >
                            Thu tiền / Sửa
                          </button>
                          {inv.remainingAmount > 0 && (
                            <button
                              onClick={() => setViewingQrInvoice(inv)}
                              className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[11px] font-semibold transition flex items-center gap-1 cursor-pointer"
                              title="Xem mã VietQR Napas247"
                            >
                              <QrCode size={12} />
                              <span>QR</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={filtered.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={[10, 25, 50, 100]}
              itemLabel="hóa đơn"
            />
          </div>
        </main>

        {/* 1. Modal Cài Đặt Tài Khoản Ngân Hàng VietQR (Dùng Modal Portal chuẩn che phủ 100vw x 100vh) */}
        <Modal
          isOpen={isBankModalOpen}
          onClose={() => setIsBankModalOpen(false)}
          className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <CreditCard className="text-indigo-600" size={20} />
              <h3 className="text-base font-bold text-slate-800">Cấu hình Ngân hàng Admin (VietQR)</h3>
            </div>
            <button
              onClick={() => setIsBankModalOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer transition p-1"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSaveBankConfig} className="p-6 space-y-4 text-xs">
            {bankError && (
              <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{bankError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ngân hàng thụ hưởng <span className="text-rose-500">*</span>
              </label>
              <select
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
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 focus:outline-indigo-600"
                required
              >
                {SUPPORTED_BANKS.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.shortName} - {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Số tài khoản ngân hàng <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={bankConfig.accountNumber}
                onChange={e => setBankConfig({ ...bankConfig, accountNumber: e.target.value })}
                placeholder="VD: 0987654321"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-indigo-600"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên chủ tài khoản (In hoa không dấu) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={bankConfig.accountName}
                onChange={e => setBankConfig({ ...bankConfig, accountName: e.target.value.toUpperCase() })}
                placeholder="VD: NGUYEN VAN A - ADMIN"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono uppercase text-slate-800 focus:outline-indigo-600"
                required
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsBankModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={savingBank}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                {savingBank ? 'Đang lưu...' : 'Lưu cấu hình'}
              </button>
            </div>
          </form>
        </Modal>

        {/* 2. Modal Tạo Hóa Đơn Học Phí Mới (Dùng Modal Portal chuẩn che phủ 100vw x 100vh) */}
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          className="bg-white w-full max-w-lg rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-800">Tạo Hóa Đơn Học Phí Mới</h3>
            <button
              onClick={() => setIsCreateModalOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer transition p-1"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleCreateSubmit} className="p-6 space-y-4 text-xs">
            {formError && (
              <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Học viên <span className="text-rose-500">*</span>
              </label>
              <select
                value={studentId}
                onChange={e => {
                  setStudentId(e.target.value);
                  const found = students.find(s => s.id === e.target.value);
                  if (found && !title) {
                    const now = new Date();
                    const month = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
                    setTitle(`Học phí ${found.name} - Tháng ${month}`);
                  }
                }}
                disabled={loadingOptions}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 focus:outline-indigo-600"
                required
              >
                <option value="">-- Chọn học viên --</option>
                {students.map(st => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tiêu đề khoản thu <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="VD: Học phí khóa chuyên đề Tháng 09/2026"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-indigo-600"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Số tiền (VNĐ) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  value={originalAmount}
                  onChange={e => setOriginalAmount(e.target.value)}
                  placeholder="2500000"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-indigo-600"
                  required
                  min="1"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Số buổi</label>
                <input
                  type="number"
                  value={sessionCount}
                  onChange={e => setSessionCount(Number(e.target.value))}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-indigo-600"
                  min="0"
                />
              </div>
            </div>

            <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-900">Số tiền:</span>
              <span className="text-sm font-bold font-mono text-indigo-700">
                {Math.max(0, Number(originalAmount || 0)).toLocaleString('vi-VN')} đ
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Hạn thanh toán <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-indigo-600"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Ghi chú</label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ghi chú chi tiết cho học viên hoặc kế toán..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-indigo-600"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                {isSubmitting ? 'Đang tạo...' : 'Tạo hóa đơn'}
              </button>
            </div>
          </form>
        </Modal>

        {/* 3. Modal Xem VietQR Động cho Admin (Dùng Modal Portal chuẩn) */}
        {viewingQrInvoice && (
          <Modal
            isOpen={Boolean(viewingQrInvoice)}
            onClose={() => setViewingQrInvoice(null)}
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full border border-slate-200 overflow-hidden text-center p-6 space-y-4 my-8"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <QrCode size={16} className="text-indigo-600" />
                <span>VietQR Thanh Toán</span>
              </div>
              <button onClick={() => setViewingQrInvoice(null)} className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer">
                ✕
              </button>
            </div>

            {copyToast && (
              <div className="p-2 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5">
                <Check size={14} className="text-emerald-600" />
                <span>{copyToast}</span>
              </div>
            )}

            <div className="space-y-3">
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 inline-block shadow-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={generateVietQRUrl({
                    bankId: bankConfig.bankId,
                    accountNumber: bankConfig.accountNumber,
                    accountName: bankConfig.accountName,
                    amount: viewingQrInvoice.remainingAmount,
                    studentId: viewingQrInvoice.studentId,
                  })}
                  alt="VietQR Napas247"
                  className="w-56 h-auto mx-auto rounded-xl"
                />
              </div>

              <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-left space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Mã hóa đơn:</span>
                  <span className="font-mono font-bold text-slate-800">{viewingQrInvoice.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Học viên:</span>
                  <span className="font-mono font-bold text-indigo-600">{viewingQrInvoice.studentId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Số tiền còn nợ:</span>
                  <span className="font-mono font-bold text-rose-600">{viewingQrInvoice.remainingAmount.toLocaleString('vi-VN')} đ</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-indigo-200/50">
                  <span className="text-slate-500">Nội dung CK:</span>
                  <span className="font-mono font-bold text-slate-800">{viewingQrInvoice.studentId}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(bankConfig.accountNumber);
                    setCopyToast('Đã copy số tài khoản!');
                    setTimeout(() => setCopyToast(null), 2000);
                  }}
                  className="flex-1 py-2 px-3 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Copy size={13} />
                  <span>Copy STK</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(viewingQrInvoice.studentId);
                    setCopyToast('Đã copy cú pháp chuyển khoản!');
                    setTimeout(() => setCopyToast(null), 2000);
                  }}
                  className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Copy size={13} />
                  <span>Copy Cú Pháp</span>
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* 4. Modal Cập nhật trạng thái hóa đơn / Thu tiền (Dùng Modal Portal chuẩn) */}
        {updatingInvoice && (
          <Modal
            isOpen={Boolean(updatingInvoice)}
            onClose={() => setUpdatingInvoice(null)}
            className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <CreditCard className="text-indigo-600" size={20} />
                <h3 className="text-base font-bold text-slate-800">Cập Nhật Trạng Thái Học Phí</h3>
              </div>
              <button
                onClick={() => setUpdatingInvoice(null)}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer transition p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateStatusSubmit} className="p-6 space-y-4 text-xs">
              {updateError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{updateError}</span>
                </div>
              )}

              {/* Thông tin hóa đơn */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Mã hóa đơn:</span>
                  <span className="font-mono font-bold text-slate-800">{updatingInvoice.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Học viên:</span>
                  <span className="font-mono font-bold text-indigo-600">{updatingInvoice.studentId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tổng khoản thu:</span>
                  <span className="font-mono font-bold text-slate-800">{updatingInvoice.amount.toLocaleString('vi-VN')} đ</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Đã nộp:</span>
                  <span className="font-mono font-bold text-emerald-600">{updatingInvoice.paidAmount.toLocaleString('vi-VN')} đ</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Còn nợ:</span>
                  <span className="font-mono font-bold text-rose-600">{updatingInvoice.remainingAmount.toLocaleString('vi-VN')} đ</span>
                </div>
              </div>

              {/* Chọn trạng thái mới */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Trạng thái thanh toán mới <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {['Đã nộp', 'Còn nợ', 'Miễn giảm', 'Quá hạn'].map(st => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setUpdateStatus(st)}
                      className={`py-2 px-2 text-xs font-semibold rounded-lg border transition text-center cursor-pointer ${
                        updateStatus === st
                          ? st === 'Đã nộp'
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                            : st === 'Miễn giảm'
                            ? 'bg-blue-50 border-blue-500 text-blue-800'
                            : st === 'Quá hạn'
                            ? 'bg-rose-50 border-rose-500 text-rose-800'
                            : 'bg-amber-50 border-amber-500 text-amber-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Các trường bổ sung khi chọn "Đã nộp" */}
              {updateStatus === 'Đã nộp' && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Phương thức thanh toán</label>
                    <select
                      value={updateMethod}
                      onChange={e => setUpdateMethod(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 focus:outline-indigo-600"
                    >
                      <option value="Tiền mặt">Tiền mặt tại quầy</option>
                      <option value="Chuyển khoản VietQR">Chuyển khoản VietQR</option>
                      <option value="Chuyển khoản thủ công">Chuyển khoản trực tiếp ngân hàng</option>
                      <option value="Thẻ ATM/POS">Thẻ ngân hàng / POS</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Ngày thu tiền</label>
                    <input
                      type="date"
                      value={updatePaidDate}
                      onChange={e => setUpdatePaidDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-indigo-600"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lý do sửa tay trạng thái / Ghi chú <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={updateNotes}
                  onChange={e => setUpdateNotes(e.target.value)}
                  placeholder="VD: Thu tiền mặt tại quầy, Học bổng tuyển sinh, Đối soát lỗi ngân hàng, Gia hạn công nợ..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-indigo-600"
                  required
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  * Lý do này sẽ được ghi nhận chi tiết vào Hệ thống Audit Log để phục vụ kiểm toán và đối soát.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUpdatingInvoice(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingStatus}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  {isUpdatingStatus ? 'Đang lưu...' : 'Xác nhận cập nhật'}
                </button>
              </div>
            </form>
          </Modal>
        )}
        {/* Modal Quản Lý Gói Buổi Học (Thêm / Sửa) */}
        <Modal
          isOpen={isPackageModalOpen}
          onClose={() => setIsPackageModalOpen(false)}
          className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-purple-50/50">
            <div className="flex items-center gap-2">
              <Package className="text-purple-600" size={20} />
              <h3 className="text-base font-bold text-slate-800">
                {editingPackage ? 'Chỉnh Sửa Gói Buổi Học' : 'Thêm Gói Buổi Học Mới'}
              </h3>
            </div>
            <button
              onClick={() => setIsPackageModalOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer transition p-1"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSavePackageSubmit} className="p-6 space-y-4 text-xs">
            {packageError && (
              <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{packageError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên gói buổi học <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={pkgName}
                onChange={e => setPkgName(e.target.value)}
                placeholder="VD: Gói 10 buổi cơ bản, Gói 20 buổi nâng cao..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-purple-600"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Số buổi học <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  value={pkgSessionCount}
                  onChange={e => setPkgSessionCount(e.target.value)}
                  placeholder="10"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-purple-600"
                  required
                  min="1"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Giá tiền (VNĐ) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  value={pkgPrice}
                  onChange={e => setPkgPrice(e.target.value)}
                  placeholder="1000000"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-purple-600"
                  required
                  min="0"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mô tả quyền lợi gói
              </label>
              <textarea
                rows={3}
                value={pkgDescription}
                onChange={e => setPkgDescription(e.target.value)}
                placeholder="Mô tả số buổi, cố vấn 1-1, cam kết đầu ra..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-purple-600"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="pkgIsActive"
                checked={pkgIsActive}
                onChange={e => setPkgIsActive(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
              />
              <label htmlFor="pkgIsActive" className="text-xs font-semibold text-slate-700 cursor-pointer">
                Kích hoạt & hiển thị cho học sinh tự chọn mua
              </label>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPackageModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSavingPkg}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                {isSavingPkg ? 'Đang lưu...' : (editingPackage ? 'Cập nhật' : 'Tạo gói')}
              </button>
            </div>
          </form>
        </Modal>

      </div>
    </RoleGuard>
  );
}
