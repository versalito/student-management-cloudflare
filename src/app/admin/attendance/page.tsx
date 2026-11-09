'use client';

import { getTodayDateStr } from '@/utils/date';
import { formatSlotShortLabel, formatSlotTimeLabel } from '@/utils/schedule';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/common/Header';
import { RoleGuard } from '@/components/common/RoleGuard';
import { useApp } from '@/context/AppContext';
import { QuickStudentModal } from '@/components/common/QuickStudentModal';
import { AttendanceRecord, AttendanceStatus } from '@/types/attendance';
import { ScheduleSlot } from '@/types/schedule';
import { ClassEntity } from '@/types/classroom';
import { Student } from '@/types/student';
import Link from 'next/link';
import {
  Button,
  Card,
  StatCard,
  Badge,
  AttendanceBadge,
  Field,
  Input,
  Textarea,
  Select,
  Sheet,
  SegmentedControl,
  DataTable,
  EmptyState,
  useToast,
} from '@/components/ui';
import type { Column } from '@/components/ui/DataTable';
import {
  Calendar,
  BarChart3,
  Save,
  Check,
  RotateCw,
  PlusCircle,
  UserCheck,
  ArrowRight,
  Pencil,
  Info,
  Search,
  X,
} from 'lucide-react';

interface ExtendedAttendanceRecord extends AttendanceRecord {
  studentName?: string;
  studentPhone?: string;
}

