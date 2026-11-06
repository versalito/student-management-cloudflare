'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { DataTable, Pager, Column } from '@/components/ui/DataTable';
import { SegmentedControl, TabItem } from '@/components/ui/Tabs';
import { SearchInput } from '@/components/ui/SearchInput';
import { Badge } from '@/components/ui/Badge';
import { Card, StatCard } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { AuditLog } from '@/types/audit';
import { History, Activity, CalendarCheck, CreditCard } from 'lucide-react';

const ACTION_LABELS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' }> = {
  ALL: { label: 'Tất cả', tone: 'neutral' },
  CREATE: { label: 'Tạo mới', tone: 'success' },
  UPDATE: { label: 'Cập nhật', tone: 'info' },
  UPDATE_STATUS: { label: 'Đổi trạng thái', tone: 'info' },
  DELETE: { label: 'Xóa', tone: 'danger' },
  LOGIN: { label: 'Đăng nhập', tone: 'neutral' },
  ATTENDANCE_CHECK: { label: 'Điểm danh', tone: 'primary' },
  SCHEDULE_CHANGE: { label: 'Đổi lịch', tone: 'warning' },
  PAYMENT_PROCESS: { label: 'Xác nhận thu tiền', tone: 'success' },
  PACKAGE_PURCHASE: { label: 'Mua gói', tone: 'primary' },
  CANCEL_INVOICE: { label: 'Hủy gói', tone: 'danger' },
  REQUEST_DECIDE: { label: 'Duyệt đơn', tone: 'primary' },
  SESSION_BOOKED: { label: 'Đặt buổi lẻ', tone: 'primary' },
  SESSION_BOOKING_CANCELLED: { label: 'Huỷ buổi lẻ', tone: 'warning' },
};

