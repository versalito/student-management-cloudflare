'use client';

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { ScheduleSlot, TimeShift, TIME_SHIFTS } from '@/types/schedule';
import type { ScheduleSlotWithClassName } from '@/repositories/IRepository';
import { ClassEntity } from '@/types/classroom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { QuickClassModal } from '@/components/common/QuickClassModal';
import { Field, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useStudentCheckin } from '@/hooks/useStudentCheckin';
import {
  Clock,
  BookOpen,
  Video,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarX2,
  ArrowRightLeft,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { getTodayDateStr, getTodayDateStrByDate, getNowTimeStr, minutesTo24h, timeToMinutes } from '@/utils/date';
import { cn } from '@/lib/cn';
import {
  computeTimelineBounds,
  buildTicksBetween,
  layoutDaySlots,
  TimelineNowMarker,
} from '@/components/schedule/Timeline';

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

function dayOfWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00+07:00');
  const g = d.getDay();
  return g === 0 ? 8 : g + 1;
}

function formatDayLabel(dateStr: string): string {
  const day = dayOfWeekNumber(dateStr);
  const [, m, dd] = dateStr.split('-');
  return `${DAY_LABELS[day]} (${dd}/${m})`;
}

function toSaigonDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00+07:00');
}

function getMonday(dateStr: string): Date {
  const d = toSaigonDate(dateStr);
  const g = d.getDay();
  const offset = g === 0 ? -6 : 1 - g;
  d.setDate(d.getDate() + offset);
  return d;
}

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

function formatWeekRange(weekDates: string[]): string {
  if (weekDates.length === 0) return '';
  const first = weekDates[0];
  const last = weekDates[weekDates.length - 1];
  const [, fm, fdd] = first.split('-');
  const [, lm, ldd] = last.split('-');
  return `${fdd}/${fm} – ${ldd}/${lm}`;
}

