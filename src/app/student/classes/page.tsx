'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { Card, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { TimeShift, TIME_SHIFTS } from '@/types/schedule';
import { getClassTimeRange } from '@/utils/schedule';
import { cn } from '@/lib/cn';
import {
  BookOpen,
  Users,
  UserCheck,
  Check,
  Plus,
  AlertCircle,
  Clock,
  Calendar,
  MapPin,
  Video,
  ExternalLink,
  RefreshCw,
  LogOut,
} from 'lucide-react';

const DAY_LABELS: Record<number, string> = {
  2: 'Thứ 2',
  3: 'Thứ 3',
  4: 'Thứ 4',
  5: 'Thứ 5',
  6: 'Thứ 6',
  7: 'Thứ 7',
  8: 'Chủ nhật',
};

interface StudentProfile {
  id: string;
  name: string;
  enrolledClassIds?: string[];
}

/** Khoảng giờ thực của một lớp, đơn vị phút từ đầu ngày. */
function toMinutes(time?: string | null): number {
  if (!time) return 0;
  const [h, m] = String(time).trim().split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  let aE = aEnd;
  let bE = bEnd;
  if (aStart > aE) aE += 1440;
  if (bStart > bE) bE += 1440;
  return Math.max(aStart, bStart) < Math.min(aE, bE);
}

function formatDays(days: number[] = []): string {
  if (days.length === 0) return 'Chưa xếp ngày';
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d] || 'Thứ ' + d)
    .join(' · ');
}