function AdminAttendanceContent() {
  const toast = useToast();
  // Chỉ để hiển thị; server luôn ghi đè `updatedBy` bằng người trong phiên.
  const { currentUser } = useApp();
  const actorId = currentUser?.id || '';
  const searchParams = useSearchParams();

  // Nhận ngữ cảnh khi được điều hướng từ Dashboard/Calendar (?classId=...&date=...)
  const classIdParam = searchParams.get('classId');
  const dateParam = searchParams.get('date');

  const [editingAttendanceStudent, setEditingAttendanceStudent] = useState<any>(null);
  const [editRemainingInput, setEditRemainingInput] = useState<number>(12);
  const [studentDetailMap, setStudentDetailMap] = useState<Record<string, any>>({});
  const [quickStudentId, setQuickStudentId] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(dateParam || getTodayDateStr());
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(classIdParam || 'ALL');
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');

  const [studentsMap, setStudentsMap] = useState<Map<string, Student>>(new Map());
  const [records, setRecords] = useState<ExtendedAttendanceRecord[]>([]);

  const [loadingSlots, setLoadingSlots] = useState<boolean>(false);
  const [loadingAttendance, setLoadingAttendance] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const [isMakeupModalOpen, setIsMakeupModalOpen] = useState<boolean>(false);
  const [makeupStudentId, setMakeupStudentId] = useState<string>('');
  const [makeupStudentSearch, setMakeupStudentSearch] = useState<string>('');
  const [makeupOriginalSlotId, setMakeupOriginalSlotId] = useState<string>('');
  const [makeupReason, setMakeupReason] = useState<string>('');
  const [makeupPastAbsences, setMakeupPastAbsences] = useState<AttendanceRecord[]>([]);
  const [loadingAbsences, setLoadingAbsences] = useState<boolean>(false);

  const [savingSessions, setSavingSessions] = useState<boolean>(false);

  // 1. Tải danh sách tất cả lớp học & toàn bộ học viên
  useEffect(() => {
    async function initData() {
      try {
        const [clsRes, stRes] = await Promise.all([
          fetch('/api/classes'),
          fetch('/api/students?limit=1000'),
        ]);
        const clsData = await clsRes.json();
        const stData = await stRes.json();

        if (clsData.classes) {
          setClasses(clsData.classes);
        }

        const map = new Map<string, Student>();
        const detailMap: Record<string, any> = {};
        if (stData.students) {
          stData.students.forEach((s: Student) => {
            map.set(s.id, s);
            detailMap[s.id] = s;
          });
        }
        setStudentsMap(map);
        setStudentDetailMap(detailMap);
      } catch (err) {
        console.error('Lỗi khi tải dữ liệu khởi tạo:', err);
        toast.error('Không tải được danh sách lớp hoặc học viên');
      }
    }
    initData();
  }, []);

  // 2. Nạp danh sách Ca học theo ngày và lớp
  useEffect(() => {
    async function loadSlots() {
      if (!selectedDate) return;
      setLoadingSlots(true);
      try {
        let url = '/api/schedule?date=' + selectedDate;
        if (selectedClassId && selectedClassId !== 'ALL') {
          url += '&classId=' + selectedClassId;
        }
        const res = await fetch(url);
        const data = await res.json();
        const loadedSlots: ScheduleSlot[] = data.slots || [];
        setSlots(loadedSlots);

        if (loadedSlots.length > 0) {
          const currentExists = loadedSlots.some((s) => s.id === selectedSlotId);
          if (!currentExists && selectedSlotId !== 'ALL') {
            setSelectedSlotId('ALL');
          }
        } else {
          setSelectedSlotId('');
          setRecords([]);
        }
      } catch (err) {
        console.error('Lỗi khi tải danh sách ca học:', err);
        toast.error('Không tải được ca học');
      } finally {
        setLoadingSlots(false);
      }
    }
    loadSlots();
  }, [selectedDate, selectedClassId]);

  // 3. Nạp sổ điểm danh cho ca đang chọn
  // 3. Nạp sổ điểm danh cho ca đang chọn hoặc tất cả các ca
  useEffect(() => {
    if (!selectedSlotId || slots.length === 0) {
      setRecords([]);
      return;
    }

    const isAllSlots = selectedSlotId === 'ALL';
    const targetSlots = isAllSlots ? slots : slots.filter((s) => s.id === selectedSlotId);
    if (targetSlots.length === 0) {
      setRecords([]);
      return;
    }

    async function loadSlotAttendance() {
      setLoadingAttendance(true);
      try {
        const slotResults = await Promise.all(
          targetSlots.map(async (slot) => {
            const res = await fetch('/api/attendance?slotId=' + slot.id);
            const data = await res.json();
            const existingRecords: AttendanceRecord[] = data.records || [];

            const allStudentIds = new Set<string>();
            existingRecords.forEach((r) => allStudentIds.add(r.studentId));

            return Array.from(allStudentIds).map((stId): ExtendedAttendanceRecord => {
              const student = studentsMap.get(stId);
              const found = existingRecords.find((r) => r.studentId === stId);

              if (found) {
                return {
                  ...found,
                  studentName: student?.name || 'Học viên ' + stId,
                  studentPhone: student?.phone || '-',
                };
              }

              return {
                id: 'ATT_NEW_' + slot.id + '_' + stId,
                scheduleSlotId: slot.id,
                classId: slot.classId,
                studentId: stId,
                date: slot.date,
                status: 'Có mặt',
                checkinTime: slot.startTime ? slot.startTime + ':00' : '08:00:00',
                updatedBy: actorId,
                updatedAt: new Date().toISOString(),
                method: 'MANUAL',
                studentName: student?.name || 'Học viên ' + stId,
                studentPhone: student?.phone || '-',
              };
            });
          })
        );

        setRecords(slotResults.flat());
      } catch (err) {
        console.error('Lỗi khi tải chi tiết điểm danh:', err);
        toast.error('Không nạp được sổ điểm danh');
      } finally {
        setLoadingAttendance(false);
      }
    }

    loadSlotAttendance();
  }, [selectedSlotId, slots, studentsMap]);

  const counts = useMemo(() => {
    let present = 0;
    let late = 0;
    let excused = 0;
    let unexcused = 0;
    let makeup = 0;

    records.forEach((r) => {
      if (r.status === 'Có mặt') present++;
      else if (r.status === 'Đi muộn') late++;
      else if (r.status === 'Vắng có phép') excused++;
      else if (r.status === 'Vắng không phép') unexcused++;
      else if (r.status === 'Điểm danh bù') makeup++;
    });

    return { present, late, excused, unexcused, makeup, total: records.length };
  }, [records]);

  const handleUpdateStudentSessionsFromAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAttendanceStudent) return;
    setSavingSessions(true);
    try {
      const res = await fetch('/api/students/' + editingAttendanceStudent.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remainingSessions: editRemainingInput }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Đã cập nhật số buổi của ' + editingAttendanceStudent.name);
        setStudentDetailMap((prev) => ({
          ...prev,
          [editingAttendanceStudent.id]: {
            ...prev[editingAttendanceStudent.id],
            remainingSessions: editRemainingInput,
          },
        }));
        setEditingAttendanceStudent(null);
      } else {
        toast.error(data.error || 'Cập nhật thất bại');
      }
    } catch (e: any) {
      toast.error(e.message || 'Lỗi mạng');
    } finally {
      setSavingSessions(false);
    }
  };

  const handleStatusChange = (index: number, newStatus: AttendanceStatus) => {
    const updated = [...records];
    const rec = updated[index];
    rec.status = newStatus;

    const currentSlot = slots.find((s) => s.id === selectedSlotId);
    const now = new Date();
    const nowTimeStr = now.toTimeString().split(' ')[0];

    if (newStatus === 'Có mặt') {
      if (!rec.checkinTime) {
        rec.checkinTime = currentSlot?.startTime ? currentSlot.startTime + ':00' : nowTimeStr;
      }
    } else if (newStatus === 'Đi muộn') {
      rec.checkinTime = nowTimeStr;
    } else if (newStatus === 'Điểm danh bù') {
      if (!rec.checkinTime) {
        rec.checkinTime = nowTimeStr;
      }
      if (!rec.originalSlotId) {
        openMakeupModalForStudent(rec.studentId);
      }
    } else {
      rec.checkinTime = undefined;
    }

    setRecords(updated);
  };

  const handleMarkAllPresent = () => {
    const currentSlot = slots.find((s) => s.id === selectedSlotId);
    const defaultTime = currentSlot?.startTime ? currentSlot.startTime + ':00' : '08:00:00';
    const updated = records.map((r) => ({
      ...r,
      status: 'Có mặt' as AttendanceStatus,
      checkinTime: r.checkinTime || defaultTime,
    }));
    setRecords(updated);
    toast.info('Đã đánh dấu ' + updated.length + ' học viên có mặt');
  };

  const handleSaveAttendance = async () => {
    if (!selectedSlotId || records.length === 0) {
      toast.error('Chưa có dữ liệu để lưu');
      return;
    }

    setSaving(true);
    try {
      const cleanedRecords: AttendanceRecord[] = records.map((r) => ({
        id: r.id.startsWith('ATT_NEW_')
          ? 'ATT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)
          : r.id,
        scheduleSlotId: r.scheduleSlotId,
        classId: r.classId,
        studentId: r.studentId,
        date: r.date,
        status: r.status,
        checkinTime: r.checkinTime || undefined,
        note: r.note || undefined,
        originalSlotId: r.originalSlotId || undefined,
        makeupReason: r.makeupReason || undefined,
        method: r.method || 'MANUAL',
        updatedBy: actorId,
        updatedAt: new Date().toISOString(),
      }));

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: cleanedRecords,
          slotId: selectedSlotId === 'ALL' ? undefined : selectedSlotId,
          userRole: 'ADMIN',
        }),
      });
      const resData = await res.json();
      if (res.ok && resData.success) {
        toast.success('Đã lưu sổ điểm danh (' + cleanedRecords.length + ' học viên)');
        setRecords((prev) =>
          prev.map((item, idx) => ({
            ...item,
            id: cleanedRecords[idx].id,
          }))
        );
      } else {
        throw new Error(resData.error || 'Lưu thất bại');
      }
    } catch (err: any) {
      console.error('Lỗi lưu sổ điểm danh:', err);
      toast.error(err.message || 'Không lưu được sổ điểm danh');
    } finally {
      setSaving(false);
    }
  };

  const openMakeupModalForStudent = async (studentId: string) => {
    setMakeupStudentId(studentId);
    setMakeupOriginalSlotId('');
    setMakeupReason('');
    setMakeupStudentSearch('');
    setIsMakeupModalOpen(true);

    if (studentId) {
      setLoadingAbsences(true);
      try {
        const res = await fetch('/api/attendance?studentId=' + studentId);
        const data = await res.json();
        const allAtt: AttendanceRecord[] = data.records || [];
        const absences = allAtt.filter(
          (a) => a.status === 'Vắng có phép' || a.status === 'Vắng không phép'
        );
        setMakeupPastAbsences(absences);
        if (absences.length > 0) {
          setMakeupOriginalSlotId(absences[0].scheduleSlotId);
        }
      } catch (e) {
        console.error('Lỗi khi nạp lịch sử vắng:', e);
      } finally {
        setLoadingAbsences(false);
      }
    }
  };

  const handleSelectStudentInModal = async (sId: string) => {
    setMakeupStudentId(sId);
    setMakeupOriginalSlotId('');
    if (!sId) {
      setMakeupPastAbsences([]);
      return;
    }

    setLoadingAbsences(true);
    try {
      const res = await fetch('/api/attendance?studentId=' + sId);
      const data = await res.json();
      const allAtt: AttendanceRecord[] = data.records || [];
      const absences = allAtt.filter(
        (a) => a.status === 'Vắng có phép' || a.status === 'Vắng không phép'
      );
      setMakeupPastAbsences(absences);
      if (absences.length > 0) {
        setMakeupOriginalSlotId(absences[0].scheduleSlotId);
      }
    } catch (e) {
      console.error('Lỗi nạp lịch sử vắng:', e);
    } finally {
      setLoadingAbsences(false);
    }
  };

  const handleConfirmMakeup = () => {
    if (!makeupStudentId) {
      toast.error('Chọn học viên cần điểm danh bù');
      return;
    }

    const currentSlot = slots.find((s) => s.id === selectedSlotId);
    if (!currentSlot) {
      toast.error('Chưa xác định được ca học hiện tại');
      return;
    }

    const student = studentsMap.get(makeupStudentId);
    const existingIndex = records.findIndex((r) => r.studentId === makeupStudentId);
    const nowTimeStr = new Date().toTimeString().split(' ')[0];

    if (existingIndex >= 0) {
      const updated = [...records];
      updated[existingIndex] = {
        ...updated[existingIndex],
        status: 'Điểm danh bù',
        originalSlotId: makeupOriginalSlotId || 'SCH_MANUAL_MAKEUP',
        makeupReason: makeupReason || 'Học bù ca vắng',
        checkinTime: updated[existingIndex].checkinTime || nowTimeStr,
        method: 'MANUAL',
      };
      setRecords(updated);
    } else {
      const newMakeupRecord: ExtendedAttendanceRecord = {
        id: 'ATT_NEW_' + selectedSlotId + '_' + makeupStudentId,
        scheduleSlotId: selectedSlotId,
        classId: currentSlot.classId,
        studentId: makeupStudentId,
        date: currentSlot.date,
        status: 'Điểm danh bù',
        originalSlotId: makeupOriginalSlotId || 'SCH_MANUAL_MAKEUP',
        makeupReason: makeupReason || 'Học bù ca vắng ngoài ca',
        checkinTime: nowTimeStr,
        updatedBy: actorId,
        updatedAt: new Date().toISOString(),
        method: 'MANUAL',
        studentName: student?.name || 'Học viên ' + makeupStudentId,
        studentPhone: student?.phone || '-',
      };
      setRecords([newMakeupRecord, ...records]);
    }

    setIsMakeupModalOpen(false);
    toast.success('Đã ghi điểm danh bù cho ' + (student?.name || makeupStudentId));
  };

  const currentSlot = slots.find((s) => s.id === selectedSlotId);

  const filteredStudentsForModal = useMemo(() => {
    const list = Array.from(studentsMap.values());
    if (!makeupStudentSearch) return list.slice(0, 30);
    const q = makeupStudentSearch.toLowerCase();
    return list
      .filter((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [studentsMap, makeupStudentSearch]);

  const columns: Column<ExtendedAttendanceRecord>[] = [
    {
      key: 'student',
      header: 'Học viên',
      render: (rec) => (
        <button
          type="button"
          onClick={() => setQuickStudentId(rec.studentId)}
          className="min-w-0 text-left cursor-pointer hover:opacity-80 transition"
          title="Xem thông tin học sinh"
        >
          <p className="font-semibold text-foreground truncate">{rec.studentName}</p>
          <p className="font-mono text-[12px] text-muted-foreground">{rec.studentId}</p>
        </button>
      ),
    },
    ...(selectedSlotId === 'ALL' || selectedClassId === 'ALL'
      ? [
          {
            key: 'slotInfo',
            header: 'Ca học / Lớp',
            hideOnMobile: true,
            render: (rec: ExtendedAttendanceRecord) => {
              const slot = slots.find((s) => s.id === rec.scheduleSlotId);
              const cls = classes.find((c) => c.id === rec.classId);
              return (
                <div className="text-[12px] min-w-[130px]">
                  <p className="font-semibold text-foreground truncate">{cls?.name || rec.classId}</p>
                  <p className="text-[11px] text-muted-foreground tabular">
                    {slot ? formatSlotTimeLabel(slot) : rec.scheduleSlotId}
                  </p>
                </div>
              );
            },
          },
        ]
      : []),
    {
      key: 'grade',
      header: 'Lớp',
      hideOnMobile: true,
      render: (rec) => {
        const d = studentDetailMap[rec.studentId] || studentsMap.get(rec.studentId);
        return <Badge>{d?.gradeLevel || '—'}</Badge>;
      },
    },
    {
      key: 'block',
      header: 'Khối',
      hideOnMobile: true,
      render: (rec) => {
        const d = studentDetailMap[rec.studentId] || studentsMap.get(rec.studentId);
        const isH = d?.examBlock === 'KHOI_H';
        return <Badge tone={isH ? 'warning' : 'neutral'}>{isH ? 'Khối H' : 'Khối V'}</Badge>;
      },
    },
    {
      key: 'university',
      header: 'Trường mục tiêu',
      hideOnMobile: true,
      render: (rec) => {
        const d = studentDetailMap[rec.studentId] || studentsMap.get(rec.studentId);
        const uni =
          d?.targetUniversity === 'KHAC'
            ? d?.customUniversity || 'Trường khác'
            : d?.targetUniversity || '—';
        return <span className="text-muted-foreground">{uni}</span>;
      },
    },
    {
      key: 'absent',
      header: 'Cần bù',
      align: 'center',
      hideOnMobile: true,
      render: (rec) => {
        const d = studentDetailMap[rec.studentId] || studentsMap.get(rec.studentId);
        const absent = d?.absentSessionsInMonth ?? 0;
        return absent > 0 ? <Badge tone="danger">{absent} buổi</Badge> : <span className="text-subtle-foreground">—</span>;
      },
    },
    {
      key: 'remaining',
      header: 'Số buổi còn',
      align: 'center',
      render: (rec) => {
        const d = studentDetailMap[rec.studentId] || studentsMap.get(rec.studentId);
        const remaining = d?.remainingSessions ?? d?.totalSessionsInMonth ?? 12;
        return (
          <Button
            size="sm"
            variant={remaining <= 0 ? 'danger' : remaining < 4 ? 'secondary' : 'ghost'}
            icon={<Pencil size={13} />}
            onClick={() => {
              setEditingAttendanceStudent(d || { id: rec.studentId, name: rec.studentName, remainingSessions: remaining });
              setEditRemainingInput(remaining);
            }}
          >
            {remaining} buổi
          </Button>
        );
      },
    },
    {
      key: 'status',
      header: 'Trạng thái buổi học',
      render: (rec) => {
        const idx = records.indexOf(rec);
        const opts: { value: AttendanceStatus; label: string; tone: string }[] = [
          { value: 'Có mặt', label: 'Có mặt', tone: 'success' },
          { value: 'Vắng không phép', label: 'Vắng', tone: 'danger' },
          { value: 'Vắng có phép', label: 'Nghỉ phép', tone: 'info' },
        ];
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {opts.map((o) => {
              const active =
                rec.status === o.value ||
                (o.value === 'Vắng có phép' && rec.status === 'Điểm danh bù');
              return (
                <Button
                  key={o.value}
                  size="sm"
                  variant={active ? 'primary' : 'secondary'}
                  className={active ? '' : 'text-muted-foreground'}
                  onClick={() => handleStatusChange(idx, o.value)}
                >
                  {o.label}
                </Button>
              );
            })}
            {rec.status === 'Điểm danh bù' && <Badge tone="primary">Bù</Badge>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <Header title="Sổ điểm danh" subtitle="Chuyên cần toàn trường và điểm danh bù" />

      <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
        <Link
          href="/admin/attendance/analytics"
          className="flex items-center justify-between gap-3 bg-card border border-line rounded-card shadow-card p-4 hover:shadow-pop transition-shadow"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-field bg-primary-soft text-primary-ink flex items-center justify-center shrink-0">
              <BarChart3 size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-foreground">Thống kê chuyên cần theo tháng</p>
              <p className="text-[12px] text-muted-foreground">Tỷ lệ tham gia và tổng hợp toàn trường</p>
            </div>
          </div>
          <ArrowRight size={18} className="text-muted-foreground shrink-0" />
        </Link>

        <Card>
          <div className="flex items-center gap-2 mb-4 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            <Calendar size={15} /> Chọn ca học
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Ngày học">
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </Field>
            <Field label="Lớp">
              <Select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
                <option value="ALL">Tất cả các lớp</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} - {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ca học">
              <Select
                value={selectedSlotId}
                onChange={(e) => setSelectedSlotId(e.target.value)}
                disabled={loadingSlots || slots.length === 0}
              >
                {slots.length === 0 ? (
                  <option value="">{loadingSlots ? 'Đang tải ca...' : 'Ngày này chưa có ca học'}</option>
                ) : (
                  <>
                    <option value="ALL">Tất cả các ca ({slots.length} ca)</option>
                    {slots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {formatSlotTimeLabel(s)} · {s.subject} ({s.classId})
                      </option>
                    ))}
                  </>
                )}
              </Select>
            </Field>
          </div>

          {selectedSlotId === 'ALL' && slots.length > 0 && (
            <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              <Badge tone="primary">Tất cả các ca</Badge>
              <span className="text-muted-foreground">
                Tổng cộng <strong className="text-foreground">{slots.length}</strong> ca học trong ngày
              </span>
            </div>
          )}

          {currentSlot && (
            <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              <Badge tone="primary">{currentSlot.id}</Badge>
              <span className="text-muted-foreground">
                Môn <strong className="text-foreground">{currentSlot.subject}</strong>
              </span>
              <span className="text-muted-foreground">
                Giờ{' '}
                <strong className="text-foreground">
                  {currentSlot.startTime} - {currentSlot.endTime}
                </strong>
              </span>
            </div>
          )}
        </Card>

        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Tổng" value={counts.total} tone="primary" />
          <StatCard label="Có mặt" value={counts.present} tone="success" />
          <StatCard label="Đi muộn" value={counts.late} tone="warning" />
          <StatCard label="Vắng có phép" value={counts.excused} tone="info" />
          <StatCard label="Vắng không phép" value={counts.unexcused} tone="danger" />
          <StatCard label="Điểm danh bù" value={counts.makeup} tone="primary" />
        </section>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<Check size={16} />}
              disabled={records.length === 0}
              onClick={handleMarkAllPresent}
            >
              Tất cả có mặt
            </Button>
            <Button
              variant="secondary"
              icon={<PlusCircle size={16} />}
              disabled={!currentSlot}
              onClick={() => openMakeupModalForStudent('')}
            >
              Điểm danh bù
            </Button>
          </div>
          <Button icon={<Save size={16} />} loading={saving} disabled={records.length === 0} onClick={handleSaveAttendance}>
            Lưu sổ điểm danh
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-bold text-foreground">
            Danh sách học viên
            {selectedSlotId === 'ALL' ? (
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                Tất cả các ca ({slots.length} ca học)
              </span>
            ) : currentSlot ? (
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                {formatSlotShortLabel(currentSlot)} · {currentSlot.classId}
              </span>
            ) : null}
          </h2>
          <Badge tone="neutral">{records.length} học viên</Badge>
        </div>

        {!selectedSlotId && !loadingAttendance ? (
          <Card>
            <EmptyState
              icon={<UserCheck size={24} />}
              title="Chưa chọn ca học"
              description="Chọn ngày và ca học ở trên để mở sổ điểm danh."
            />
          </Card>
        ) : (
          <DataTable
            columns={columns}
            rows={records}
            rowKey={(rec, i) => rec.id || String(i)}
            loading={loadingAttendance}
            emptyIcon={<UserCheck size={24} />}
            emptyTitle="Ca học chưa có học viên"
            emptyDescription="Lớp này chưa có học viên trong danh sách."
            renderMobile={(rec) => {
              const d = studentDetailMap[rec.studentId] || studentsMap.get(rec.studentId);
              const remaining = d?.remainingSessions ?? d?.totalSessionsInMonth ?? 12;
              const idx = records.indexOf(rec);
              return (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setQuickStudentId(rec.studentId)}
                        className="font-semibold text-foreground truncate text-left cursor-pointer hover:opacity-80 transition"
                        title="Xem thông tin học sinh"
                      >
                        {rec.studentName}
                      </button>
                      <p className="font-mono text-[12px] text-muted-foreground">
                        {rec.studentId} · {d?.gradeLevel || '—'}
                      </p>
                    </div>
                    <AttendanceBadge status={rec.status} />
                  </div>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">Còn lại</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Pencil size={13} />}
                      onClick={() => {
                        setEditingAttendanceStudent(
                          d || { id: rec.studentId, name: rec.studentName, remainingSessions: remaining }
                        );
                        setEditRemainingInput(remaining);
                      }}
                    >
                      {remaining} buổi
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { v: 'Có mặt', l: 'Có mặt' },
                        { v: 'Vắng không phép', l: 'Vắng' },
                        { v: 'Vắng có phép', l: 'Nghỉ phép' },
                      ] as { v: AttendanceStatus; l: string }[]
                    ).map((o) => {
                      const active =
                        rec.status === o.v || (o.v === 'Vắng có phép' && rec.status === 'Điểm danh bù');
                      return (
                        <Button
                          key={o.v}
                          size="sm"
                          fullWidth
                          variant={active ? 'primary' : 'secondary'}
                          onClick={() => handleStatusChange(idx, o.v)}
                        >
                          {o.l}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />
        )}
      </main>

      <Sheet
        isOpen={Boolean(editingAttendanceStudent)}
        onClose={() => setEditingAttendanceStudent(null)}
        title="Điều chỉnh số buổi còn lại"
        description={
          editingAttendanceStudent
            ? editingAttendanceStudent.name + ' (' + editingAttendanceStudent.id + ')'
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingAttendanceStudent(null)}>
              Huỷ
            </Button>
            <Button type="submit" form="sessions-form" loading={savingSessions}>
              Cập nhật
            </Button>
          </>
        }
      >
        <form id="sessions-form" onSubmit={handleUpdateStudentSessionsFromAttendance} className="space-y-4">
          <Field label="Số buổi còn lại" hint="Lưu trực tiếp vào hồ sơ học viên.">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => setEditRemainingInput((p) => Math.max(0, p - 1))}
              >
                −
              </Button>
              <Input
                type="number"
                min={0}
                max={100}
                required
                value={editRemainingInput}
                onChange={(e) => setEditRemainingInput(parseInt(e.target.value) || 0)}
                className="text-center font-semibold tabular"
              />
              <Button
                variant="secondary"
                size="icon"
                className="h-11 w-11 shrink-0"
                onClick={() => setEditRemainingInput((p) => p + 1)}
              >
                +
              </Button>
            </div>
          </Field>
        </form>
      </Sheet>

      <Sheet
        isOpen={isMakeupModalOpen}
        onClose={() => setIsMakeupModalOpen(false)}
        title="Ghi điểm danh bù"
        description="Chọn học viên, ca bị vắng và lý do học bù."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsMakeupModalOpen(false)}>
              Huỷ
            </Button>
            <Button disabled={!makeupStudentId} onClick={handleConfirmMakeup}>
              Xác nhận
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Học viên" required>
            <div className="relative mb-2">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none" />
              <input
                value={makeupStudentSearch}
                onChange={(e) => setMakeupStudentSearch(e.target.value)}
                placeholder="Tìm mã hoặc tên học viên"
                className="w-full h-11 pl-10 pr-4 rounded-field bg-muted border border-line text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <Select value={makeupStudentId} onChange={(e) => handleSelectStudentInModal(e.target.value)}>
              <option value="">Chọn học viên</option>
              {filteredStudentsForModal.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} - {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Ca học gốc bị vắng">
            {loadingAbsences ? (
              <p className="text-[13px] text-muted-foreground">Đang tải lịch sử vắng...</p>
            ) : makeupPastAbsences.length > 0 ? (
              <Select value={makeupOriginalSlotId} onChange={(e) => setMakeupOriginalSlotId(e.target.value)}>
                <option value="">Chọn ca đã vắng</option>
                {makeupPastAbsences.map((a) => (
                  <option key={a.id} value={a.scheduleSlotId}>
                    [{a.date}] {a.scheduleSlotId} - {a.classId} ({a.status})
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={makeupOriginalSlotId}
                onChange={(e) => setMakeupOriginalSlotId(e.target.value)}
                placeholder="VD: SCH0012"
              />
            )}
          </Field>

          <Field label="Lý do học bù">
            <Textarea
              rows={2}
              value={makeupReason}
              onChange={(e) => setMakeupReason(e.target.value)}
              placeholder="VD: Ốm có đơn phép, trùng lịch thi"
            />
          </Field>

          <div className="rounded-field bg-primary-soft px-4 py-3 flex items-start gap-2">
            <Info size={16} className="text-primary-ink shrink-0 mt-0.5" />
            <p className="text-[13px] text-primary-ink">
              Ca tiếp nhận: <strong>{currentSlot?.id}</strong> · lớp {currentSlot?.classId} · ngày{' '}
              {currentSlot?.date}
            </p>
          </div>
        </div>
      </Sheet>

      <QuickStudentModal studentId={quickStudentId} onClose={() => setQuickStudentId(null)} />
    </div>
  );
}

export default function AdminAttendancePage() {
  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <Suspense
        fallback={
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RotateCw size={16} className="animate-spin" /> Đang tải sổ điểm danh...
          </div>
        }
      >
        <AdminAttendanceContent />
      </Suspense>
    </RoleGuard>
  );
}
