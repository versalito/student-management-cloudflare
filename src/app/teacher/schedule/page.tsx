'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { ScheduleSlot, TimeShift, TIME_SHIFTS } from '@/types/schedule';
import { ClassEntity, ClassSection } from '@/types/classroom';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { QuickClassModal } from '@/components/common/QuickClassModal';
import { getTodayDateStr, getTodayDateStrByDate, formatTimeHM, minutesTo24h } from '@/utils/date';
import { formatClassTimeLabel } from '@/utils/schedule';
import {
  computeTimelineBounds,
  buildTicksBetween,
  layoutDaySlots,
  TimelineNowMarker,
} from '@/components/schedule/Timeline';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  BookOpen,
  Plus,
  Video,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const DAY_LABELS: Record<number, string> = {
  2: 'Thứ 2',
  3: 'Thứ 3',
  4: 'Thứ 4',
  5: 'Thứ 5',
  6: 'Thứ 6',
  7: 'Thứ 7',
  8: 'Chủ nhật',
};

const WEEK_DAYS = 7;

/** Từ chuỗi date YYYY-MM-DD -> số thứ trong tuần (2=T2 ... 8=CN) */
function dayOfWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00+07:00');
  const g = d.getDay(); // 0=CN, 1=T2 .. 6=T7
  return g === 0 ? 8 : g + 1;
}

/** Format hiển thị ngày: Thứ N (DD/MM) */
function formatDayLabel(dateStr: string): string {
  const day = dayOfWeekNumber(dateStr);
  const [, m, dd] = dateStr.split('-');
  return `${DAY_LABELS[day]} (${dd}/${m})`;
}

/** Từ chuỗi date YYYY-MM-DD -> Date tại 00:00 theo Asia/Saigon */
function toSaigonDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+07:00');
}

/** Tìm ngày Thứ Hai (đầu tuần) */
function getMonday(dateStr: string): Date {
  const d = toSaigonDate(dateStr);
  const g = d.getDay(); // 0=CN, 1=T2 .. 6=T7
  const offset = g === 0 ? -6 : 1 - g;
  d.setDate(d.getDate() + offset);
  return d;
}

/** Danh sách 7 ngày (Thứ 2 -> CN) của tuần chứa ngày tham chiếu */
function getWeekDates(refDateStr: string): string[] {
  const monday = getMonday(refDateStr);
  const dates: string[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(getTodayDateStrByDate(d));
  }
  return dates;
}

/** Format khoảng ngày tuần: DD/MM – DD/MM */
function formatWeekRange(weekDates: string[]): string {
  if (weekDates.length === 0) return '';
  const first = weekDates[0];
  const last = weekDates[weekDates.length - 1];
  const [, fm, fdd] = first.split('-');
  const [, lm, ldd] = last.split('-');
  return `${fdd}/${fm} – ${ldd}/${lm}`;
}

/** Ca giả cho lớp cũ chưa có ca học (class_sections): nhận lớp theo cơ chế cũ. */
function legacySectionFromClass(cls: ClassEntity): ClassSection {
  return {
    id: 'LEGACY_' + cls.id,
    classId: cls.id,
    name: '',
    shiftId: cls.shiftId,
    startTime: cls.startTime,
    endTime: cls.endTime,
    scheduleDays: cls.scheduleDays || [],
    teacherId: cls.teacherId,
    isActive: true,
  };
}

