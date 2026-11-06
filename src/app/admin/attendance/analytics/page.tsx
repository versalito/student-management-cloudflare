'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  Field,
  LinkButton,
  Pager,
  SearchInput,
  Select,
  StatCard,
  Badge,
  type Column,
} from '@/components/ui';
import { ClassEntity } from '@/types/classroom';
import { BarChart3, CheckCircle2, Clock, AlertCircle, RotateCw, Percent, CalendarDays } from 'lucide-react';

interface StudentAttendanceSummary {
  studentId: string;
  studentName: string;
  enrolledClasses: string[];
  totalSlots: number;
  presentCount: number;
  lateCount: number;
  excusedCount: number;
  unexcusedCount: number;
  makeupCount: number;
  rate: number;
}

export default function AttendanceAnalyticsPage() {
  // Mặc định tháng hiện tại theo giờ Việt Nam.
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' }).format(new Date()).slice(0, 7)
  );
  const [selectedClassId, setSelectedClassId] = useState<string>('ALL');
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [items, setItems] = useState<StudentAttendanceSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  useEffect(() => {
    async function loadClasses() {
      try {
        const res = await fetch('/api/classes');
        const data = await res.json();
        if (data.classes) setClasses(data.classes);
      } catch (e) {
        console.error('Error fetching classes:', e);
      }
    }
    loadClasses();
  }, []);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      let url = '/api/attendance/analytics?month=' + selectedMonth;
      if (selectedClassId && selectedClassId !== 'ALL') {
        url += '&classId=' + selectedClassId;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.items) {
        setItems(data.items);
      } else {
        setItems([]);
      }
    } catch (e) {
      console.error('Error fetching attendance analytics:', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    setCurrentPage(1);
     
  }, [selectedMonth, selectedClassId]);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const q = searchTerm.toLowerCase();
    return items.filter(
      (item) =>
        item.studentId.toLowerCase().includes(q) || item.studentName.toLowerCase().includes(q)
    );
  }, [items, searchTerm]);

  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const summaryStats = useMemo(() => {
    if (items.length === 0) return { avgRate: 0, goodCount: 0, warningCount: 0, badCount: 0 };
    const avgRate = Math.round(items.reduce((sum, i) => sum + i.rate, 0) / items.length);
    const goodCount = items.filter((i) => i.rate >= 80).length;
    const warningCount = items.filter((i) => i.rate >= 60 && i.rate < 80).length;
    const badCount = items.filter((i) => i.rate < 60).length;
    return { avgRate, goodCount, warningCount, badCount };
  }, [items]);

  const columns: Column<StudentAttendanceSummary>[] = [
    {
      key: 'studentId',
      header: 'Mã',
      render: (s) => <span className="font-semibold tabular text-foreground">{s.studentId}</span>,
    },
    {
      key: 'studentName',
      header: 'Học sinh',
      render: (s) => <span className="font-semibold text-foreground">{s.studentName}</span>,
    },
    { key: 'totalSlots', header: 'Tổng buổi', align: 'center', render: (s) => <span className="tabular">{s.totalSlots}</span> },
    {
      key: 'presentCount',
      header: 'Có mặt',
      align: 'center',
      render: (s) => <span className="tabular font-semibold text-success">{s.presentCount}</span>,
    },
    {
      key: 'makeupCount',
      header: 'Học bù',
      align: 'center',
      hideOnMobile: true,
      render: (s) => <span className="tabular text-primary-ink">{s.makeupCount}</span>,
    },
    {
      key: 'lateCount',
      header: 'Đi muộn',
      align: 'center',
      hideOnMobile: true,
      render: (s) => <span className="tabular text-warning">{s.lateCount}</span>,
    },
    {
      key: 'excusedCount',
      header: 'Vắng phép',
      align: 'center',
      hideOnMobile: true,
      render: (s) => <span className="tabular text-info">{s.excusedCount}</span>,
    },
    {
      key: 'unexcusedCount',
      header: 'Vắng KP',
      align: 'center',
      render: (s) => <span className="tabular font-semibold text-danger">{s.unexcusedCount}</span>,
    },
    {
      key: 'rate',
      header: 'Chuyên cần',
      render: (s) => (
        <div className="flex items-center gap-2 min-w-[110px]">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={
                'h-full rounded-full ' +
                (s.rate >= 80 ? 'bg-success' : s.rate >= 60 ? 'bg-warning' : 'bg-danger')
              }
              style={{ width: Math.min(100, Math.max(0, s.rate)) + '%' }}
            />
          </div>
          <span className="tabular text-[13px] font-bold text-foreground">{s.rate}%</span>
        </div>
      ),
    },
    {
      key: 'verdict',
      header: 'Đánh giá',
      render: (s) => (
        <Badge tone={s.rate >= 80 ? 'success' : s.rate >= 60 ? 'warning' : 'danger'}>
          {s.rate >= 80 ? 'Tốt' : s.rate >= 60 ? 'Cần cải thiện' : 'Cảnh báo'}
        </Badge>
      ),
    },
  ];

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Chuyên cần theo tháng"
          subtitle="Tỷ lệ đi học, vắng và đi muộn của từng học sinh"
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label="Tỷ lệ trung bình" value={summaryStats.avgRate + '%'} icon={<Percent size={20} />} />
            <StatCard
              label="Tốt (từ 80%)"
              value={summaryStats.goodCount}
              hint="học sinh"
              tone="success"
              icon={<CheckCircle2 size={20} />}
            />
            <StatCard
              label="Cần lưu ý (60–79%)"
              value={summaryStats.warningCount}
              hint="học sinh"
              tone="warning"
              icon={<Clock size={20} />}
            />
            <StatCard
              label="Cảnh báo (dưới 60%)"
              value={summaryStats.badCount}
              hint="học sinh"
              tone="danger"
              icon={<AlertCircle size={20} />}
            />
          </div>

          <Card>
            <CardHeader
              title="Bộ lọc"
              subtitle={'Tháng ' + selectedMonth}
              icon={<CalendarDays size={18} />}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={loading}
                    onClick={fetchAnalytics}
                    icon={<RotateCw size={14} />}
                  >
                    Làm mới
                  </Button>
                  <LinkButton href="/admin/attendance" variant="ghost" size="sm">
                    Sổ điểm danh
                  </LinkButton>
                </div>
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Tháng">
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full h-11 rounded-field bg-muted border border-line px-3.5 text-sm text-foreground focus:outline-none focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </Field>
              <Field label="Lớp">
                <Select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
                  <option value="ALL">Tất cả lớp</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} — {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tìm học sinh">
                <SearchInput
                  value={searchTerm}
                  onChange={(v) => {
                    setSearchTerm(v);
                    setCurrentPage(1);
                  }}
                  placeholder="Mã hoặc tên"
                />
              </Field>
            </div>
          </Card>

          <DataTable
            columns={columns}
            rows={paginated}
            rowKey={(s) => s.studentId}
            loading={loading}
            emptyIcon={<BarChart3 size={22} />}
            emptyTitle="Chưa có dữ liệu chuyên cần"
            emptyDescription={'Không có bản ghi nào trong tháng ' + selectedMonth + '.'}
            renderMobile={(s) => (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{s.studentName}</p>
                    <p className="text-[12px] text-muted-foreground tabular">{s.studentId}</p>
                  </div>
                  <Badge tone={s.rate >= 80 ? 'success' : s.rate >= 60 ? 'warning' : 'danger'}>
                    {s.rate}%
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                  <span>
                    Có mặt <b className="text-foreground tabular">{s.presentCount}</b>
                  </span>
                  <span>
                    Đi muộn <b className="text-foreground tabular">{s.lateCount}</b>
                  </span>
                  <span>
                    Vắng phép <b className="text-foreground tabular">{s.excusedCount}</b>
                  </span>
                  <span>
                    Vắng KP <b className="text-foreground tabular">{s.unexcusedCount}</b>
                  </span>
                </div>
              </div>
            )}
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
      </div>
    </RoleGuard>
  );
}