function formatDateTime(isoStr: string) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return isoStr;
  }
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Phân trang
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Số lượng theo từng loại thao tác: gọi 1 lần khi mở trang (HEAD + count ở DB).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/audit?stats=1')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setCounts(data.counts || {});
      })
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Phân trang + tìm kiếm + lọc loại thao tác phía server: mỗi trang chỉ tải `pageSize` bản ghi.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(currentPage),
          limit: String(pageSize),
        });
        if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
        if (actionFilter !== 'ALL') params.set('action', actionFilter);

        const res = await fetch(`/api/audit?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentPage, pageSize, debouncedSearch, actionFilter]);

  const tabItems: TabItem<string>[] = useMemo(() => {
    const popularActions = [
      'ALL',
      'ATTENDANCE_CHECK',
      'SCHEDULE_CHANGE',
      'PAYMENT_PROCESS',
      'REQUEST_DECIDE',
      'SESSION_BOOKED',
      'SESSION_BOOKING_CANCELLED',
      'CREATE',
      'UPDATE',
      'DELETE',
    ];

    return popularActions.map((act) => ({
      value: act,
      label: ACTION_LABELS[act]?.label || act,
      count: counts[act] || 0,
    }));
  }, [counts]);

  const paginatedLogs = logs;

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setCurrentPage(1);
  };

  const handleActionFilterChange = (act: string) => {
    setActionFilter(act);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  // Thống kê nhanh (toàn bộ nhật ký, không phải chỉ trang đang xem)
  const stats = useMemo(
    () => ({
      total: counts.ALL || 0,
      attendance: counts.ATTENDANCE_CHECK || 0,
      payment: counts.PAYMENT_PROCESS || 0,
      schedule: counts.SCHEDULE_CHANGE || 0,
    }),
    [counts]
  );

  const columns: Column<AuditLog>[] = [
    {
      key: 'id',
      header: 'Mã & Thời gian',
      className: 'w-48 whitespace-nowrap',
      render: (row) => (
        <div className="space-y-0.5">
          <p className="font-mono text-[12px] font-bold text-foreground">{row.id}</p>
          <p className="text-[12px] text-muted-foreground tabular">{formatDateTime(row.timestamp)}</p>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'Người thực hiện',
      className: 'min-w-[180px]',
      render: (row) => {
        const roleTone =
          row.userRole === 'ADMIN'
            ? 'danger'
            : row.userRole === 'TEACHER'
            ? 'info'
            : 'neutral';
        return (
          <div className="space-y-1">
            <p className="font-semibold text-foreground text-[13px]">{row.userName}</p>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">{row.userId}</span>
              <Badge tone={roleTone} className="text-[10px] px-1.5 py-0">
                {row.userRole}
              </Badge>
            </div>
          </div>
        );
      },
    },
    {
      key: 'action',
      header: 'Hành động',
      className: 'w-36 whitespace-nowrap',
      render: (row) => {
        const cfg = ACTION_LABELS[row.action] || { label: row.action, tone: 'neutral' };
        return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
      },
    },
    {
      key: 'resource',
      header: 'Tài nguyên',
      className: 'w-36 whitespace-nowrap',
      render: (row) => (
        <div className="space-y-0.5">
          <span className="inline-block px-2 py-0.5 rounded-pill bg-primary-soft text-primary-ink font-mono text-[11px] font-semibold">
            {row.targetResource}
          </span>
          {row.targetId && (
            <p className="font-mono text-[11px] text-muted-foreground truncate max-w-[130px]" title={row.targetId}>
              {row.targetId}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'details',
      header: 'Chi tiết thao tác',
      render: (row) => (
        <p className="text-[13px] text-foreground leading-snug line-clamp-2 max-w-xl">
          {row.details}
        </p>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Nhật ký hệ thống"
          subtitle="Ghi nhận mọi thao tác phân công, sửa lịch, điểm danh, nộp học phí và duyệt đơn"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Thống kê nhanh */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Tổng lượt thao tác"
              value={stats.total}
              icon={<Activity size={20} />}
              tone="primary"
            />
            <StatCard
              label="Lượt điểm danh"
              value={stats.attendance}
              icon={<CalendarCheck size={20} />}
              tone="info"
            />
            <StatCard
              label="Lượt thanh toán"
              value={stats.payment}
              icon={<CreditCard size={20} />}
              tone="success"
            />
            <StatCard
              label="Điều chỉnh lịch học"
              value={stats.schedule}
              icon={<History size={20} />}
              tone="warning"
            />
          </div>

          {/* Bộ lọc & Tìm kiếm */}
          <Card padded={false} className="p-3 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <SearchInput
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder="Tìm người dùng, mã nhật ký, nội dung..."
                className="w-full sm:w-80"
              />
              <p className="text-[12px] text-muted-foreground tabular shrink-0">
                Hiển thị <span className="font-bold text-foreground">{logs.length}</span> / {total} bản ghi
              </p>
            </div>

            <SegmentedControl
              items={tabItems}
              value={actionFilter}
              onChange={handleActionFilterChange}
            />
          </Card>

          {/* Bảng dữ liệu */}
          <DataTable
            columns={columns}
            rows={paginatedLogs}
            rowKey={(row) => row.id}
            loading={loading}
            emptyTitle="Không có nhật ký phù hợp"
            emptyDescription="Chưa có thao tác nào khớp với điều kiện tìm kiếm hoặc bộ lọc hiện tại."
            emptyIcon={<History size={28} />}
            onRowClick={(row) => setSelectedLog(row)}
            renderMobile={(row) => {
              const cfg = ACTION_LABELS[row.action] || { label: row.action, tone: 'neutral' };
              const roleTone =
                row.userRole === 'ADMIN'
                  ? 'danger'
                  : row.userRole === 'TEACHER'
                  ? 'info'
                  : 'neutral';

              return (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-[12px] font-bold text-foreground">{row.id}</span>
                      <p className="text-[11px] text-muted-foreground tabular">{formatDateTime(row.timestamp)}</p>
                    </div>
                    <Badge tone={cfg.tone}>{cfg.label}</Badge>
                  </div>

                  <p className="text-[13px] text-foreground leading-snug">{row.details}</p>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">{row.userName}</span>
                      <Badge tone={roleTone} className="text-[10px] px-1 py-0">
                        {row.userRole}
                      </Badge>
                    </div>
                    <span className="font-mono text-muted-foreground">{row.targetResource}</span>
                  </div>
                </div>
              );
            }}
            footer={
              <Pager
                page={currentPage}
                pageSize={pageSize}
                total={total}
                onPageChange={setCurrentPage}
                onPageSizeChange={handlePageSizeChange}
              />
            }
          />
        </main>

        {/* Hộp thoại xem chi tiết bản ghi */}
        <Sheet
          isOpen={!!selectedLog}
          onClose={() => setSelectedLog(null)}
          title="Chi tiết thao tác nhật ký"
          description={selectedLog ? `Mã bản ghi: ${selectedLog.id}` : undefined}
          footer={
            <Button variant="secondary" onClick={() => setSelectedLog(null)}>
              Đóng
            </Button>
          }
        >
          {selectedLog && (
            <div className="space-y-4 text-[13px]">
              <div className="p-3 rounded-field bg-muted/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Thời gian:</span>
                  <span className="font-semibold text-foreground tabular">{formatDateTime(selectedLog.timestamp)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Người thực hiện:</span>
                  <span className="font-semibold text-foreground">
                    {selectedLog.userName} ({selectedLog.userId})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Vai trò:</span>
                  <Badge
                    tone={
                      selectedLog.userRole === 'ADMIN'
                        ? 'danger'
                        : selectedLog.userRole === 'TEACHER'
                        ? 'info'
                        : 'neutral'
                    }
                  >
                    {selectedLog.userRole}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Hành động:</span>
                  <Badge tone={ACTION_LABELS[selectedLog.action]?.tone || 'neutral'}>
                    {ACTION_LABELS[selectedLog.action]?.label || selectedLog.action}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tài nguyên tác động:</span>
                  <span className="font-mono font-semibold text-foreground">{selectedLog.targetResource}</span>
                </div>
                {selectedLog.targetId && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Mã đối tượng:</span>
                    <span className="font-mono text-foreground">{selectedLog.targetId}</span>
                  </div>
                )}
                {selectedLog.ipAddress && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Địa chỉ IP:</span>
                    <span className="font-mono text-foreground">{selectedLog.ipAddress}</span>
                  </div>
                )}
              </div>

              <div>
                <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Nội dung diễn giải
                </p>
                <div className="p-3 rounded-field bg-muted text-foreground leading-relaxed">
                  {selectedLog.details}
                </div>
              </div>

              {(selectedLog.oldValue || selectedLog.newValue) && (
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Biến động dữ liệu
                  </p>
                  {selectedLog.oldValue && (
                    <div className="p-2.5 rounded-field bg-danger-soft/30 border border-danger-soft text-[12px] font-mono break-all">
                      <span className="font-bold text-danger">Giá trị cũ: </span>
                      {selectedLog.oldValue}
                    </div>
                  )}
                  {selectedLog.newValue && (
                    <div className="p-2.5 rounded-field bg-success-soft/30 border border-success-soft text-[12px] font-mono break-all">
                      <span className="font-bold text-success">Giá trị mới: </span>
                      {selectedLog.newValue}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Sheet>
      </div>
    </RoleGuard>
  );
}