export default function TeacherSchedulePage() {
  const { currentUser, isReady } = useApp();
  const toast = useToast();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [allClasses, setAllClasses] = useState<ClassEntity[]>([]);
  const [allSections, setAllSections] = useState<ClassSection[]>([]);
  const [shifts, setShifts] = useState<TimeShift[]>(TIME_SHIFTS);
  const [loading, setLoading] = useState(true);
  const [claimingSectionId, setClaimingSectionId] = useState<string | null>(null);

  // Điều hướng tuần & ngày được chọn
  const [weekRefDate, setWeekRefDate] = useState(getTodayDateStr());
  const [selectedDate, setSelectedDate] = useState(getTodayDateStr());

  const loadData = async () => {
    if (!isReady || !currentUser?.id) return;
    setLoading(true);
    try {
      const [slotRes, clsRes, shiftRes, secRes] = await Promise.all([
        fetch(`/api/schedule?teacherId=${currentUser?.id || ''}`),
        fetch('/api/classes'),
        fetch('/api/shifts'),
        fetch('/api/classes/sections?all=true'),
      ]);
      const slotData = await slotRes.json();
      const clsData = await clsRes.json();
      const shiftData = await shiftRes.json();
      const secData = await secRes.json();

      setSlots(slotData.slots || []);
      setAllClasses(clsData.classes || []);
      setAllSections((secData.sections || []) as ClassSection[]);
      if (shiftData.shifts) setShifts(shiftData.shifts);
    } catch (e) {
      console.error(e);
      toast.error('Không thể tải dữ liệu lịch dạy.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser, isReady]);

  const handleClaimSection = async (section: ClassSection, cls: ClassEntity) => {
    if (!currentUser?.id) return;
    setClaimingSectionId(section.id);
    try {
      const isLegacy = section.id.startsWith('LEGACY_');
      const res = isLegacy
        ? await fetch('/api/classes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              classId: cls.id,
              teacherId: currentUser.id,

            }),
          })
        : await fetch('/api/classes/sections', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sectionId: section.id,
              teacherId: currentUser.id,
              syncFutureSlots: true,

            }),
          });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('Đã nhận ca dạy thành công cho ' + cls.name + '.');
        await loadData();
      } else {
        toast.error(data.error || 'Nhận ca dạy thất bại.');
      }
    } catch (e: any) {
      toast.error(e.message || 'Lỗi kết nối khi nhận ca dạy.');
    } finally {
      setClaimingSectionId(null);
    }
  };

  // Modal xem thông tin lớp học
  const [selectedClassForModal, setSelectedClassForModal] = useState<{ classId: string; slot?: ScheduleSlot } | null>(null);
  const classMap = useMemo(() => new Map(allClasses.map((c) => [c.id, c])), [allClasses]);

  // Tuần hiện tại
  const weekDates = useMemo(() => getWeekDates(weekRefDate), [weekRefDate]);
  const weekDateSet = useMemo(() => new Set(weekDates), [weekDates]);

  // Các ca dạy trong tuần
  const weekSlots = useMemo(
    () =>
      slots
        .filter((s) => weekDateSet.has(s.date) && s.status !== 'Đã hủy')
        .sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
        }),
    [slots, weekDateSet]
  );

  // Ca mở chưa có GV phân công: dựa theo ca học (section) của lớp.
  const openSections = useMemo(() => {
    const map = new Map(allClasses.map((c) => [c.id, c]));
    const list: { section: ClassSection; cls: ClassEntity }[] = [];
    const sectionClassIds = new Set(allSections.map((s) => s.classId));
    for (const sec of allSections) {
      if (sec.isActive === false) continue;
      const cls = map.get(sec.classId);
      if (!cls) continue;
      if (!sec.teacherId || sec.teacherId === 'CHUA_PHAN_CONG' || sec.teacherId === '') {
        list.push({ section: sec, cls });
      }
    }
    // Lớp cũ chưa có ca (class_sections) nào: vẫn giữ cơ chế nhận lớp theo lớp.
    for (const cls of allClasses) {
      if (sectionClassIds.has(cls.id)) continue;
      if (!cls.teacherId || cls.teacherId === 'CHUA_PHAN_CONG' || cls.teacherId === '') {
        list.push({ section: legacySectionFromClass(cls), cls });
      }
    }
    return list;
  }, [allSections, allClasses]);

  const goPrevWeek = () => {
    const d = toSaigonDate(weekRefDate);
    d.setDate(d.getDate() - 7);
    const prevDate = getTodayDateStrByDate(d);
    setWeekRefDate(prevDate);
    setSelectedDate(prevDate);
  };

  const goNextWeek = () => {
    const d = toSaigonDate(weekRefDate);
    d.setDate(d.getDate() + 7);
    const nextDate = getTodayDateStrByDate(d);
    setWeekRefDate(nextDate);
    setSelectedDate(nextDate);
  };

  const goThisWeek = () => {
    const today = getTodayDateStr();
    setWeekRefDate(today);
    setSelectedDate(today);
  };

  // Trục giờ co giãn vừa đủ cho các ca dạy trong tuần, không còn 06:00 – 23:00 trống trải
  const weekBounds = useMemo(() => computeTimelineBounds(weekSlots), [weekSlots]);
  const ticks = useMemo(
    () => buildTicksBetween(weekBounds.startMinutes, weekBounds.endMinutes, 30),
    [weekBounds.startMinutes, weekBounds.endMinutes]
  );
  // Nhãn giờ hiển thị mỗi 60 phút để cột mốc không bị rối
  const hourTicks = useMemo(
    () => buildTicksBetween(weekBounds.startMinutes, weekBounds.endMinutes, 60),
    [weekBounds.startMinutes, weekBounds.endMinutes]
  );
  const PX_PER_MINUTE = 1;
  const WEEK_ROW_HEIGHT_PX = (weekBounds.endMinutes - weekBounds.startMinutes) * PX_PER_MINUTE;
  const minuteToTopPx = (minutes: number): number =>
    (Math.min(Math.max(minutes, weekBounds.startMinutes), weekBounds.endMinutes) - weekBounds.startMinutes) *
    PX_PER_MINUTE;

  // Chi tiết ngày đang chọn: dùng chung cách xếp cột với trang Admin
  const dayDetail = useMemo(() => {
    // Ca đã hủy không còn là ca dạy: nếu giữ lại, khung chi tiết hiện một khối
    // trống không có nhãn "Đã hủy" (trang giáo viên không có nhãn đó).
    const daySlots = slots.filter((s) => s.date === selectedDate && s.status !== 'Đã hủy');
    return { slots: daySlots, laidOut: layoutDaySlots(daySlots) };
  }, [slots, selectedDate]);

  // Trục giờ cho khung chi tiết ngày, co giãn theo ca thực tế của ngày đó
  const dayDetailBounds = useMemo(() => computeTimelineBounds(dayDetail.slots), [dayDetail.slots]);
  // Đếm số ca bị trùng giờ trong tuần để nhắc giáo viên xử lý sớm
  const weekConflictCount = useMemo(() => {
    const dates = Array.from(new Set(weekSlots.map((s) => s.date)));
    let count = 0;
    for (const d of dates) {
      const laid = layoutDaySlots(weekSlots.filter((s) => s.date === d));
      count += laid.filter((item) => item.overlap === 'conflict').length;
    }
    return count;
  }, [weekSlots]);
  const dayDetailHourTicks = useMemo(
    () => buildTicksBetween(dayDetailBounds.startMinutes, dayDetailBounds.endMinutes, 60),
    [dayDetailBounds.startMinutes, dayDetailBounds.endMinutes]
  );
  const DAY_DETAIL_PX_PER_MINUTE = 1.15;
  const dayDetailHeight = (dayDetailBounds.endMinutes - dayDetailBounds.startMinutes) * DAY_DETAIL_PX_PER_MINUTE;
  const dayDetailBoundsLabel = `${minutesTo24h(dayDetailBounds.startMinutes)} – ${minutesTo24h(dayDetailBounds.endMinutes)}`;
  const weekBoundsLabel = `${minutesTo24h(weekBounds.startMinutes)} – ${minutesTo24h(weekBounds.endMinutes)}`;

  const todayStr = getTodayDateStr();

  return (
    <RoleGuard allowedRoles={['TEACHER', 'ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Lịch dạy giảng viên"
          subtitle={`Giáo viên ${currentUser?.name || ''} (${currentUser?.id || ''}) • Thời khóa biểu tuần`}
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Hàng thống kê tổng quan */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <StatCard
              label="Tổng buổi phân công"
              value={slots.length}
              hint="Buổi dạy trong toàn kỳ"
              icon={<Calendar size={18} />}
              tone="primary"
            />
            <StatCard
              label="Buổi trong tuần này"
              value={weekSlots.length}
              hint={formatWeekRange(weekDates)}
              icon={<Clock size={18} />}
              tone="info"
            />
            <StatCard
              label="Ca mở cần giảng viên"
              value={openSections.length}
              hint="Ca trống có thể nhận dạy"
              icon={<Sparkles size={18} />}
              tone="warning"
            />
          </div>

          {/* Thanh điều hướng tuần */}
          <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-muted rounded-pill p-1 border border-line">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-foreground"
                  onClick={goPrevWeek}
                  aria-label="Tuần trước"
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-foreground"
                  onClick={goNextWeek}
                  aria-label="Tuần sau"
                >
                  <ChevronRight size={16} />
                </Button>
              </div>

              <Button
                size="sm"
                variant="secondary"
                onClick={goThisWeek}
                icon={<Calendar size={14} />}
              >
                Tuần này
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">
                Tuần {formatWeekRange(weekDates)}
              </span>
              <Badge tone="primary" className="tabular">
                {weekSlots.length} ca
              </Badge>
              <LinkButton href="/teacher/classes" size="sm" variant="ghost" icon={<BookOpen size={14} />}>
                Danh mục lớp
              </LinkButton>
            </div>
          </Card>

          {/* Dải 7 ngày trong tuần (Day strip) */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2 p-1.5 bg-muted rounded-card border border-line">
            {weekDates.map((d) => {
              const isToday = d === todayStr;
              const isSelected = d === selectedDate;
              const dayNum = dayOfWeekNumber(d);
              const [, mm, dd] = d.split('-');
              // Dải ngày phải đếm giống lưới bên dưới (đã bỏ ca "Đã hủy"),
              // nếu không Thứ 3 hiện "2 ca" trong khi lưới chỉ vẽ 1.
              const daySlotCount = weekSlots.filter((s) => s.date === d).length;

              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={cn(
                    'flex flex-col items-center justify-center py-2 px-1 rounded-field text-center transition-all cursor-pointer',
                    isToday
                      ? 'bg-primary text-white shadow-primary'
                      : isSelected
                      ? 'bg-card text-foreground border border-primary/40 shadow-soft'
                      : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider opacity-90">
                    {DAY_LABELS[dayNum]}
                  </span>
                  <span className="text-sm sm:text-base font-extrabold tabular leading-tight mt-0.5">
                    {dd}/{mm}
                  </span>
                  {daySlotCount > 0 ? (
                    <span
                      className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded-pill mt-1 tabular',
                        isToday ? 'bg-white/20 text-white' : 'bg-primary-soft text-primary-ink'
                      )}
                    >
                      {daySlotCount} ca
                    </span>
                  ) : (
                    <span className="text-[10px] opacity-40 mt-1">–</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Lưới tuần hiển thị thời khóa biểu */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-foreground">
                Lịch giảng dạy chi tiết trong tuần
              </h2>
              <span className="text-[12px] text-muted-foreground">
                {selectedDate ? `Đang chọn ${formatDayLabel(selectedDate)}` : `Khung giờ ${weekBoundsLabel}`}
              </span>
            </div>

            {weekConflictCount > 0 && (
              <div className="flex items-start gap-2 rounded-field border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-foreground">
                <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                <span>
                  Có <strong>{weekConflictCount}</strong> ca trong tuần bị trùng giờ. Khối viền vàng là phần chồng lấn, Thầy/Cô nên báo quản trị viên đổi ca.
                </span>
              </div>
            )}

            {loading ? (
              <div className="bg-card border border-line rounded-card shadow-card p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-field bg-muted animate-pulse" />
                ))}
              </div>
            ) : weekSlots.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Calendar size={28} />}
                  title="Tuần này chưa có lịch dạy"
                  description="Thầy/Cô không có ca dạy nào trong tuần được chọn. Có thể nhận thêm các ca mở bên dưới."
                />
              </Card>
            ) : (
              <div className="bg-card rounded-card border border-line shadow-card overflow-x-auto">
                <div className="min-w-[960px]">
                  {/* Hàng tiêu đề 7 cột ngày */}
                  <div className="flex border-b border-line bg-muted/40">
                    <div className="w-14 shrink-0 border-r border-line py-3 px-1 text-center text-[10px] font-bold text-muted-foreground uppercase">
                      Giờ
                    </div>
                    {weekDates.map((d) => {
                      const isToday = d === todayStr;
                      const isSelected = d === selectedDate;
                      const dayNum = dayOfWeekNumber(d);
                      const [, mm, dd] = d.split('-');
                      const daySlots = weekSlots.filter((s) => s.date === d);

                      return (
                        <div
                          key={d}
                          onClick={() => setSelectedDate(d)}
                          className={cn(
                            'flex-1 min-w-[125px] text-center py-2.5 px-2 border-r border-line last:border-r-0 cursor-pointer transition-colors',
                            isToday || isSelected ? 'bg-primary-soft/50' : 'hover:bg-muted/60'
                          )}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span
                              className={cn(
                                'text-[13px] font-bold',
                                isToday ? 'text-primary' : 'text-foreground'
                              )}
                            >
                              {DAY_LABELS[dayNum]}
                            </span>
                            {isToday && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground tabular mt-0.5">
                            {dd}/{mm} • {daySlots.length} ca
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Thân lưới: trục giờ dọc + 7 cột */}
                  <div className="flex">
                    {/* Cột nhãn giờ bên trái */}
                    <div className="w-14 shrink-0 border-r border-line bg-muted/20 relative">
                      <div className="relative" style={{ height: `${WEEK_ROW_HEIGHT_PX}px` }}>
                        {hourTicks.map((t) => (
                          <div
                            key={t.minutes}
                            className="absolute right-1.5 text-[10px] font-mono font-medium text-subtle-foreground whitespace-nowrap -translate-y-1/2"
                            style={{ top: minuteToTopPx(t.minutes) }}
                          >
                            {t.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 7 cột ngày */}
                    {weekDates.map((d) => {
                      const isToday = d === todayStr;
                      const isSelected = d === selectedDate;
                      const daySlots = weekSlots.filter((s) => s.date === d);

                      return (
                        <div
                          key={d}
                          className={cn(
                            'flex-1 min-w-[125px] border-r border-line last:border-r-0 relative transition-colors',
                            isToday || isSelected ? 'bg-primary-soft/30' : ''
                          )}
                        >
                          {/* Lưới giờ ngang */}
                          <div className="absolute inset-0 pointer-events-none">
                            {ticks.map((t) => (
                              <div
                                key={t.minutes}
                                className={cn(
                                  'absolute left-0 right-0 h-px',
                                  t.minutes % 60 === 0 ? 'bg-line' : 'bg-line/40'
                                )}
                                style={{ top: minuteToTopPx(t.minutes) }}
                              />
                            ))}
                          </div>

                          {/* Các slot trong ngày */}
                          <div className="relative" style={{ height: `${WEEK_ROW_HEIGHT_PX}px` }}>
                            {isToday && (
                              <TimelineNowMarker
                                startMinutes={weekBounds.startMinutes}
                                endMinutes={weekBounds.endMinutes}
                                pixelsPerMinute={PX_PER_MINUTE}
                              />
                            )}

                            {layoutDaySlots(daySlots).map(({ slot, startMin, endMin, isOvernight, column, columnCount, overlap }) => {
                              const cls = classMap.get(slot.classId);
                              const studentCount = cls?.studentCount ?? cls?.studentIds?.length ?? 0;
                              const meetingLink = slot.meetingLink || cls?.meetingLink;
                              const topPx = minuteToTopPx(startMin);
                              const heightPx = Math.max(minuteToTopPx(endMin) - topPx, 34);
                              const widthPct = 100 / columnCount;

                              return (
                                <div
                                  key={slot.id}
                                  className={cn(
                                    'absolute rounded-field p-2 shadow-soft hover:shadow-card transition-all overflow-hidden flex flex-col justify-between border',
                                    'bg-primary-soft text-primary-ink border-primary/30',
                                    overlap === 'conflict' && 'ring-2 ring-warning border-warning'
                                  )}
                                  style={{
                                    top: `${topPx}px`,
                                    height: `${heightPx}px`,
                                    left: `calc(${column * widthPct}% + 4px)`,
                                    width: `calc(${widthPct}% - 8px)`,
                                  }}
                                >
                                  <div>
                                    <div className="flex items-center justify-between gap-1 flex-wrap">
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-card text-foreground border border-line tabular">
                                          {slot.classId}
                                        </span>
                                        {slot.status === 'Đã hoàn thành' ? (
                                          <Badge tone="success" className="text-[9px] py-0 px-1.5">
                                            Hoàn thành
                                          </Badge>
                                        ) : (
                                          <Badge tone="primary" className="text-[9px] py-0 px-1.5">
                                            {slot.status}
                                          </Badge>
                                        )}
                                        {isOvernight && (
                                          <Badge tone="warning" className="text-[9px] py-0 px-1.5">
                                            qua đêm
                                          </Badge>
                                        )}
                                        {overlap === 'conflict' && (
                                          <Badge tone="warning" className="text-[9px] py-0 px-1.5">
                                            Trùng giờ
                                          </Badge>
                                        )}
                                        {overlap === 'parallel' && (
                                          <Badge tone="info" className="text-[9px] py-0 px-1.5">
                                            Song song
                                          </Badge>
                                        )}
                                        {slot.checkinTime && (
                                          <Badge
                                            tone={slot.checkinStatus === 'Đi muộn' ? 'warning' : 'success'}
                                            className="text-[9px] py-0 px-1.5"
                                          >
                                            Vào {slot.checkinTime}
                                          </Badge>
                                        )}
                                      </div>
                                      <span className="text-[10px] font-mono font-bold text-primary-ink whitespace-nowrap">
                                        {formatTimeHM(slot.startTime)} – {formatTimeHM(slot.endTime)}
                                      </span>
                                    </div>

                                    <h4
                                      onClick={() => setSelectedClassForModal({ classId: slot.classId, slot })}
                                      className="font-bold text-foreground text-xs leading-snug mt-1 line-clamp-2 cursor-pointer hover:text-primary hover:underline transition"
                                      title="Bấm để xem thông tin lớp học"
                                    >
                                      {cls?.name || slot.subject}
                                    </h4>

                                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                                      <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-foreground">
                                        <Users size={11} className="text-primary" />
                                        {studentCount} học viên
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-1 pt-1 border-t border-primary/20 flex items-center justify-between gap-1 flex-wrap">
                                    {meetingLink ? (
                                      <a
                                        href={meetingLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-semibold"
                                      >
                                        <Video size={11} />
                                        <span>Phòng online</span>
                                        <ExternalLink size={9} />
                                      </a>
                                    ) : (
                                      <span className="text-[10px] text-muted-foreground italic">
                                        Trực tiếp
                                      </span>
                                    )}

                                    <Link
                                      href={`/teacher/attendance?classId=${slot.classId}&slotId=${slot.id}`}
                                      className="inline-flex items-center gap-1 py-0.5 px-2 rounded-pill bg-primary text-white text-[10px] font-bold shadow-soft hover:bg-primary-hover transition"
                                    >
                                      <CheckCircle2 size={10} /> Điểm danh
                                    </Link>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Chi tiết ngày đang chọn: lưới 1 ngày, khối ca đúng tỉ lệ thời lượng */}
            <div className="bg-card rounded-card border border-line shadow-card p-3 sm:p-4 overflow-x-auto">
              <div className="flex items-center justify-between gap-2 mb-3 min-w-[560px]">
                <h3 className="text-[14px] font-bold text-foreground">
                  Chi tiết {formatDayLabel(selectedDate)}
                </h3>
                <span className="text-[12px] text-muted-foreground tabular">
                  {dayDetail.slots.length} ca • {dayDetailBoundsLabel}
                </span>
              </div>

              {dayDetail.slots.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-6 text-center">
                  Ngày này chưa có ca dạy nào.
                </p>
              ) : (
                <div className="flex min-w-[560px]">
                  <div className="w-12 shrink-0 border-r border-line bg-muted/20 relative" style={{ height: `${dayDetailHeight}px` }}>
                    {dayDetailHourTicks.map((t) => (
                      <div
                        key={t.minutes}
                        className="absolute right-1.5 text-[10px] font-mono font-medium text-subtle-foreground whitespace-nowrap -translate-y-1/2 tabular"
                        style={{ top: `${(t.minutes - dayDetailBounds.startMinutes) * DAY_DETAIL_PX_PER_MINUTE}px` }}
                      >
                        {t.label}
                      </div>
                    ))}
                  </div>

                  <div className="flex-1 relative" style={{ height: `${dayDetailHeight}px` }}>
                    <div className="absolute inset-0 pointer-events-none">
                      {dayDetailHourTicks.map((t) => (
                        <div
                          key={t.minutes}
                          className="absolute left-0 right-0 border-t border-line/50"
                          style={{ top: `${(t.minutes - dayDetailBounds.startMinutes) * DAY_DETAIL_PX_PER_MINUTE}px` }}
                        />
                      ))}
                    </div>

                    {selectedDate === todayStr && (
                      <TimelineNowMarker
                        startMinutes={dayDetailBounds.startMinutes}
                        endMinutes={dayDetailBounds.endMinutes}
                        pixelsPerMinute={DAY_DETAIL_PX_PER_MINUTE}
                      />
                    )}

                    {dayDetail.laidOut.map(({ slot, startMin, endMin, column, columnCount, overlap }) => {
                      const cls = classMap.get(slot.classId);
                      const studentCount = cls?.studentCount ?? cls?.studentIds?.length ?? 0;
                      const meetingLink = slot.meetingLink || cls?.meetingLink;
                      const topPx = (startMin - dayDetailBounds.startMinutes) * DAY_DETAIL_PX_PER_MINUTE;
                      const heightPx = Math.max((endMin - startMin) * DAY_DETAIL_PX_PER_MINUTE, 40);
                      const widthPct = 100 / columnCount;
                      const compact = heightPx < 80;

                      return (
                        <div
                          key={slot.id}
                          className={cn(
                            'absolute rounded-field p-2.5 shadow-soft border bg-primary-soft text-primary-ink border-primary/30 flex flex-col overflow-hidden',
                            overlap === 'conflict' && 'ring-2 ring-warning border-warning'
                          )}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `calc(${column * widthPct}% + 4px)`,
                            width: `calc(${widthPct}% - 8px)`,
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-card text-foreground border border-line tabular">
                                  {slot.classId}
                                </span>
                                <Badge tone="primary" className="text-[9px] py-0 px-1.5">
                                  {slot.status}
                                </Badge>
                                {overlap === 'conflict' && (
                                  <Badge tone="warning" className="text-[9px] py-0 px-1.5">
                                    Trùng giờ
                                  </Badge>
                                )}
                                {overlap === 'parallel' && (
                                  <Badge tone="info" className="text-[9px] py-0 px-1.5">
                                    Song song
                                  </Badge>
                                )}
                                {slot.checkinTime && (
                                  <Badge
                                    tone={slot.checkinStatus === 'Đi muộn' ? 'warning' : 'success'}
                                    className="text-[9px] py-0 px-1.5"
                                  >
                                    Vào {slot.checkinTime}
                                  </Badge>
                                )}
                              </div>
                              <h4
                                onClick={() => setSelectedClassForModal({ classId: slot.classId, slot })}
                                className="font-bold text-foreground text-[13px] leading-snug mt-0.5 truncate cursor-pointer hover:text-primary hover:underline transition"
                                title="Bấm để xem thông tin lớp học"
                              >
                                {cls?.name || slot.subject}
                              </h4>
                            </div>
                            <span className="text-[11px] font-mono font-bold whitespace-nowrap tabular">
                              {formatTimeHM(slot.startTime)} – {formatTimeHM(slot.endTime)}
                            </span>
                          </div>

                          {!compact && (
                            <div className="mt-auto pt-1.5 flex items-center justify-between gap-2 flex-wrap">
                              <div className="text-[11px] text-muted-foreground flex items-center gap-2.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-foreground">
                                  <Users size={11} className="text-primary" />
                                  {studentCount} học viên
                                </span>
                                {meetingLink && (
                                  <a
                                    href={meetingLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline font-semibold whitespace-nowrap"
                                  >
                                    <Video size={11} /> Phòng online
                                  </a>
                                )}
                              </div>
                              <Link
                                href={`/teacher/attendance?classId=${slot.classId}&slotId=${slot.id}`}
                                className="inline-flex items-center gap-1 py-1 px-2.5 rounded-pill bg-primary text-white text-[10px] font-bold shadow-soft hover:bg-primary-hover transition"
                              >
                                <CheckCircle2 size={10} /> Điểm danh
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Section: Ca mở chưa có GV phân công */}
          {openSections.length > 0 && (
            <section className="space-y-3 pt-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-bold text-foreground flex items-center gap-2">
                    <Sparkles size={16} className="text-warning" />
                    Ca mở cần giảng viên phụ trách ({openSections.length})
                  </h2>
                  <p className="text-[13px] text-muted-foreground mt-0.5">
                    Thầy/Cô có thể nhận ca trực tiếp để phân công vào lịch dạy cá nhân
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {openSections.map(({ section: sec, cls }) => {
                  const classTimeLabel =
                    sec.startTime && sec.endTime
                      ? sec.startTime + ' – ' + sec.endTime
                      : formatClassTimeLabel(cls, shifts);
                  const days =
                    sec.scheduleDays && sec.scheduleDays.length > 0
                      ? sec.scheduleDays
                      : cls.scheduleDays;

                  return (
                    <Card key={sec.id} className="flex flex-col justify-between">
                      <div className="space-y-3">
                        <CardHeader
                          title={cls.name}
                          subtitle={
                            <>
                              {cls.subject}
                              {sec.name ? <span className="opacity-70"> • {sec.name}</span> : null}
                            </>
                          }
                          action={
                            <Badge tone="primary" dot>
                              Ca mở
                            </Badge>
                          }
                        />

                        <div className="bg-muted rounded-field p-3 space-y-2 text-xs text-foreground">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <Clock size={13} className="text-primary" /> Khung ca:
                            </span>
                            <span className="font-semibold tabular">
                              {classTimeLabel}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <Calendar size={13} className="text-primary" /> Ngày học:
                            </span>
                            <span className="font-semibold">Thứ {days.join(', ')}</span>
                          </div>
                          <div className="flex items-center justify-between pt-1 border-t border-line">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <Users size={13} className="text-primary" /> Sĩ số:
                            </span>
                            <span className="font-semibold tabular">
                              {(cls.studentCount ?? cls.studentIds?.length ?? 0)} học viên đăng ký
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-line mt-4">
                        <Button
                          variant="primary"
                          size="md"
                          fullWidth
                          loading={claimingSectionId === sec.id}
                          onClick={() => handleClaimSection(sec, cls)}
                          icon={<Plus size={16} />}
                        >
                          Nhận ca dạy này
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </main>
        <QuickClassModal
          classId={selectedClassForModal?.classId || null}
          slot={selectedClassForModal?.slot || null}
          onClose={() => setSelectedClassForModal(null)}
        />
      </div>
    </RoleGuard>
  );
}
