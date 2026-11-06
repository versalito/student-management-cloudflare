'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { ClassRequest, RequestStatus, ScheduleSlot, TIME_SHIFTS } from '@/types/schedule';
import { QuickStudentModal } from '@/components/common/QuickStudentModal';
import {
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  User,
  BookOpen,
  RotateCcw,
} from 'lucide-react';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { SegmentedControl, TabItem } from '@/components/ui/Tabs';
import { DataTable, Column, Pager } from '@/components/ui/DataTable';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

export default function AdminRequestsPage() {
  const { currentUser, isReady } = useApp();
  const toast = useToast();

  const [requests, setRequests] = useState<ClassRequest[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [allClasses, setAllClasses] = useState<any[]>([]);
  const [allScheduleSlots, setAllScheduleSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | RequestStatus>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Detail / Decision Sheet State
  const [selectedRequest, setSelectedRequest] = useState<ClassRequest | null>(null);
  const [quickStudentId, setQuickStudentId] = useState<string | null>(null);
  const [decisionAction, setDecisionAction] = useState<'ĐÃ_DUYỆT' | 'TỪ_CHỐI'>('ĐÃ_DUYỆT');
  const [decisionNote, setDecisionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    if (!isReady) return;
    setLoading(true);
    try {
      const [reqRes, stuRes, clsRes, schedRes] = await Promise.all([
        fetch('/api/requests'),
        fetch('/api/students?limit=all'),
        fetch('/api/classes'),
        fetch('/api/schedule'),
      ]);

      const [reqData, stuData, clsData, schedData] = await Promise.all([
        reqRes.json(),
        stuRes.json(),
        clsRes.json(),
        schedRes.json(),
      ]);

      setRequests(reqData.requests || []);
      setAllStudents(stuData.students || []);
      setAllClasses(clsData.classes || []);
      setAllScheduleSlots(schedData.slots || []);
    } catch (e) {
      console.error('Lỗi khi nạp dữ liệu duyệt đơn:', e);
      toast.error('Không thể tải danh sách đơn từ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isReady]);

  // Lookup maps
  const studentMap = useMemo(() => {
    return new Map(allStudents.map((s) => [s.id, s]));
  }, [allStudents]);

  const classMap = useMemo(() => {
    return new Map(allClasses.map((c) => [c.id, c]));
  }, [allClasses]);

  const slotMap = useMemo(() => {
    return new Map(allScheduleSlots.map((s) => [s.id, s]));
  }, [allScheduleSlots]);

  // Helpers
  const formatSlotDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
      const dayName = days[d.getDay()] || '';
      const [, month, day] = dateStr.split('-');
      return dayName + ', ' + day + '/' + month;
    } catch {
      return dateStr;
    }
  };

  const getShiftLabel = (shiftId: number) => {
    const s = TIME_SHIFTS.find((ts) => ts.id === shiftId);
    return s ? s.name : 'Ca ' + shiftId;
  };

  // Giờ thật của buổi học được ưu tiên; ca mẫu chỉ dùng khi buổi học chưa có giờ riêng.
  const formatSlotTime = (slot: { shiftId: number; startTime?: string; endTime?: string }) =>
    slot.startTime && slot.endTime ? `${slot.startTime} – ${slot.endTime}` : getShiftLabel(slot.shiftId);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (statusFilter !== 'ALL' && req.status !== statusFilter) return false;

      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const student = studentMap.get(req.studentId);
        const cls = classMap.get(req.classId);

        const matchId = req.id.toLowerCase().includes(query);
        const matchStudentId = req.studentId.toLowerCase().includes(query);
        const matchStudentName = ((student?.fullName || student?.name || '') as string).toLowerCase().includes(query);
        const matchClassId = req.classId.toLowerCase().includes(query);
        const matchClassName = ((cls?.name || '') as string).toLowerCase().includes(query);
        const matchReason = req.reason.toLowerCase().includes(query);

        return matchId || matchStudentId || matchStudentName || matchClassId || matchClassName || matchReason;
      }

      return true;
    });
  }, [requests, statusFilter, searchTerm, studentMap, classMap]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchTerm]);

  const paginatedRequests = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRequests.slice(start, start + pageSize);
  }, [filteredRequests, page, pageSize]);

  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'CHỜ_DUYỆT').length, [requests]);
  const approvedCount = useMemo(() => requests.filter((r) => r.status === 'ĐÃ_DUYỆT').length, [requests]);
  const rejectedCount = useMemo(() => requests.filter((r) => r.status === 'TỪ_CHỐI').length, [requests]);

  const filterTabs: TabItem<string>[] = [
    { value: 'ALL', label: 'Tất cả', count: requests.length },
    { value: 'CHỜ_DUYỆT', label: 'Chờ duyệt', count: pendingCount },
    { value: 'ĐÃ_DUYỆT', label: 'Đã duyệt', count: approvedCount },
    { value: 'TỪ_CHỐI', label: 'Từ chối', count: rejectedCount },
  ];

  const handleOpenDetail = (req: ClassRequest) => {
    setSelectedRequest(req);
    setDecisionAction('ĐÃ_DUYỆT');
    setDecisionNote(
      req.status === 'CHỜ_DUYỆT'
        ? 'Đã phê duyệt nguyện vọng của học viên.'
        : req.reviewNote || ''
    );
  };

  const handleOpenDecision = (req: ClassRequest, action: 'ĐÃ_DUYỆT' | 'TỪ_CHỐI') => {
    setSelectedRequest(req);
    setDecisionAction(action);
    setDecisionNote(
      action === 'ĐÃ_DUYỆT'
        ? 'Đã phê duyệt nguyện vọng của học viên.'
        : 'Không thể sắp xếp theo nguyện vọng.'
    );
  };

  const handleConfirmDecision = async () => {
    if (!selectedRequest) return;
    if (!decisionNote.trim()) {
      toast.error('Vui lòng nhập ghi chú phản hồi');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DECIDE',
          requestId: selectedRequest.id,
          status: decisionAction,



          reviewNote: decisionNote.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(decisionAction === 'ĐÃ_DUYỆT' ? 'Đã duyệt đơn' : 'Đã từ chối đơn');
        setSelectedRequest(null);
        await loadData();
      } else {
        toast.error(data.error || 'Có lỗi xảy ra khi cập nhật quyết định duyệt.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Lỗi mạng hoặc hệ thống.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case 'CHỜ_DUYỆT':
        return <Badge tone="warning" dot>Chờ duyệt</Badge>;
      case 'ĐÃ_DUYỆT':
        return <Badge tone="success" dot>Đã duyệt</Badge>;
      case 'TỪ_CHỐI':
        return <Badge tone="danger" dot>Từ chối</Badge>;
      default:
        return <Badge tone="neutral">{status}</Badge>;
    }
  };

  const columns: Column<ClassRequest>[] = [
    {
      key: 'id',
      header: 'Mã đơn',
      render: (req) => (
        <span className="font-mono text-xs font-semibold text-muted-foreground">
          #{req.id}
        </span>
      ),
    },
    {
      key: 'student',
      header: 'Học viên',
      render: (req) => {
        const student = studentMap.get(req.studentId);
        return (
          <button
            type="button"
            onClick={() => setQuickStudentId(req.studentId)}
            className="text-left cursor-pointer hover:opacity-80 transition"
            title="Xem thông tin học sinh"
          >
            <p className="font-semibold text-foreground text-sm">
              {student?.fullName || student?.name || 'Học viên ' + req.studentId}
            </p>
            <p className="text-[12px] text-muted-foreground font-mono">
              {req.studentId}
            </p>
          </button>
        );
      },
    },
    {
      key: 'class_slot',
      header: 'Lớp & Ca học',
      render: (req) => {
        const cls = classMap.get(req.classId);
        const origSlot = slotMap.get(req.scheduleSlotId);
        return (
          <div className="space-y-0.5">
            <p className="font-medium text-foreground text-sm">
              {cls?.name || req.classId}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {origSlot ? formatSlotDate(origSlot.date) + ' • ' + formatSlotTime(origSlot) : req.scheduleSlotId}
            </p>
          </div>
        );
      },
    },
    {
      key: 'reason',
      header: 'Lý do',
      render: (req) => (
        <p className="text-sm text-foreground line-clamp-1 max-w-xs" title={req.reason}>
          {req.reason}
        </p>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      align: 'center',
      render: (req) => getStatusBadge(req.status),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      render: (req) => (
        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {req.status === 'CHỜ_DUYỆT' ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleOpenDecision(req, 'TỪ_CHỐI')}
              >
                Từ chối
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenDecision(req, 'ĐÃ_DUYỆT')}
              >
                Duyệt
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleOpenDetail(req)}
            >
              Xem chi tiết
            </Button>
          )}
        </div>
      ),
    },
  ];

  const selectedStudent = selectedRequest ? studentMap.get(selectedRequest.studentId) : null;
  const selectedClass = selectedRequest ? classMap.get(selectedRequest.classId) : null;
  const selectedSlot = selectedRequest ? slotMap.get(selectedRequest.scheduleSlotId) : null;

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Duyệt đơn từ"
          subtitle="Xử lý đơn xin nghỉ học của học viên"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Stats Bar */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Tổng đơn từ"
              value={requests.length}
              tone="primary"
              icon={<Inbox size={18} />}
            />
            <StatCard
              label="Chờ duyệt"
              value={pendingCount}
              tone="warning"
              icon={<Clock size={18} />}
            />
            <StatCard
              label="Đã chấp thuận"
              value={approvedCount}
              tone="success"
              icon={<CheckCircle2 size={18} />}
            />
            <StatCard
              label="Đã từ chối"
              value={rejectedCount}
              tone="danger"
              icon={<XCircle size={18} />}
            />
          </section>

          {/* Filter and Search Controls */}
          <Card className="space-y-3.5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <SegmentedControl
                items={filterTabs}
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as any)}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  icon={<RotateCcw size={16} />}
                  onClick={loadData}
                  title="Tải lại"
                >
                  Làm mới
                </Button>
              </div>
            </div>

            <div className="w-full">
              <SearchInput
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Tìm mã đơn, tên học viên, mã lớp, lý do..."
              />
            </div>
          </Card>

          {/* Table */}
          <DataTable
            columns={columns}
            rows={paginatedRequests}
            rowKey={(req) => req.id}
            loading={loading}
            emptyTitle="Không tìm thấy đơn từ nào"
            emptyDescription="Thử thay đổi bộ lọc tìm kiếm hoặc làm mới trang."
            emptyIcon={<Inbox size={24} />}
            onRowClick={(req) => handleOpenDetail(req)}
            renderMobile={(req) => {
              const student = studentMap.get(req.studentId);
              const cls = classMap.get(req.classId);
              const origSlot = slotMap.get(req.scheduleSlotId);

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">
                      #{req.id}
                    </span>
                    {getStatusBadge(req.status)}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setQuickStudentId(req.studentId)}
                      className="font-semibold text-foreground text-sm text-left cursor-pointer hover:opacity-80 transition"
                      title="Xem thông tin học sinh"
                    >
                      {student?.fullName || student?.name || 'Học viên ' + req.studentId}
                    </button>
                    <p className="text-[12px] text-muted-foreground">
                      {cls?.name || req.classId}
                    </p>
                    {origSlot && (
                      <p className="text-[12px] text-muted-foreground mt-0.5">
                        {formatSlotDate(origSlot.date)} • {formatSlotTime(origSlot)}
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-foreground bg-muted p-2.5 rounded-field italic">
                    &ldquo;{req.reason}&rdquo;
                  </p>

                  <div className="flex items-center justify-end gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    {req.status === 'CHỜ_DUYỆT' ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleOpenDecision(req, 'TỪ_CHỐI')}
                        >
                          Từ chối
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleOpenDecision(req, 'ĐÃ_DUYỆT')}
                        >
                          Duyệt
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleOpenDetail(req)}
                      >
                        Chi tiết
                      </Button>
                    )}
                  </div>
                </div>
              );
            }}
            footer={
              filteredRequests.length > 0 ? (
                <Pager
                  page={page}
                  pageSize={pageSize}
                  total={filteredRequests.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              ) : undefined
            }
          />
        </main>

        {/* Sheet xem chi tiết và phê duyệt */}
        <Sheet
          isOpen={Boolean(selectedRequest)}
          onClose={() => setSelectedRequest(null)}
          title={selectedRequest?.status === 'CHỜ_DUYỆT' ? 'Duyệt đơn từ học viên' : 'Chi tiết đơn từ'}
          description={
            selectedRequest
              ? 'Mã đơn #' + selectedRequest.id + ' • Gửi lúc ' + new Date(selectedRequest.createdAt).toLocaleDateString('vi-VN') + ' ' + new Date(selectedRequest.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
              : ''
          }
          size="md"
          footer={
            selectedRequest?.status === 'CHỜ_DUYỆT' ? (
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 w-full">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setSelectedRequest(null)}
                >
                  Đóng
                </Button>
                <Button
                  variant={decisionAction === 'ĐÃ_DUYỆT' ? 'success' : 'danger'}
                  size="md"
                  loading={submitting}
                  icon={decisionAction === 'ĐÃ_DUYỆT' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  onClick={handleConfirmDecision}
                >
                  {decisionAction === 'ĐÃ_DUYỆT' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="md"
                onClick={() => setSelectedRequest(null)}
              >
                Đóng
              </Button>
            )
          }
        >
          {selectedRequest && (
            <div className="space-y-4 pt-1">
              {/* Trạng thái hiện tại */}
              <div className="flex items-center justify-between p-3 rounded-field bg-muted">
                <span className="text-xs font-semibold text-muted-foreground">Trạng thái xử lý</span>
                {getStatusBadge(selectedRequest.status)}
              </div>

              {/* Thông tin học viên */}
              <div className="p-3.5 rounded-field bg-muted space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <User size={14} />
                  <span>Học viên nộp đơn</span>
                </div>
                <div className="text-sm font-bold text-foreground">
                  {selectedStudent?.fullName || selectedStudent?.name || 'Học viên ' + selectedRequest.studentId}
                  <span className="text-xs font-normal text-muted-foreground ml-2 font-mono">
                    ({selectedRequest.studentId})
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  SĐT: {selectedStudent?.phone || 'N/A'}
                </div>
              </div>

              {/* Thông tin lớp học */}
              <div className="p-3.5 rounded-field bg-muted space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <BookOpen size={14} />
                  <span>Lớp học & Ca học</span>
                </div>
                <div className="text-sm font-bold text-foreground">
                  {selectedClass?.name || selectedRequest.classId}
                  <span className="text-xs font-normal text-muted-foreground ml-2 font-mono">
                    ({selectedRequest.classId})
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Môn: <strong className="text-foreground">{selectedClass?.subject || 'Chưa định danh'}</strong> • GV phụ trách: {selectedClass?.teacherId || 'N/A'}
                </div>
                {selectedSlot && (
                  <div className="pt-1.5 border-t border-line text-xs space-y-1">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <Calendar size={13} />
                      {formatSlotDate(selectedSlot.date)} — {formatSlotTime(selectedSlot)}
                    </p>
                    <p className="text-muted-foreground">
                      GV: {selectedSlot.teacherId}
                    </p>
                  </div>
                )}
              </div>

              {/* Lý do nộp đơn */}
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-foreground">Lý do xin nghỉ</label>
                <div className="p-3 rounded-field bg-muted text-sm text-foreground italic leading-relaxed">
                  &ldquo;{selectedRequest.reason}&rdquo;
                </div>
              </div>

              {/* Đã có kết quả duyệt trước đó */}
              {selectedRequest.reviewNote && (
                <div className="p-3.5 rounded-field bg-muted space-y-1 border border-line">
                  <p className="text-xs font-semibold text-foreground">
                    Ghi chú duyệt ({selectedRequest.reviewedBy || 'Admin'}):
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {selectedRequest.reviewNote}
                  </p>
                </div>
              )}

              {/* Form xử lý duyệt nếu đang chờ */}
              {selectedRequest.status === 'CHỜ_DUYỆT' && (
                <div className="space-y-3.5 pt-2 border-t border-line">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-foreground">Quyết định xử lý</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionAction('ĐÃ_DUYỆT');
                          if (!decisionNote || decisionNote === 'Không thể sắp xếp theo nguyện vọng.') {
                            setDecisionNote('Đã phê duyệt nguyện vọng của học viên.');
                          }
                        }}
                        className={cn(
                          'p-3 rounded-field text-xs font-semibold border transition text-center cursor-pointer',
                          decisionAction === 'ĐÃ_DUYỆT'
                            ? 'bg-success-soft text-foreground border-success'
                            : 'bg-card text-muted-foreground border-line hover:text-foreground'
                        )}
                      >
                        Chấp thuận duyệt
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionAction('TỪ_CHỐI');
                          if (!decisionNote || decisionNote === 'Đã phê duyệt nguyện vọng của học viên.') {
                            setDecisionNote('Không thể sắp xếp theo nguyện vọng.');
                          }
                        }}
                        className={cn(
                          'p-3 rounded-field text-xs font-semibold border transition text-center cursor-pointer',
                          decisionAction === 'TỪ_CHỐI'
                            ? 'bg-danger-soft text-foreground border-danger'
                            : 'bg-card text-muted-foreground border-line hover:text-foreground'
                        )}
                      >
                        Từ chối đơn
                      </button>
                    </div>
                  </div>

                  <Field
                    label="Ghi chú phản hồi cho học viên"
                    required
                    hint="Nội dung sẽ gửi phản hồi đến học viên"
                  >
                    <Textarea
                      rows={3}
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder="Nhập nội dung phản hồi chính thức..."
                    />
                  </Field>
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