export default function StudentClassesPage() {
  const { currentUser, isReady } = useApp();
  const toast = useToast();
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [shifts, setShifts] = useState<TimeShift[]>(TIME_SHIFTS);
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [sectionsMap, setSectionsMap] = useState<Record<string, ClassSection[]>>({});
  const [currentSectionByClass, setCurrentSectionByClass] = useState<Record<string, string>>({});
  // Ca học sinh chọn khi đăng ký từng lớp mới.
  const [enrollSectionByClass, setEnrollSectionByClass] = useState<Record<string, string>>({});
  // Ca mới học sinh muốn chuyển sang, tính theo từng lớp đang học.
  const [targetSectionByClass, setTargetSectionByClass] = useState<Record<string, string>>({});
  // Thứ học sinh chọn khi đăng ký từng lớp mới (classId -> danh sách thứ 2..8).
  const [enrollDaysByClass, setEnrollDaysByClass] = useState<Record<string, number[]>>({});
  // Thứ học sinh chọn khi đổi sang ca mới (classId -> danh sách thứ 2..8).
  const [targetDaysByClass, setTargetDaysByClass] = useState<Record<string, number[]>>({});
  const [pendingChange, setPendingChange] = useState<{
    classId: string;
    className: string;
    targetSectionId: string;
    targetSectionName: string;
    conflictClassName?: string;
  } | null>(null);

  // Yêu cầu tự rời lớp (học sinh xác nhận trước khi gỡ khỏi lớp).
  const [pendingLeave, setPendingLeave] = useState<{
    classId: string;
    className: string;
    sectionId?: string;
  } | null>(null);

  const loadData = async () => {
    if (!isReady || !currentUser?.id) return;
    setLoading(true);
    try {
      const [clsRes, stRes, shiftRes] = await Promise.all([
        fetch('/api/classes'),
        fetch('/api/students?id=' + currentUser.id),
        fetch('/api/shifts'),
      ]);
      const clsData = await clsRes.json();
      const stData = await stRes.json();
      const shiftData = await shiftRes.json();

      const classList = (clsData.classes || []) as ClassEntity[];
      setClasses(classList);
      setStudent(stData.student || null);
      if (shiftData.shifts) setShifts(shiftData.shifts);

      const nextMap: Record<string, ClassSection[]> = {};
      const nextCurrent: Record<string, string> = {};
      const nextEnroll: Record<string, string> = {};
      const enrolledIds = new Set((stData.student?.enrolledClassIds || []) as string[]);
      // Lấy toàn bộ ca của mọi lớp (cả đang học lẫn đang mở) trong 1 request.
      const allIds = classList.map((c) => c.id);
      if (allIds.length > 0) {
        const secRes = await fetch('/api/classes/sections?classIds=' + allIds.join(','));
        const secData = await secRes.json();
        const secByClass = (secData.sectionsByClass || {}) as Record<string, ClassSection[]>;
        for (const cid of allIds) {
          const secs = secByClass[cid] || [];
          nextMap[cid] = secs;
          const mine = secs.find((sec) => (sec.studentIds || []).includes(currentUser.id));
          if (mine) nextCurrent[cid] = mine.id;
          // Lớp đang mở chỉ có 1 ca thì chọn sẵn để đăng ký nhanh.
          if (!enrolledIds.has(cid) && secs.length === 1) {
            nextEnroll[cid] = secs[0].id;
          }
        }
      }
      setSectionsMap(nextMap);
      setCurrentSectionByClass(nextCurrent);
      setEnrollSectionByClass(nextEnroll);
    } catch (e) {
      console.error(e);
      toast.error('Không tải được dữ liệu lớp học.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
     
  }, [currentUser, isReady]);

  const classRange = (cls: ClassEntity): { start: number; end: number } => {
    const { startTime, endTime } = getClassTimeRange(cls, shifts);
    return { start: toMinutes(startTime), end: toMinutes(endTime) };
  };

  const enrolledClasses = useMemo(
    () => classes.filter((c) => student?.enrolledClassIds?.includes(c.id)),
    [classes, student]
  );

  const openClasses = useMemo(
    () => classes.filter((c) => !student?.enrolledClassIds?.includes(c.id)),
    [classes, student]
  );

  const sectionRange = (sec: ClassSection) => {
    return { start: toMinutes(sec.startTime), end: toMinutes(sec.endTime) };
  };

  /** Ca mục tiêu có trùng giờ với lớp khác học sinh đang học không (chỉ cảnh báo, không chặn). */
  const conflictForSection = (
    cls: ClassEntity,
    sec: ClassSection
  ): { className: string; timeLabel: string } | null => {
    const target = sectionRange(sec);
    const targetDays = new Set(sec.scheduleDays?.length ? sec.scheduleDays : (cls.scheduleDays || []));

    for (const other of enrolledClasses) {
      if (other.id === cls.id) continue;
      const otherDays = new Set(other.scheduleDays || []);
      if (!Array.from(targetDays).some((d) => otherDays.has(d))) continue;

      const otherRange = classRange(other);
      if (rangesOverlap(target.start, target.end, otherRange.start, otherRange.end)) {
        return {
          className: other.name,
          timeLabel: (sec.startTime || '') + ' – ' + (sec.endTime || ''),
        };
      }
    }
    return null;
  };

  const handleEnroll = async (classId: string, className: string, sectionId?: string) => {
    if (!student || !currentUser?.id) return;
    setActionLoadingId(classId);
    try {
      const res = await fetch('/api/classes/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          sectionId,
          studentId: currentUser.id,
          action: 'ENROLL',


          scheduleDays: enrollDaysByClass[classId] || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Đã đăng ký lớp ' + className + '.');
        await loadData();
      } else {
        toast.error(data.error || 'Đăng ký lớp thất bại.');
      }
    } catch (e: any) {
      toast.error(e.message || 'Lỗi kết nối mạng.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmShiftChange = async () => {
    if (!pendingChange) return;
    const { classId, targetSectionId } = pendingChange;
    setActionLoadingId(classId);
    try {
      const res = await fetch('/api/classes/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          sectionId: currentSectionByClass[classId],
          targetSectionId,
          studentId: currentUser?.id || '',
          action: 'CHANGE_SHIFT',


          scheduleDays: targetDaysByClass[classId] || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đổi ca thành công.');
        setTargetSectionByClass((prev) => {
          const next = { ...prev };
          delete next[classId];
          return next;
        });
        setPendingChange(null);
        await loadData();
      } else {
        toast.error(data.error || 'Đổi ca thất bại.');
      }
    } catch (e: any) {
      toast.error(e.message || 'Lỗi kết nối mạng.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmLeave = async () => {
    if (!pendingLeave || !currentUser?.id) return;
    const { classId, className, sectionId } = pendingLeave;
    setActionLoadingId(classId);
    try {
      const res = await fetch('/api/classes/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          sectionId,
          studentId: currentUser.id,
          action: 'UNENROLL',


        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Đã rời lớp ' + className + '.');
        setPendingLeave(null);
        await loadData();
      } else {
        toast.error(data.error || 'Rời lớp thất bại.');
      }
    } catch (e: any) {
      toast.error(e.message || 'Lỗi kết nối mạng.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const keyword = searchTerm.trim().toLowerCase();
  const matchesKeyword = (cls: ClassEntity) =>
    !keyword ||
    [cls.name, cls.subject, cls.teacherId, formatDays(cls.scheduleDays)]
      .join(' ')
      .toLowerCase()
      .includes(keyword);

  const visibleOpenClasses = openClasses.filter(matchesKeyword);
  const visibleEnrolledClasses = enrolledClasses.filter(matchesKeyword);

  const renderClassInfo = (cls: ClassEntity, section?: ClassSection) => {
    // Lớp đang học: ưu tiên hiển thị giờ/thứ theo ca học sinh đã chọn; legacy fallback theo lớp.
    const startTime = section?.startTime || getClassTimeRange(cls, shifts).startTime;
    const endTime = section?.endTime || getClassTimeRange(cls, shifts).endTime;
    // Ưu tiên ngày học mà chính học sinh này đã chọn trong ca; không có thì lấy lịch ca, rồi lịch lớp.
    const myChosenDays = section ? (section.studentScheduleDays?.[currentUser?.id || ''] || []) : [];
    const displayDays = section
      ? (myChosenDays.length ? myChosenDays : section.scheduleDays?.length ? section.scheduleDays : cls.scheduleDays)
      : cls.scheduleDays;
    const displayTeacher = section?.teacherId || cls.teacherId;
    return (
      <div className="bg-muted rounded-field p-3.5 border border-line space-y-2 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
            <Clock size={14} className="text-primary shrink-0" /> Khung giờ
          </span>
          <span className="font-semibold text-foreground tabular">
            {startTime} – {endTime}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
            <Calendar size={14} className="text-primary shrink-0" /> Ngày học
          </span>
          <span className="font-semibold text-foreground text-right">{formatDays(displayDays)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
            <UserCheck size={14} className="text-primary shrink-0" /> Giảng viên
          </span>
          <span className="font-semibold text-foreground">{displayTeacher}</span>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-line">
          <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
            <MapPin size={14} className="text-primary shrink-0" /> Lớp học
          </span>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-foreground tabular">
              {(cls.studentIds?.length || 0)} học viên
            </span>
            {cls.meetingLink && (
              <a
                href={cls.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-primary-soft text-foreground text-[11px] font-semibold hover:bg-primary/20 transition"
                title="Vào phòng học trực tuyến"
              >
                <Video size={12} />
                <span>Vào lớp</span>
                <ExternalLink size={10} className="shrink-0" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

  /** Thứ thực tế của một ca: ưu tiên lịch ca, fallback lịch lớp. */
  const daysForSection = (cls: ClassEntity, sec: ClassSection): number[] =>
    sec.scheduleDays?.length ? sec.scheduleDays : cls.scheduleDays || [];

  const toggleDay = (
    setter: React.Dispatch<React.SetStateAction<Record<string, number[]>>>,
    classId: string,
    base: number[],
    day: number
  ) => {
    setter((prev) => {
      const cur = (prev[classId] ?? base).map(Number);
      const next = cur.includes(day)
        ? cur.filter((d) => d !== day)
        : [...cur, day].sort((a, b) => a - b);
      return { ...prev, [classId]: next };
    });
  };

  /** Trình chọn thứ học (tick/bỏ tick). selected rỗng nghĩa là theo đủ lịch ca. */
  const renderDayTicker = (
    baseDays: number[],
    selected: number[],
    onToggle: (day: number) => void
  ) => {
    const days = baseDays.length ? baseDays : [2, 3, 4, 5, 6, 7, 8];
    return (
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const on = selected.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onToggle(d)}
              className={cn(
                'px-2.5 py-1 rounded-pill text-[11px] font-semibold border transition',
                on
                  ? 'bg-primary text-white border-primary'
                  : 'bg-card text-muted-foreground border-line hover:bg-muted'
              )}
            >
              {DAY_LABELS[d] || ('Thứ ' + d)}
            </button>
          );
        })}
      </div>
    );
  };

  const renderSectionPicker = (cls: ClassEntity) => {
    const sections = sectionsMap[cls.id] || [];
    const currentSectionId = currentSectionByClass[cls.id];
    const selected = targetSectionByClass[cls.id];
    const options = sections.filter((sec) => sec.id !== currentSectionId);

    if (options.length === 0) {
      return (
        <p className="text-[12px] text-muted-foreground">
          Trung tâm chưa cấu hình ca nào khác cho lớp này.
        </p>
      );
    }

    const selectedSection = sections.find((sec) => sec.id === selected);
    const selectedBaseDays = selectedSection ? daysForSection(cls, selectedSection) : [];
    const selectedDays = targetDaysByClass[cls.id] ?? selectedBaseDays;

    return (
      <div className="space-y-2">
        <span className="text-[12px] font-semibold text-muted-foreground flex items-center gap-1">
          <RefreshCw size={12} /> Chọn ca muốn chuyển sang
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {options.map((sec) => {
            const isSelected = selected === sec.id;
            const disabled = actionLoadingId === cls.id;
            const conflict = conflictForSection(cls, sec);
            return (
              <button
                key={sec.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setTargetSectionByClass((prev) => {
                    const next = { ...prev };
                    if (next[cls.id] === sec.id) delete next[cls.id];
                    else next[cls.id] = sec.id;
                    return next;
                  });
                  setTargetDaysByClass((prev) => {
                    const next = { ...prev };
                    delete next[cls.id];
                    return next;
                  });
                }}
                title={conflict ? 'Ca này trùng giờ với lớp ' + conflict.className + ' bạn đang học' : sec.name}
                className={cn(
                  'relative px-3 py-2.5 rounded-field text-[12px] border transition text-left leading-tight cursor-pointer',
                  'disabled:opacity-45 disabled:cursor-not-allowed',
                  isSelected
                    ? 'border-primary bg-primary-soft ring-2 ring-primary/25'
                    : conflict
                    ? 'border-warning bg-warning-soft hover:bg-warning-soft/70'
                    : 'border-line bg-card hover:bg-muted'
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold text-foreground">
                    {sec.startTime} – {sec.endTime}
                  </span>
                  {isSelected && <Check size={14} className="text-primary shrink-0" />}
                </span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  {conflict ? 'Trùng giờ lớp ' + conflict.className + ' – vẫn chuyển được' : sec.name}
                </span>
              </button>
            );
          })}
        </div>
        {selectedSection && (
          <div className="space-y-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground flex items-center gap-1">
              <Calendar size={13} className="text-primary" /> Chọn thứ học (bỏ tick = không học hôm đó)
            </span>
            {renderDayTicker(selectedBaseDays, selectedDays, (day) =>
              toggleDay(setTargetDaysByClass, cls.id, selectedBaseDays, day)
            )}
          </div>
        )}
      </div>
    );
  };

  /** Bộ chọn ca khi đăng ký lớp mới: liệt kê toàn bộ ca học của lớp. */
  const renderEnrollSectionPicker = (cls: ClassEntity) => {
    const sections = sectionsMap[cls.id] || [];
    const selected = enrollSectionByClass[cls.id];

    if (sections.length === 0) {
      // Lớp cũ chưa khai báo ca: đăng ký vào ca mặc định của lớp.
      return (
        <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
          <Clock size={13} className="text-primary" />
          {cls.startTime || '—'} – {cls.endTime || '—'} · {formatDays(cls.scheduleDays)}
        </p>
      );
    }

    const selectedSection = sections.find((sec) => sec.id === selected);
    const selectedBaseDays = selectedSection ? daysForSection(cls, selectedSection) : [];
    const selectedDays = enrollDaysByClass[cls.id] ?? selectedBaseDays;

    return (
      <div className="space-y-2">
        <span className="text-[12px] font-semibold text-muted-foreground flex items-center gap-1">
          <Clock size={13} className="text-primary" /> Chọn ca học
        </span>
        <div className="grid grid-cols-1 gap-2">
          {sections.map((sec) => {
            const isSelected = selected === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                disabled={actionLoadingId === cls.id}
                onClick={() => {
                  setEnrollSectionByClass((prev) => {
                    const next = { ...prev };
                    if (next[cls.id] === sec.id) delete next[cls.id];
                    else next[cls.id] = sec.id;
                    return next;
                  });
                  setEnrollDaysByClass((prev) => {
                    const next = { ...prev };
                    delete next[cls.id];
                    return next;
                  });
                }}
                className={cn(
                  'relative px-3 py-2.5 rounded-field text-[12px] border transition text-left leading-tight cursor-pointer',
                  'disabled:opacity-45 disabled:cursor-not-allowed',
                  isSelected
                    ? 'border-primary bg-primary-soft ring-2 ring-primary/25'
                    : 'border-line bg-card hover:bg-muted'
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold text-foreground">
                    {sec.startTime || '—'} – {sec.endTime || '—'}
                  </span>
                  {isSelected && <Check size={14} className="text-primary shrink-0" />}
                </span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  {formatDays(daysForSection(cls, sec))}
                  {sec.teacherId ? ' · ' + sec.teacherId : ''}
                </span>
              </button>
            );
          })}
        </div>
        {selectedSection && (
          <div className="space-y-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground flex items-center gap-1">
              <Calendar size={13} className="text-primary" /> Chọn thứ học (bỏ tick = không học hôm đó)
            </span>
            {renderDayTicker(selectedBaseDays, selectedDays, (day) =>
              toggleDay(setEnrollDaysByClass, cls.id, selectedBaseDays, day)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <RoleGuard allowedRoles={['STUDENT', 'ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header title="Lớp học của tôi" subtitle="Xem lớp đang học, đổi ca và đăng ký lớp mới" />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <StatCard
              label="Lớp đang học"
              value={enrolledClasses.length}
              hint="Số lớp bạn đang theo"
              tone="primary"
              icon={<BookOpen size={18} />}
            />
            <StatCard
              label="Lớp đang mở"
              value={openClasses.length}
              hint="Có thể đăng ký thêm"
              tone="info"
              icon={<Users size={18} />}
            />
          </div>

          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Tìm theo môn học, tên lớp hoặc giảng viên"
          />

          {loading ? (
            <div className="space-y-4">
              <div className="h-52 rounded-card bg-muted animate-pulse border border-line" />
              <div className="h-52 rounded-card bg-muted animate-pulse border border-line" />
            </div>
          ) : (
            <>
              {/* Lớp đang học */}
              <section className="space-y-3">
                <h2 className="text-[15px] font-bold text-foreground flex items-center gap-2">
                  <BookOpen size={16} className="text-primary" /> Lớp đang học
                  <Badge tone="primary">{enrolledClasses.length}</Badge>
                </h2>

                {enrolledClasses.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={<BookOpen size={24} />}
                      title="Bạn chưa đăng ký lớp nào"
                      description="Chọn một lớp đang mở ở danh sách bên dưới để bắt đầu."
                    />
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                    {visibleEnrolledClasses.map((cls) => {
                      const sections = sectionsMap[cls.id] || [];
                      const currentSection = sections.find((sec) => sec.id === currentSectionByClass[cls.id]);
                      const selectedSection = sections.find((sec) => sec.id === targetSectionByClass[cls.id]);
                      return (
                        <Card key={cls.id} className="border-primary ring-1 ring-primary/15">
                          <div className="space-y-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge tone="info">{currentSection?.name || 'Ca học'}</Badge>
                                  <Badge tone="primary">{cls.subject}</Badge>
                                </div>
                                <h3 className="text-base font-bold text-foreground mt-2 leading-snug truncate">
                                  {cls.name}
                                </h3>
                              </div>
                              <Badge tone="primary" dot>
                                Đang học
                              </Badge>
                            </div>

                            {renderClassInfo(cls, currentSection)}

                            <div className="pt-3 border-t border-line space-y-3">
                              {renderSectionPicker(cls)}
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  variant="secondary"
                                  size="md"
                                  loading={actionLoadingId === cls.id}
                                  disabled={!selectedSection}
                                  onClick={() => {
                                    if (!selectedSection) {
                                      toast.error('Chọn ca học mới trước khi đổi.');
                                      return;
                                    }
                                    setPendingChange({
                                      classId: cls.id,
                                      className: cls.name,
                                      targetSectionId: selectedSection.id,
                                      targetSectionName:
                                        selectedSection.name ||
                                        (selectedSection.startTime || '') + ' – ' + (selectedSection.endTime || ''),
                                      conflictClassName: conflictForSection(cls, selectedSection)?.className,
                                    });
                                  }}
                                  icon={<RefreshCw size={14} />}
                                >
                                  Đổi ca
                                </Button>
                                <Button
                                  variant="danger-outline"
                                  size="md"
                                  loading={actionLoadingId === cls.id}
                                  onClick={() => {
                                    setPendingLeave({
                                      classId: cls.id,
                                      className: cls.name,
                                      sectionId: currentSectionByClass[cls.id],
                                    });
                                  }}
                                  icon={<LogOut size={14} />}
                                >
                                  Rời lớp
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                    {visibleEnrolledClasses.length === 0 && (
                      <Card>
                        <EmptyState
                          icon={<BookOpen size={24} />}
                          title="Không có lớp nào khớp từ khoá"
                          description="Thử từ khoá khác hoặc xoá tìm kiếm."
                          action={
                            <Button variant="secondary" onClick={() => setSearchTerm('')}>
                              Xoá tìm kiếm
                            </Button>
                          }
                        />
                      </Card>
                    )}
                  </div>
                )}
              </section>

              {/* Lớp đang mở */}
              <section className="space-y-3">
                <h2 className="text-[15px] font-bold text-foreground flex items-center gap-2">
                  <Plus size={16} className="text-primary" /> Lớp đang mở
                  <Badge tone="info">{openClasses.length}</Badge>
                </h2>

                {visibleOpenClasses.length === 0 ? (
                  <Card>
                    <EmptyState
                      icon={<BookOpen size={24} />}
                      title="Không có lớp nào để đăng ký"
                      description={
                        searchTerm
                          ? 'Không có lớp nào khớp từ khoá tìm kiếm.'
                          : 'Hiện chưa có lớp mới nào đang mở.'
                      }
                      action={
                        searchTerm ? (
                          <Button variant="secondary" onClick={() => setSearchTerm('')}>
                            Xoá tìm kiếm
                          </Button>
                        ) : undefined
                      }
                    />
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                    {visibleOpenClasses.map((cls) => (
                      <Card key={cls.id} className="flex flex-col justify-between">
                        <div className="space-y-3.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge tone="primary">{cls.subject}</Badge>
                              </div>
                              <h3 className="text-base font-bold text-foreground mt-2 leading-snug truncate">
                                {cls.name}
                              </h3>
                            </div>
                          </div>
                          {renderClassInfo(cls)}
                          <div className="pt-3 border-t border-line">
                            {renderEnrollSectionPicker(cls)}
                          </div>
                        </div>
                        <div className="pt-4 border-t border-line mt-4">
                          <Button
                            variant="primary"
                            size="md"
                            fullWidth
                            loading={actionLoadingId === cls.id}
                            disabled={
                              (sectionsMap[cls.id] || []).length > 0 && !enrollSectionByClass[cls.id]
                            }
                            onClick={() => handleEnroll(cls.id, cls.name, enrollSectionByClass[cls.id])}
                            icon={<Plus size={16} />}
                          >
                            {(sectionsMap[cls.id] || []).length > 0 && !enrollSectionByClass[cls.id]
                              ? 'Chọn ca để đăng ký'
                              : 'Đăng ký lớp này'}
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>

        <Sheet
          isOpen={!!pendingChange}
          onClose={() => setPendingChange(null)}
          title="Xác nhận đổi ca"
          description="Kiểm tra lại thông tin trước khi chuyển."
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setPendingChange(null)}>
                Huỷ
              </Button>
              <Button variant="primary" loading={!!actionLoadingId} onClick={handleConfirmShiftChange}>
                Xác nhận đổi ca
              </Button>
            </div>
          }
        >
          {pendingChange && (
            <div className="space-y-3 py-2 text-[13px]">
              <p className="text-foreground">
                Đổi lớp <strong className="text-primary">{pendingChange.className}</strong> sang ca mới{' '}
                <strong>{pendingChange.targetSectionName}</strong>?
              </p>
              <p className="text-[12px] text-muted-foreground flex items-start gap-1.5">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                Hệ thống sẽ chuyển bạn sang ca học mới đã chọn trong cùng lớp. Lịch học của bạn được cập nhật ngay.
              </p>
              {pendingChange.conflictClassName && (
                <p className="text-[12px] text-warning flex items-start gap-1.5">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  Ca này trùng giờ với lớp <strong>{pendingChange.conflictClassName}</strong> bạn đang học. Bạn vẫn
                  chuyển được, nhưng hai lớp sẽ chồng giờ nhau.
                </p>
              )}
            </div>
          )}
        </Sheet>

        <Sheet
          isOpen={!!pendingLeave}
          onClose={() => setPendingLeave(null)}
          title="Xác nhận rời lớp"
          description="Bạn chắc chắn muốn rời khỏi lớp học này?"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="secondary" onClick={() => setPendingLeave(null)}>
                Huỷ
              </Button>
              <Button variant="danger" loading={!!actionLoadingId} onClick={handleConfirmLeave}>
                Đồng ý rời lớp
              </Button>
            </div>
          }
        >
          {pendingLeave && (
            <div className="space-y-3 py-2 text-[13px]">
              <p className="text-foreground">
                Bạn sẽ rời khỏi lớp <strong className="text-primary">{pendingLeave.className}</strong>?
              </p>
              <p className="text-[12px] text-muted-foreground flex items-start gap-1.5">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                Sau khi rời lớp, bạn không còn thấy lớp này trong lịch học và sổ điểm danh. Lịch sử điểm danh đã ghi vẫn được giữ nguyên.
              </p>
            </div>
          )}
        </Sheet>
      </div>
    </RoleGuard>
  );
}
