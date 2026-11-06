'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { useApp } from '@/context/AppContext';
import { AttendanceRecord, AttendanceStatus } from '@/types/attendance';
import {
  StatCard,
  Button,
  DataTable,
  Column,
  Sheet,
  SegmentedControl,
  TabItem,
  Field,
  Input,
  Textarea,
  Avatar,
  Badge,
  EmptyState,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { timeToMinutes, minutesTo24h } from '@/utils/date';
import { formatSlotShortLabel } from '@/utils/schedule';
import { QuickStudentModal } from '@/components/common/QuickStudentModal';
import {
  CheckCircle2,
  Clock,
  FileCheck,
  AlertTriangle,
  RotateCcw,
  Save,
  Users,
  Calendar,
} from 'lucide-react';

interface AttendanceRowItem extends AttendanceRecord {
  _index: number;
}

function AttendanceContent() {
  const { currentUser, isReady } = useApp();
  const searchParams = useSearchParams();
  const slotIdParam = searchParams.get('slotId');
  const classIdParam = searchParams.get('classId');
  const toast = useToast();

  const [slots, setSlots] = useState<any[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string>(slotIdParam || '');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [students, setStudents] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickStudentId, setQuickStudentId] = useState<string | null>(null);

  // Modal / Sheet điểm danh bù
  const [makeupSheetOpen, setMakeupSheetOpen] = useState(false);
  const [makeupTarget, setMakeupTarget] = useState<{
    index: number;
    studentId: string;
    name?: string;
  } | null>(null);
  const [makeupOriginalSlotId, setMakeupOriginalSlotId] = useState('');
  const [makeupReason, setMakeupReason] = useState('');

  // Load danh sách ca dạy của GV
  useEffect(() => {
    if (!isReady || !currentUser?.id) return;

    async function loadTeacherSlots() {
      try {
        const res = await fetch(`/api/schedule?teacherId=${currentUser?.id || ''}`);
        const data = await res.json();
        const loadedSlots = data.slots || [];
        setSlots(loadedSlots);
        if (!selectedSlotId && loadedSlots.length > 0) {
          // Ưu tiên ca thuộc lớp được chỉ định trên URL (khi bấm từ trang Lớp của tôi).
          const preferred = classIdParam
            ? loadedSlots.find((s: any) => s.classId === classIdParam)
            : null;
          setSelectedSlotId(preferred ? preferred.id : loadedSlots[0].id);
        }
      } catch (e) {
        console.error(e);
      }
    }
    loadTeacherSlots();
  }, [currentUser, isReady]);

  // Load chi tiết điểm danh của slot đang chọn
  useEffect(() => {
    if (!isReady || !currentUser?.id || !selectedSlotId) return;

    async function loadAttendance() {
      setLoading(true);
      try {
        const [attRes, stRes] = await Promise.all([
          fetch(`/api/attendance?slotId=${selectedSlotId}`),
          fetch('/api/students?limit=400'),
        ]);

        const attData = await attRes.json();
        const stData = await stRes.json();

        const stMap: Record<string, any> = {};
        if (stData.students) {
          stData.students.forEach((s: any) => {
            stMap[s.id] = s;
          });
        }
        setStudents(stMap);

        // GET /api/attendance?slotId= đã tự ghép roster đúng theo CA (bao gồm học viên
        // đổi ca nhanh trong ngày), nên dùng thẳng kết quả, không tự dựng draft từ cả lớp.
        setRecords(attData.records || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadAttendance();
  }, [selectedSlotId, slots, currentUser, isReady]);

  const handleStatusChange = (index: number, newStatus: AttendanceStatus) => {
    const updated = [...records];
    updated[index].status = newStatus;
    const slot = slots.find((s) => s.id === selectedSlotId);
    if (newStatus === 'Có mặt') {
      updated[index].checkinTime = slot ? slot.startTime : '08:00';
    } else if (newStatus === 'Đi muộn') {
      // Đi muộn: ghi mốc 30 phút sau khi ca bắt đầu, không trùng giờ vào ca.
      updated[index].checkinTime = slot ? minutesTo24h(timeToMinutes(slot.startTime) + 30) : '08:30';
    } else {
      updated[index].checkinTime = undefined;
    }
    setRecords(updated);
  };

  const handleNoteChange = (index: number, note: string) => {
    const updated = [...records];
    updated[index].note = note;
    setRecords(updated);
  };

  const openMakeupSheet = (index: number) => {
    const rec = records[index];
    const st = students[rec.studentId];
    setMakeupTarget({
      index,
      studentId: rec.studentId,
      name: st?.name || `Học viên ${rec.studentId}`,
    });
    setMakeupOriginalSlotId(rec.originalSlotId || '');
    setMakeupReason(rec.makeupReason || '');
    setMakeupSheetOpen(true);
  };

  const handleSaveMakeup = () => {
    if (!makeupTarget) return;
    const updated = [...records];
    const slot = slots.find((s) => s.id === selectedSlotId);
    updated[makeupTarget.index] = {
      ...updated[makeupTarget.index],
      status: 'Điểm danh bù',
      originalSlotId: makeupOriginalSlotId,
      makeupReason: makeupReason,
      checkinTime: slot ? slot.startTime : '08:00',
      updatedBy: currentUser?.id || '',
      updatedAt: new Date().toISOString(),
    };
    setRecords(updated);
    setMakeupSheetOpen(false);
    toast.success(`Đã cập nhật học bù cho học viên ${makeupTarget.studentId}`);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records,
          slotId: selectedSlotId,
          updatedBy: currentUser?.id || '',

          userRole: 'TEACHER',
        }),
      });
      if (res.ok) {
        toast.success('Đã lưu sổ điểm danh thành công');
      } else {
        toast.error('Lưu điểm danh không thành công');
      }
    } catch (e) {
      console.error(e);
      toast.error('Có lỗi xảy ra khi lưu sổ điểm danh');
    } finally {
      setSaving(false);
    }
  };

  const currentSlot = slots.find((s) => s.id === selectedSlotId);

  const countPresent = records.filter((r) => r.status === 'Có mặt').length;
  const countLate = records.filter((r) => r.status === 'Đi muộn').length;
  const countAbsentExcused = records.filter((r) => r.status === 'Vắng có phép').length;
  const countAbsentUnexcused = records.filter((r) => r.status === 'Vắng không phép').length;
  const countMakeup = records.filter((r) => r.status === 'Điểm danh bù').length;

  const slotTabItems: TabItem<string>[] = slots.map((s) => {
    const parts = (s.date || '').split('-');
    const shortDate = parts.slice(1).join('/');
    return {
      value: s.id,
      label: `${shortDate} • ${formatSlotShortLabel(s)} (${s.classId})`,
    };
  });

  const rowData: AttendanceRowItem[] = records.map((r, i) => ({
    ...r,
    _index: i,
  }));

  const columns: Column<AttendanceRowItem>[] = [
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
      header: 'Học viên',
      render: (r) => {
        const student = students[r.studentId];
        return (
          <div className="flex items-center gap-3 min-w-[160px]">
            <Avatar name={student?.name || r.studentId} size={36} />
            <div className="min-w-0">
              <p
                className="font-semibold text-foreground text-sm truncate cursor-pointer hover:text-primary transition-colors"
                onClick={() => setQuickStudentId(r.studentId)}
                title="Xem thông tin học sinh"
              >
                {student ? student.name : `Học viên ${r.studentId}`}
              </p>
              <p className="text-[12px] text-muted-foreground tabular">{r.studentId}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Trạng thái điểm danh',
      render: (r) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              'Có mặt',
              'Đi muộn',
              'Vắng có phép',
              'Vắng không phép',
            ] as AttendanceStatus[]
          ).map((statusOpt) => {
            const isActive = r.status === statusOpt;
            const activeStyles: Record<string, string> = {
              'Có mặt': 'bg-success text-white shadow-soft',
              'Đi muộn': 'bg-warning text-white shadow-soft',
              'Vắng có phép': 'bg-info text-white shadow-soft',
              'Vắng không phép': 'bg-danger text-white shadow-soft',
            };
            return (
              <button
                key={statusOpt}
                type="button"
                onClick={() => handleStatusChange(r._index, statusOpt)}
                className={cn(
                  'px-2.5 py-1 rounded-pill text-[12px] font-semibold transition cursor-pointer',
                  isActive
                    ? activeStyles[statusOpt]
                    : 'bg-muted text-muted-foreground hover:bg-line hover:text-foreground'
                )}
              >
                {statusOpt}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => openMakeupSheet(r._index)}
            className={cn(
              'px-2.5 py-1 rounded-pill text-[12px] font-semibold transition cursor-pointer flex items-center gap-1',
              r.status === 'Điểm danh bù'
                ? 'bg-primary text-white shadow-primary'
                : 'bg-muted text-muted-foreground hover:bg-line hover:text-foreground'
            )}
          >
            <RotateCcw size={12} />
            <span>Học bù</span>
          </button>
        </div>
      ),
    },
    {
      key: 'checkinTime',
      header: 'Giờ vào',
      className: 'w-24 text-center',
      render: (r) => (
        <span className="tabular font-mono text-[13px] text-foreground">
          {r.checkinTime || '—'}
        </span>
      ),
    },
    {
      key: 'note',
      header: 'Ghi chú',
      render: (r) => (
        <div className="space-y-1 min-w-[140px]">
          <Input
            type="text"
            value={r.note || ''}
            onChange={(e) => handleNoteChange(r._index, e.target.value)}
            placeholder="Ghi chú..."
            className="h-9 text-xs"
          />
          {r.status === 'Điểm danh bù' && (
            <p className="text-[11px] text-primary-ink font-medium">
              Bù: {r.originalSlotId || 'Chưa chọn'}
              {r.makeupReason ? ` • ${r.makeupReason}` : ''}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <Header
        title="Sổ điểm danh học viên"
        subtitle="Điểm danh chuyên cần theo từng buổi học, ca học và lớp học phụ trách"
      />

      <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
        {/* Slot selector */}
        {slots.length > 0 ? (
          <div className="bg-card border border-line rounded-card shadow-card p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-primary" />
                <span className="text-[13px] font-bold text-foreground">
                  Chọn ca giảng dạy:
                </span>
              </div>
              {currentSlot && (
                <div className="text-[12px] text-muted-foreground">
                  {currentSlot.startTime} - {currentSlot.endTime}
                </div>
              )}
            </div>
            <SegmentedControl
              items={slotTabItems}
              value={selectedSlotId}
              onChange={setSelectedSlotId}
            />
          </div>
        ) : (
          !loading && (
            <EmptyState
              icon={<Calendar size={28} />}
              title="Chưa có ca học"
              description="Bạn chưa có ca học nào được phân công trong hệ thống."
            />
          )
        )}

        {/* Summary StatCards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            label="Có mặt"
            value={countPresent}
            hint="Đúng giờ"
            icon={<CheckCircle2 size={18} />}
            tone="success"
          />
          <StatCard
            label="Đi muộn"
            value={countLate}
            hint="Vào trễ sau 30p"
            icon={<Clock size={18} />}
            tone="warning"
          />
          <StatCard
            label="Vắng có phép"
            value={countAbsentExcused}
            hint="Đã gửi đơn duyệt"
            icon={<FileCheck size={18} />}
            tone="info"
          />
          <StatCard
            label="Vắng không phép"
            value={countAbsentUnexcused}
            hint="Không thông báo"
            icon={<AlertTriangle size={18} />}
            tone="danger"
          />
          <StatCard
            label="Điểm danh bù"
            value={countMakeup}
            hint="Học bù ca trước"
            icon={<RotateCcw size={18} />}
            tone="primary"
          />
        </section>

        {/* DataTable */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-foreground">
              Danh sách học viên {currentSlot ? formatSlotShortLabel(currentSlot) : ''}{' '}
              {currentSlot ? `(${currentSlot.subject} • ${currentSlot.classId})` : ''}
            </h2>
            <Badge tone="neutral" dot>
              {records.length} học viên
            </Badge>
          </div>

          <DataTable
            columns={columns}
            rows={rowData}
            rowKey={(r) => r.id || `${r.studentId}_${r._index}`}
            loading={loading}
            emptyTitle="Chưa có học viên"
            emptyDescription="Ca học chưa có dữ liệu điểm danh hoặc danh sách học viên."
            emptyIcon={<Users size={28} />}
            renderMobile={(r) => {
              const student = students[r.studentId];
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={student?.name || r.studentId} size={36} />
                      <div className="min-w-0">
                        <p
                          className="font-semibold text-foreground text-sm truncate cursor-pointer hover:text-primary transition-colors"
                          onClick={() => setQuickStudentId(r.studentId)}
                          title="Xem thông tin học sinh"
                        >
                          {student ? student.name : `Học viên ${r.studentId}`}
                        </p>
                        <p className="text-[12px] text-muted-foreground tabular">{r.studentId}</p>
                      </div>
                    </div>
                    <Badge
                      tone={
                        r.status === 'Có mặt'
                          ? 'success'
                          : r.status === 'Đi muộn'
                          ? 'warning'
                          : r.status === 'Vắng có phép'
                          ? 'info'
                          : r.status === 'Vắng không phép'
                          ? 'danger'
                          : 'primary'
                      }
                      dot
                    >
                      {r.status}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(
                      [
                        'Có mặt',
                        'Đi muộn',
                        'Vắng có phép',
                        'Vắng không phép',
                      ] as AttendanceStatus[]
                    ).map((statusOpt) => {
                      const isActive = r.status === statusOpt;
                      const activeStyles: Record<string, string> = {
                        'Có mặt': 'bg-success text-white shadow-soft',
                        'Đi muộn': 'bg-warning text-white shadow-soft',
                        'Vắng có phép': 'bg-info text-white shadow-soft',
                        'Vắng không phép': 'bg-danger text-white shadow-soft',
                      };
                      return (
                        <button
                          key={statusOpt}
                          type="button"
                          onClick={() => handleStatusChange(r._index, statusOpt)}
                          className={cn(
                            'px-2.5 py-1 rounded-pill text-[12px] font-semibold transition cursor-pointer',
                            isActive
                              ? activeStyles[statusOpt]
                              : 'bg-muted text-muted-foreground hover:bg-line hover:text-foreground'
                          )}
                        >
                          {statusOpt}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => openMakeupSheet(r._index)}
                      className={cn(
                        'px-2.5 py-1 rounded-pill text-[12px] font-semibold transition cursor-pointer flex items-center gap-1',
                        r.status === 'Điểm danh bù'
                          ? 'bg-primary text-white shadow-primary'
                          : 'bg-muted text-muted-foreground hover:bg-line hover:text-foreground'
                      )}
                    >
                      <RotateCcw size={12} />
                      <span>Học bù</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block mb-1">Giờ vào:</span>
                      <span className="font-mono tabular text-foreground">
                        {r.checkinTime || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-1">Ghi chú:</span>
                      <Input
                        type="text"
                        value={r.note || ''}
                        onChange={(e) => handleNoteChange(r._index, e.target.value)}
                        placeholder="Ghi chú..."
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  {r.status === 'Điểm danh bù' && (
                    <div className="p-2 rounded-field bg-primary-soft/50 text-[11px] text-primary-ink">
                      Bù ca: <strong>{r.originalSlotId || 'Chưa ghi'}</strong>
                      {r.makeupReason ? ` • ${r.makeupReason}` : ''}
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>

        {/* Sticky Lưu điểm danh */}
        {records.length > 0 && (
          <div className="sticky bottom-4 z-20 bg-card/95 backdrop-blur border border-line rounded-card shadow-pop p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">{records.length}</span> học viên •{' '}
              <span className="text-success font-semibold">{countPresent}</span> có mặt •{' '}
              <span className="text-warning font-semibold">{countLate}</span> đi muộn •{' '}
              <span className="text-danger font-semibold">
                {countAbsentExcused + countAbsentUnexcused}
              </span>{' '}
              vắng
              {countMakeup > 0 && (
                <span>
                  {' '}
                  • <span className="text-primary font-semibold">{countMakeup}</span> học bù
                </span>
              )}
            </div>
            <Button
              variant="primary"
              size="md"
              loading={saving}
              disabled={loading || saving}
              onClick={handleSaveAll}
              icon={<Save size={16} />}
            >
              Lưu điểm danh
            </Button>
          </div>
        )}
      </main>

      {/* Sheet Điểm danh bù */}
      <Sheet
        isOpen={makeupSheetOpen}
        onClose={() => setMakeupSheetOpen(false)}
        title="Ghi nhận điểm danh học bù"
        description={
          makeupTarget ? `${makeupTarget.name} (${makeupTarget.studentId})` : undefined
        }
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="ghost" onClick={() => setMakeupSheetOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" onClick={handleSaveMakeup}>
              Xác nhận học bù
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field
            label="Ca học gốc / Ca cần học bù"
            hint="Mã ca học hoặc ngày mà học viên đã vắng trước đó"
          >
            <Input
              value={makeupOriginalSlotId}
              onChange={(e) => setMakeupOriginalSlotId(e.target.value)}
              placeholder="VD: SCH001 hoặc 2026-09-10 Ca 2"
            />
          </Field>
          <Field
            label="Lý do học bù"
            hint="Ghi chú nguyên nhân nghỉ buổi trước hoặc điều chuyển ca"
          >
            <Textarea
              value={makeupReason}
              onChange={(e) => setMakeupReason(e.target.value)}
              placeholder="Nhập lý do học bù..."
              rows={3}
            />
          </Field>
        </div>
      </Sheet>

      <QuickStudentModal studentId={quickStudentId} onClose={() => setQuickStudentId(null)} />
    </div>
  );
}

export default function TeacherAttendancePage() {
  return (
    <RoleGuard allowedRoles={['TEACHER', 'ADMIN']}>
      <Suspense
        fallback={
          <div className="p-6 text-sm text-muted-foreground animate-pulse">
            Đang tải sổ điểm danh...
          </div>
        }
      >
        <AttendanceContent />
      </Suspense>
    </RoleGuard>
  );
}
