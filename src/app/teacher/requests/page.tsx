'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { useApp } from '@/context/AppContext';
import { ClassRequest } from '@/types/schedule';
import { QuickStudentModal } from '@/components/common/QuickStudentModal';
import {
  StatCard,
  Button,
  DataTable,
  Column,
  Sheet,
  SegmentedControl,
  TabItem,
  SearchInput,
  Field,
  Textarea,
  Avatar,
  Badge,
  useToast,
} from '@/components/ui';
import { Inbox, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface RequestRowItem extends ClassRequest {
  _index: number;
}

export default function TeacherRequestsPage() {
  const { currentUser, isReady } = useApp();
  const [requests, setRequests] = useState<ClassRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filter & Search
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CHỜ_DUYỆT' | 'ĐÃ_DUYỆT' | 'TỪ_CHỐI'>('ALL');
  const [search, setSearch] = useState('');

  // Review Sheet
  const [selectedRequest, setSelectedRequest] = useState<ClassRequest | null>(null);
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [quickStudentId, setQuickStudentId] = useState<string | null>(null);

  const toast = useToast();

  const loadRequests = async () => {
    if (!isReady || !currentUser?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/requests?teacherId=${currentUser.id}`);
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [currentUser, isReady]);

  const handleDecision = async (
    requestId: string,
    status: 'ĐÃ_DUYỆT' | 'TỪ_CHỐI',
    note?: string
  ) => {
    setActionLoading(requestId);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DECIDE',
          requestId,
          status,



          reviewNote:
            note !== undefined && note.trim() !== ''
              ? note.trim()
              : status === 'ĐÃ_DUYỆT'
              ? 'Đã duyệt yêu cầu của em.'
              : 'Không thể sắp xếp theo nguyện vọng.',
        }),
      });
      if (res.ok) {
        toast.success(status === 'ĐÃ_DUYỆT' ? 'Đã duyệt đơn thành công' : 'Đã từ chối đơn');
        setReviewSheetOpen(false);
        await loadRequests();
      } else {
        toast.error('Xử lý đơn thất bại');
      }
    } catch (e) {
      console.error(e);
      toast.error('Có lỗi xảy ra khi xử lý đơn');
    } finally {
      setActionLoading(null);
    }
  };

  const openReview = (req: ClassRequest) => {
    setSelectedRequest(req);
    setReviewNote(req.reviewNote || '');
    setReviewSheetOpen(true);
  };

  const pendingCount = requests.filter((r) => r.status === 'CHỜ_DUYỆT').length;
  const approvedCount = requests.filter((r) => r.status === 'ĐÃ_DUYỆT').length;
  const rejectedCount = requests.filter((r) => r.status === 'TỪ_CHỐI').length;

  const filterTabs: TabItem<'ALL' | 'CHỜ_DUYỆT' | 'ĐÃ_DUYỆT' | 'TỪ_CHỐI'>[] = [
    { value: 'ALL', label: 'Tất cả', count: requests.length },
    { value: 'CHỜ_DUYỆT', label: 'Chờ duyệt', count: pendingCount },
    { value: 'ĐÃ_DUYỆT', label: 'Đã duyệt', count: approvedCount },
    { value: 'TỪ_CHỐI', label: 'Từ chối', count: rejectedCount },
  ];

  const filteredRequests = requests.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.studentId || '').toLowerCase().includes(q) ||
      (r.classId || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q)
    );
  });

  const rowData: RequestRowItem[] = filteredRequests.map((r, i) => ({
    ...r,
    _index: i,
  }));

  const columns: Column<RequestRowItem>[] = [
    {
      key: 'stt',
      header: 'STT',
      className: 'w-12 text-center',
      render: (r) => (
        <span className="tabular text-muted-foreground text-xs">{r._index + 1}</span>
      ),
    },
    {
      key: 'student',
      header: 'Học viên & Lớp',
      render: (r) => (
        <button
          type="button"
          onClick={() => setQuickStudentId(r.studentId)}
          className="flex items-center gap-3 min-w-[140px] text-left cursor-pointer hover:opacity-80 transition"
          title="Xem thông tin học sinh"
        >
          <Avatar name={r.studentId} size={36} />
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-sm truncate">
              {r.studentName || 'Học viên ' + r.studentId}
            </p>
            <p className="text-[12px] text-muted-foreground">Lớp {r.classId}</p>
          </div>
        </button>
      ),
    },
    {
      key: 'type',
      header: 'Loại đơn',
      className: 'w-32',
      render: (r) => (
        <Badge tone={r.type === 'XIN_NGHI' ? 'warning' : 'info'}>
          Xin nghỉ học
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: 'Lý do & Phản hồi',
      render: (r) => (
        <div className="max-w-md py-1">
          <p className="text-[13px] text-foreground line-clamp-2 italic">
            &quot;{r.reason}&quot;
          </p>
          {r.reviewNote && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Phản hồi: <span className="text-foreground font-medium">{r.reviewNote}</span>
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Ngày gửi',
      className: 'w-28 text-center',
      render: (r) => (
        <span className="tabular text-muted-foreground text-[12px]">
          {new Date(r.createdAt).toLocaleDateString('vi-VN')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      className: 'w-28 text-center',
      render: (r) => (
        <Badge
          tone={
            r.status === 'ĐÃ_DUYỆT'
              ? 'success'
              : r.status === 'TỪ_CHỐI'
              ? 'danger'
              : 'warning'
          }
          dot
        >
          {r.status === 'ĐÃ_DUYỆT'
            ? 'Đã duyệt'
            : r.status === 'TỪ_CHỐI'
            ? 'Từ chối'
            : 'Chờ duyệt'}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: 'Thao tác',
      className: 'w-28 text-right',
      render: (r) => (
        <Button
          variant={r.status === 'CHỜ_DUYỆT' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => openReview(r)}
        >
          {r.status === 'CHỜ_DUYỆT' ? 'Xét duyệt' : 'Xem đơn'}
        </Button>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={['TEACHER', 'ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Xử lý đơn xin nghỉ học"
          subtitle="Phê duyệt hoặc từ chối đơn xin nghỉ của học viên trong các lớp phụ trách"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* KPI StatCards */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Tổng số đơn"
              value={loading ? '—' : requests.length}
              hint="Đơn từ học viên"
              icon={<Inbox size={18} />}
              tone="primary"
            />
            <StatCard
              label="Chờ duyệt"
              value={loading ? '—' : pendingCount}
              hint="Cần xử lý trước giờ học"
              icon={<Clock size={18} />}
              tone="warning"
            />
            <StatCard
              label="Đã phê duyệt"
              value={loading ? '—' : approvedCount}
              hint="Chấp thuận nguyện vọng"
              icon={<CheckCircle2 size={18} />}
              tone="success"
            />
            <StatCard
              label="Đã từ chối"
              value={loading ? '—' : rejectedCount}
              hint="Không thể sắp xếp"
              icon={<XCircle size={18} />}
              tone="danger"
            />
          </section>

          {/* Filter & Search Bar */}
          <div className="bg-card border border-line rounded-card shadow-card p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <SegmentedControl
              items={filterTabs}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <div className="w-full sm:w-72">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Tìm mã học viên, lớp, lý do..."
              />
            </div>
          </div>

          {/* DataTable */}
          <DataTable
            columns={columns}
            rows={rowData}
            rowKey={(r) => r.id || `${r.studentId}_${r._index}`}
            loading={loading}
            emptyTitle="Không có đơn nào"
            emptyDescription={
              search
                ? 'Không tìm thấy yêu cầu phù hợp với từ khóa tìm kiếm.'
                : 'Hiện không có yêu cầu nào trong danh mục này.'
            }
            emptyIcon={<Inbox size={28} />}
            renderMobile={(r) => (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={r.studentName || r.studentId} size={36} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setQuickStudentId(r.studentId)}
                        className="font-semibold text-foreground text-sm truncate text-left cursor-pointer hover:opacity-80 transition"
                        title="Xem thông tin học sinh"
                      >
                        {r.studentName || 'Học viên ' + r.studentId}
                      </button>
                      <p className="text-[12px] text-muted-foreground">Lớp {r.classId}</p>
                    </div>
                  </div>
                  <Badge
                    tone={
                      r.status === 'ĐÃ_DUYỆT'
                        ? 'success'
                        : r.status === 'TỪ_CHỐI'
                        ? 'danger'
                        : 'warning'
                    }
                    dot
                  >
                    {r.status === 'ĐÃ_DUYỆT'
                      ? 'Đã duyệt'
                      : r.status === 'TỪ_CHỐI'
                      ? 'Từ chối'
                      : 'Chờ duyệt'}
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <Badge tone={r.type === 'XIN_NGHI' ? 'warning' : 'info'}>
                    Xin nghỉ học
                  </Badge>
                  <span className="tabular text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString('vi-VN')}
                  </span>
                </div>

                <div className="p-2.5 rounded-field bg-muted text-xs text-foreground italic">
                  &quot;{r.reason}&quot;
                </div>

                {r.reviewNote && (
                  <div className="text-xs text-muted-foreground">
                    Phản hồi: <span className="text-foreground">{r.reviewNote}</span>
                  </div>
                )}

                <div className="pt-1 flex justify-end">
                  <Button
                    variant={r.status === 'CHỜ_DUYỆT' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => openReview(r)}
                  >
                    {r.status === 'CHỜ_DUYỆT' ? 'Xét duyệt' : 'Xem đơn'}
                  </Button>
                </div>
              </div>
            )}
          />
        </main>

        {/* Review Sheet */}
        <Sheet
          isOpen={reviewSheetOpen}
          onClose={() => setReviewSheetOpen(false)}
          title={
            selectedRequest?.status === 'CHỜ_DUYỆT'
              ? 'Xét duyệt đơn của học viên'
              : 'Chi tiết đơn của học viên'
          }
          description={
            selectedRequest
              ? `Học viên ${selectedRequest.studentId} • Lớp ${selectedRequest.classId}`
              : undefined
          }
          footer={
            selectedRequest?.status === 'CHỜ_DUYỆT' ? (
              <div className="flex items-center justify-end gap-2 w-full">
                <Button
                  variant="ghost"
                  onClick={() => setReviewSheetOpen(false)}
                  disabled={!!actionLoading}
                >
                  Đóng
                </Button>
                <Button
                  variant="danger"
                  loading={actionLoading === selectedRequest.id}
                  disabled={!!actionLoading}
                  onClick={() =>
                    handleDecision(
                      selectedRequest.id,
                      'TỪ_CHỐI',
                      reviewNote || 'Không thể sắp xếp theo nguyện vọng.'
                    )
                  }
                  icon={<XCircle size={16} />}
                >
                  Từ chối đơn
                </Button>
                <Button
                  variant="primary"
                  loading={actionLoading === selectedRequest.id}
                  disabled={!!actionLoading}
                  onClick={() =>
                    handleDecision(
                      selectedRequest.id,
                      'ĐÃ_DUYỆT',
                      reviewNote || 'Đã duyệt yêu cầu của em.'
                    )
                  }
                  icon={<CheckCircle2 size={16} />}
                >
                  Chấp thuận duyệt
                </Button>
              </div>
            ) : (
              <div className="flex justify-end w-full">
                <Button variant="secondary" onClick={() => setReviewSheetOpen(false)}>
                  Đóng
                </Button>
              </div>
            )
          }
        >
          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-field bg-muted/60 border border-line text-xs">
                <div>
                  <span className="text-muted-foreground block mb-0.5">Loại yêu cầu:</span>
                  <Badge tone={selectedRequest.type === 'XIN_NGHI' ? 'warning' : 'info'}>
                    Xin nghỉ học
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-0.5">Ngày gửi đơn:</span>
                  <span className="font-semibold text-foreground tabular">
                    {new Date(selectedRequest.createdAt).toLocaleDateString('vi-VN')}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-foreground mb-1">
                  Lý do xin phép từ học viên:
                </label>
                <div className="p-3 rounded-field bg-muted text-sm text-foreground italic border border-line leading-relaxed">
                  &quot;{selectedRequest.reason}&quot;
                </div>
              </div>

              {selectedRequest.status === 'CHỜ_DUYỆT' ? (
                <Field
                  label="Lời nhắn phản hồi"
                  hint="Lời nhắn này sẽ được gửi kèm thông báo kết quả đến học viên"
                >
                  <Textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="Nhập lời dặn dò hoặc lý do (không bắt buộc)..."
                    rows={3}
                  />
                </Field>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[13px] font-semibold text-foreground">
                    Phản hồi của giảng viên
                  </p>
                  <div className="p-3 rounded-field bg-muted text-sm text-foreground border border-line">
                    {selectedRequest.reviewNote || 'Đã duyệt yêu cầu của em.'}
                  </div>
                  {selectedRequest.reviewedBy && (
                    <p className="text-[11px] text-muted-foreground">
                      Người duyệt: {selectedRequest.reviewedBy}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Sheet>
      </div>
      <QuickStudentModal studentId={quickStudentId} onClose={() => setQuickStudentId(null)} />
    </RoleGuard>
  );
}