export default function StudentSchedulePage() {
  const { currentUser, isReady } = useApp();
  const [slots, setSlots] = useState<ScheduleSlotWithClassName[]>([]);
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [shifts, setShifts] = useState<TimeShift[]>(TIME_SHIFTS);
  const [loading, setLoading] = useState(true);
  const [weekRefDate, setWeekRefDate] = useState(getTodayDateStr());
  const toast = useToast();
  const [absenceSlot, setAbsenceSlot] = useState<ScheduleSlot | null>(null);
  const [absenceReason, setAbsenceReason] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [cancelingBookingId, setCancelingBookingId] = useState<string | null>(null);
  // Modal xem thông tin lớp học
  const [selectedClassForModal, setSelectedClassForModal] = useState<{ classId: string; slot?: ScheduleSlot } | null>(null);
  // Cửa sổ điểm danh do server quyết định; TKB chỉ hiển thị đúng trạng thái đó.
  const { sessionState, checking, checkinState, handleCheckin, refreshSessionState } =
    useStudentCheckin({ studentId: currentUser?.id });
  const todayStr = sessionState?.today || getTodayDateStr();
  const nowTimeStr = getNowTimeStr();

  const loadSchedule = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    // Cửa sổ điểm danh tải song song để CTA có trạng thái ngay khi TKB hiện ra.
    void refreshSessionState();
    try {
      const [slotRes, clsRes, shiftRes] = await Promise.all([
        fetch(`/api/schedule?studentId=${currentUser.id}`),
        fetch('/api/classes'),
        fetch('/api/shifts'),
      ]);
      const slotData = await slotRes.json();
      const clsData = await clsRes.json();
      const shiftData = await shiftRes.json();

      setSlots(slotData.slots || []);
      setClasses(clsData.classes || []);
      if (shiftData.shifts) setShifts(shiftData.shifts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, refreshSessionState]);

  useEffect(() => {
    if (!isReady || !currentUser?.id) return;
    void loadSchedule();
  }, [currentUser?.id, isReady, loadSchedule]);

  const classMap = new Map(classes.map((c) => [c.id, c]));

  const weekDates = getWeekDates(weekRefDate);
  const weekDateSet = new Set(weekDates);

  const weekSlots = slots
    .filter((s) => weekDateSet.has(s.date) && s.status !== 'Đã hủy')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
    });

  const goPrevWeek = () => {
    const d = toSaigonDate(weekRefDate);
    d.setDate(d.getDate() - 7);
    setWeekRefDate(getTodayDateStrByDate(d));
  };
  const goNextWeek = () => {
    const d = toSaigonDate(weekRefDate);
    d.setDate(d.getDate() + 7);
    setWeekRefDate(getTodayDateStrByDate(d));
  };
  const goThisWeek = () => setWeekRefDate(getTodayDateStr());

  const openAbsenceModal = (slot: ScheduleSlot) => {
    setAbsenceSlot(slot);
    setAbsenceReason('');
  };

  // Huỷ buổi lẻ ngay trên TKB: server chỉ cho huỷ trước giờ bắt đầu.
  const cancelBooking = async (slot: ScheduleSlotWithClassName) => {
    if (!currentUser?.id) return;
    setCancelingBookingId(slot.id);
    try {
      const res = await fetch(
        `/api/student/bookings?studentId=${encodeURIComponent(currentUser.id)}&slotId=${encodeURIComponent(
          slot.id
        )}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Huỷ buổi thất bại');
      toast.success('Đã huỷ buổi lẻ.');
      await loadSchedule();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lỗi kết nối mạng.');
    } finally {
      setCancelingBookingId(null);
    }
  };
  const submitAbsenceRequest = async () => {
    if (!absenceSlot || !currentUser?.id) return;
    if (!absenceReason.trim()) {
      toast.error('Vui lòng nhập lý do xin vắng mặt.');
      return;
    }
    setRequestSubmitting(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: currentUser.id,
          classId: absenceSlot.classId,
          scheduleSlotId: absenceSlot.id,
          type: 'XIN_NGHI',
          reason: absenceReason.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Đã gửi đơn xin vắng mặt.');
        setAbsenceSlot(null);
        setAbsenceReason('');
      } else {
        toast.error(data.error || 'Gửi đơn thất bại.');
      }
    } catch (e: any) {
      toast.error(e.message || 'Lỗi kết nối mạng.');
    } finally {
      setRequestSubmitting(false);
    }
  };

  // Trục giờ co giãn vừa đủ cho các buổi học trong tuần, không còn 06:00 – 23:00 trống trải
  const bounds = useMemo(() => computeTimelineBounds(weekSlots), [weekSlots]);
  const ticks = useMemo(
    () => buildTicksBetween(bounds.startMinutes, bounds.endMinutes, 30),
    [bounds.startMinutes, bounds.endMinutes]
  );
  const PX_PER_MINUTE = 1;
  const WEEK_ROW_HEIGHT_PX = (bounds.endMinutes - bounds.startMinutes) * PX_PER_MINUTE;
  const minuteToTopPx = (minutes: number): number =>
    (Math.min(Math.max(minutes, bounds.startMinutes), bounds.endMinutes) - bounds.startMinutes) *
    PX_PER_MINUTE;
  const boundsLabel = `${minutesTo24h(bounds.startMinutes)} – ${minutesTo24h(bounds.endMinutes)}`;

  return (
    <RoleGuard allowedRoles={['STUDENT', 'ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header
          title="Thời khóa biểu"
          subtitle={`Lịch học theo tuần của học viên ${currentUser?.name || ''} (${currentUser?.id || ''})`}
        />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Thanh tổng quan & nút chuyển tới lớp học */}
          <Card padded className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-[15px] font-bold text-foreground">
                Tổng số buổi học trong kỳ:{' '}
                <span className="text-primary text-base font-extrabold tabular">
                  {slots.length}
                </span>{' '}
                buổi
              </h3>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Hiển thị lịch học theo tuần từ Thứ 2 đến Chủ nhật theo khung giờ thực tế
              </p>
            </div>
            <LinkButton
              href="/student/classes"
              variant="secondary"
              icon={<BookOpen size={15} />}
              fullWidth
              className="shrink-0 w-full sm:w-auto"
            >
              Tra cứu & đổi ca học
            </LinkButton>
          </Card>

          {/* Bộ điều hướng tuần */}
          <Card padded className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-muted p-1 rounded-field border border-line">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={goPrevWeek}
                  aria-label="Tuần trước"
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={goNextWeek}
                  aria-label="Tuần sau"
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goThisWeek}
                icon={<CalendarDays size={14} />}
              >
                Tuần này
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Tuần</span>
              <strong className="text-foreground text-sm font-bold tabular">
                {formatWeekRange(weekDates)}
              </strong>
              <Badge tone="primary" className="tabular">
                {weekSlots.length} buổi
              </Badge>
            </div>
          </Card>

          {loading ? (
            <Card padded className="space-y-3">
              <div className="h-6 w-48 bg-muted rounded-field animate-pulse" />
              <div className="h-64 bg-muted rounded-field animate-pulse" />
            </Card>
          ) : slots.length === 0 ? (
            <Card padded>
              <EmptyState
                icon={<CalendarDays size={32} />}
                title="Chưa có lịch học nào trong kỳ này"
                description="Hệ thống chưa ghi nhận lịch học của bạn. Bạn có thể tra cứu và đăng ký ca học phù hợp."
                action={
                  <LinkButton href="/student/classes" variant="primary" icon={<BookOpen size={15} />}>
                    Đăng ký ca học ngay
                  </LinkButton>
                }
              />
            </Card>
          ) : (
            <Card padded={false} className="overflow-hidden">
              <div className="p-3 bg-muted/30 border-b border-line text-xs text-muted-foreground flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock size={13} className="text-primary" />
                  <span>Khung giờ {boundsLabel}</span>
                </div>
                <span className="sm:hidden text-[11px] text-muted-foreground">
                  Vuốt ngang để xem đủ tuần
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[960px]">
                  {/* Hàng Header ngày */}
                  <div className="flex border-b border-line bg-muted/40">
                    <div className="w-14 shrink-0 border-r border-line" />
                    {weekDates.map((d) => {
                      const isToday = d === getTodayDateStr();
                      return (
                        <div
                          key={d}
                          className={`flex-1 min-w-[125px] text-center px-2 py-2.5 border-l border-line first:border-l-0 ${
                            isToday ? 'bg-primary-soft/50 text-primary-ink' : 'text-foreground'
                          }`}
                        >
                          <div
                            className={`text-[12px] font-bold ${
                              isToday ? 'text-primary-ink' : 'text-foreground'
                            }`}
                          >
                            {formatDayLabel(d)}
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                            {d}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Thân Timeline */}
                  <div className="flex">
                    {/* Cột nhãn giờ bên trái */}
                    <div className="w-14 shrink-0 border-r border-line bg-muted/20">
                      <div className="relative" style={{ height: `${WEEK_ROW_HEIGHT_PX}px` }}>
                        {ticks.map((t) => (
                          <div
                            key={t.minutes}
                            className="absolute right-1.5 text-[10px] font-mono font-medium text-muted-foreground whitespace-nowrap -translate-y-1/2"
                            style={{ top: minuteToTopPx(t.minutes) }}
                          >
                            {t.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 7 cột ngày */}
                    {weekDates.map((d) => {
                      const isToday = d === getTodayDateStr();
                      const daySlots = weekSlots.filter((s) => s.date === d);
                      return (
                        <div
                          key={d}
                          className={`flex-1 min-w-[125px] border-l border-line relative first:border-l-0 ${
                            isToday ? 'bg-primary-soft/10' : ''
                          }`}
                        >
                          {/* Lưới giờ ngang */}
                          <div className="absolute inset-0 pointer-events-none">
                            {ticks.map((t) => (
                              <div
                                key={t.minutes}
                                className={`absolute left-0 right-0 h-px ${
                                  t.minutes % 60 === 0 ? 'bg-line' : 'bg-line/40'
                                }`}
                                style={{ top: minuteToTopPx(t.minutes) }}
                              />
                            ))}
                          </div>

                          {/* Khối slot trong ngày */}
                          <div
                            className="relative"
                            style={{ height: `${WEEK_ROW_HEIGHT_PX}px` }}
                          >
                            {isToday && (
                              <TimelineNowMarker
                                startMinutes={bounds.startMinutes}
                                endMinutes={bounds.endMinutes}
                                pixelsPerMinute={PX_PER_MINUTE}
                              />
                            )}

                            {layoutDaySlots(daySlots).map(({ slot, startMin, endMin, isOvernight, column, columnCount }) => {
                              // Với học viên, hai lớp của chính mình trùng giờ luôn là vấn đề cần xử lý
                              const hasConflict = columnCount > 1;
                              const cls = classMap.get(slot.classId);
                              const isBooking = slot.source === 'booking';
                              const meetingLink = slot.meetingLink || cls?.meetingLink;
                              const topPx = minuteToTopPx(startMin);
                              const rawHeightPx = minuteToTopPx(endMin) - topPx;
                              const isShortSlot = rawHeightPx < 160;
                              // CTA điểm danh chỉ có ý nghĩa với buổi hôm nay.
                              const checkin = slot.date === todayStr ? checkinState(slot) : null;
                              const heightPx = Math.max(rawHeightPx, isShortSlot ? 160 : 36);
                              const widthPct = 100 / columnCount;

                              return (
                                <div
                                  key={slot.id}
                                  className={cn(
                                    'absolute rounded-field border border-primary/30 bg-card p-2 shadow-soft hover:shadow-pop transition overflow-hidden flex flex-col justify-between',
                                    hasConflict && 'ring-2 ring-warning border-warning'
                                  )}
                                  style={{
                                    top: `${topPx}px`,
                                    height: `${heightPx}px`,
                                    left: `calc(${column * widthPct}% + 4px)`,
                                    width: `calc(${widthPct}% - 8px)`,
                                  }}
                                >
                                  <div>
                                    <div className="flex items-center justify-between gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setSelectedClassForModal({ classId: slot.classId, slot })}
                                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-pill bg-primary-soft text-primary-ink truncate max-w-[80px] hover:bg-primary hover:text-white transition cursor-pointer"
                                        title="Bấm để xem thông tin lớp"
                                      >
                                        {slot.classId}
                                      </button>
                                      {isOvernight && (
                                        <Badge tone="warning" className="text-[9px] px-1 py-0">
                                          qua đêm
                                        </Badge>
                                      )}
                                      {isBooking && (
                                        <Badge tone="primary" className="text-[9px] px-1 py-0">
                                          Lịch lẻ
                                        </Badge>
                                      )}
                                      {hasConflict && (
                                        <Badge tone="warning" className="text-[9px] px-1 py-0">
                                          Trùng giờ
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-[11px] font-mono font-bold text-primary tabular mt-1">
                                      {slot.startTime} – {slot.endTime}
                                    </div>
                                    <div
                                      onClick={() => setSelectedClassForModal({ classId: slot.classId, slot })}
                                      className="text-[12px] font-bold text-foreground leading-tight mt-0.5 truncate cursor-pointer hover:text-primary hover:underline transition"
                                      title="Bấm để xem thông tin lớp"
                                    >
                                      {cls?.name || slot.classId}
                                    </div>
                                  </div>

                                  <div className="flex-1 min-h-0 overflow-hidden space-y-0.5 mt-1 pt-1 border-t border-line/60">
                                    {meetingLink ? (
                                      <a
                                        href={meetingLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                                      >
                                        <Video size={11} />
                                        <span>Phòng online</span>
                                        <ExternalLink size={9} />
                                      </a>
                                    ) : (
                                      <div className="text-[10px] text-muted-foreground italic">
                                        Trực tiếp
                                      </div>
                                    )}
                                  </div>
                                    <div className="shrink-0 flex flex-col gap-1 pt-1.5 mt-1 border-t border-line/40">
                                      {checkin && (
                                        checkin.type === 'open' ? (
                                          <button
                                            onClick={() => handleCheckin(slot)}
                                            disabled={checking === slot.id}
                                            className="inline-flex w-full items-center justify-center gap-1 rounded-pill bg-primary px-2 py-1 text-[10px] font-bold text-white hover:bg-primary-ink disabled:opacity-60 transition"
                                          >
                                            <CheckCircle2 size={11} />
                                            {checking === slot.id ? 'Đang lưu…' : 'Điểm danh'}
                                          </button>
                                        ) : checkin.type === 'done' ? (
                                          <div className="inline-flex w-full items-center justify-center gap-1 rounded-pill bg-success-soft px-2 py-1 text-[10px] font-bold text-foreground">
                                            <CheckCircle2 size={11} className="text-success" />
                                            {checkin.status}
                                            {checkin.time ? ` ${checkin.time}` : ''}
                                          </div>
                                        ) : (
                                          <div
                                            title={checkin.reason}
                                            className="inline-flex w-full items-center justify-center gap-1 rounded-pill border border-line bg-muted/40 px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                                          >
                                            <Clock size={11} />
                                            <span className="truncate">{checkin.reason}</span>
                                          </div>
                                        )
                                      )}
                                      {isBooking ? (
                                        (() => {
                                          const started =
                                            slot.date < todayStr ||
                                            (slot.date === todayStr &&
                                              timeToMinutes(nowTimeStr) >= timeToMinutes(slot.startTime));
                                          return (
                                            <button
                                              onClick={() => cancelBooking(slot)}
                                              disabled={started || cancelingBookingId === slot.id}
                                              title={started ? 'Buổi đã bắt đầu, không huỷ được nữa' : undefined}
                                              className="inline-flex w-full flex-nowrap whitespace-nowrap items-center justify-center gap-1 rounded-pill border border-line px-2 py-0.5 text-[10px] font-semibold text-danger hover:bg-danger hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-danger transition"
                                            >
                                              <Trash2 size={11} />
                                              {cancelingBookingId === slot.id
                                                ? 'Đang huỷ…'
                                                : started
                                                  ? 'Đã bắt đầu'
                                                  : 'Huỷ buổi'}
                                            </button>
                                          );
                                        })()
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => openAbsenceModal(slot)}
                                            className="inline-flex w-full flex-nowrap whitespace-nowrap items-center justify-center gap-1 rounded-pill border border-line px-2 py-0.5 text-[10px] font-semibold text-danger hover:bg-danger hover:text-white transition"
                                          >
                                            <CalendarX2 size={11} />
                                            Xin vắng
                                          </button>
                                          <Link
                                            href="/student/classes"
                                            className="inline-flex w-full flex-nowrap whitespace-nowrap items-center justify-center gap-1 rounded-pill border border-line px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary-soft transition"
                                          >
                                            <ArrowRightLeft size={11} />
                                            Đổi ca
                                          </Link>
                                        </>
                                      )}
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
            </Card>
          )}
        <Sheet
          isOpen={!!absenceSlot}
          onClose={() => {
            if (!requestSubmitting) setAbsenceSlot(null);
          }}
          title="Xin vắng mặt"
          description={
            absenceSlot
              ? (classMap.get(absenceSlot.classId)?.name || absenceSlot.classId) + ' - ' + absenceSlot.date + ' (' + absenceSlot.startTime + ' - ' + absenceSlot.endTime + ')'
              : undefined
          }
          size="sm"
          footer={
            <Button variant="primary" fullWidth loading={requestSubmitting} onClick={submitAbsenceRequest}>
              Gửi đơn xin phép
            </Button>
          }
        >
          {absenceSlot && (
            <div className="space-y-4">
              <div className="rounded-field bg-muted border border-line p-3 text-[13px] space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Lớp</span>
                  <span className="font-semibold">{absenceSlot.classId}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Buổi học</span>
                  <span className="font-semibold tabular">{absenceSlot.date}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Khung giờ</span>
                  <span className="font-semibold tabular">
                    {absenceSlot.startTime} – {absenceSlot.endTime}
                  </span>
                </div>
              </div>
              <Field label="Lý do xin vắng" required>
                <Textarea
                  value={absenceReason}
                  onChange={(e) => setAbsenceReason(e.target.value)}
                  placeholder="VD: Bận việc gia đình, ốm đau..."
                />
              </Field>
            </div>
          )}
        </Sheet>

        <QuickClassModal
          classId={selectedClassForModal?.classId || null}
          slot={selectedClassForModal?.slot || null}
          onClose={() => setSelectedClassForModal(null)}
        />

        </main>
      </div>
    </RoleGuard>
  );
}
