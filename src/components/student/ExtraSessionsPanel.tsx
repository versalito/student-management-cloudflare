'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { getTodayDateStr } from '@/utils/date';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Ticket,
  X,
} from 'lucide-react';

/**
 * Đăng ký buổi lẻ: học viên tự chọn từng buổi của lớp đang mở thay vì học
 * theo ca dài hạn. Mỗi buổi là một dòng `student_session_bookings`.
 *
 * Toàn bộ quy tắc (lớp đang mở, buổi chưa bắt đầu, không trùng giờ) do server
 * quyết định; component chỉ hiển thị `conflict` và lỗi trả về.
 */

const DAY_LABELS: Record<number, string> = {
  2: 'T2',
  3: 'T3',
  4: 'T4',
  5: 'T5',
  6: 'T6',
  7: 'T7',
  8: 'CN',
};

interface BookableSlot {
  id: string;
  classId: string;
  className: string;
  subject: string;
  sectionId?: string;
  teacherName?: string;
  date: string;
  startTime: string;
  endTime: string;
  conflict?: { slotId: string; className: string; startTime: string; endTime: string };
}

interface MyBooking {
  booking: { id: string; slotId: string; status: string };
  slot: BookableSlot;
  cancellable: boolean;
}

/** Thông điệp lỗi từ mọi kiểu throw, không cần `any`. */
function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Thứ 2 của tuần chứa `dateStr` (chuẩn ISO, không phụ thuộc múi giờ máy). */
function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const jsDay = base.getUTCDay(); // 0 = CN
  const offset = jsDay === 0 ? 6 : jsDay - 1;
  base.setUTCDate(base.getUTCDate() - offset);
  return toDateStr(base);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return toDateStr(base);
}

/** Thứ dự án: 2..8 với 8 = Chủ nhật. */
function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return jsDay === 0 ? 8 : jsDay + 1;
}

function formatDayMonth(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

export function ExtraSessionsPanel({ studentId }: { studentId: string }) {
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(getTodayDateStr()));
  const [slots, setSlots] = useState<BookableSlot[]>([]);
  const [mine, setMine] = useState<MyBooking[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const weekEnd = addDays(weekStart, 6);
  const today = getTodayDateStr();

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const [slotRes, mineRes] = await Promise.all([
        fetch(`/api/student/slots?studentId=${encodeURIComponent(studentId)}&from=${weekStart}&to=${weekEnd}`),
        fetch(`/api/student/bookings?studentId=${encodeURIComponent(studentId)}`),
      ]);
      const slotData = await slotRes.json();
      const mineData = await mineRes.json();
      if (!slotRes.ok) throw new Error(slotData.error || 'Không tải được danh sách buổi');
      if (!mineRes.ok) throw new Error(mineData.error || 'Không tải được buổi đã đặt');
      setSlots((slotData.slots || []) as BookableSlot[]);
      setMine((mineData.bookings || []) as MyBooking[]);
    } catch (e) {
      toast.error(errMessage(e, 'Lỗi kết nối mạng.'));
    } finally {
      setLoading(false);
    }
  }, [studentId, weekStart, weekEnd, toast]);

  useEffect(() => {
    setSelected([]);
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, BookableSlot[]>();
    for (const slot of slots) {
      const list = map.get(slot.date) || [];
      list.push(slot);
      map.set(slot.date, list);
    }
    return map;
  }, [slots]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const toggle = (slotId: string) =>
    setSelected((prev) => (prev.includes(slotId) ? prev.filter((id) => id !== slotId) : [...prev, slotId]));

  const handleBook = async () => {
    if (selected.length === 0) return;
    setBusy('book');
    let ok = 0;
    const failed: string[] = [];
    for (const slotId of selected) {
      try {
        const res = await fetch('/api/student/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, slotId }),
        });
        const data = await res.json();
        if (res.ok) ok += 1;
        else failed.push(data.error || 'Lỗi không xác định');
      } catch (e) {
        failed.push(errMessage(e, 'Lỗi kết nối mạng'));
      }
    }
    setBusy(null);
    setSelected([]);
    await load();
    if (ok > 0) toast.success(`Đã đăng ký ${ok} buổi.`);
    if (failed.length > 0) toast.error(failed[0]);
  };

  const handleCancel = async (slotId: string) => {
    setBusy(slotId);
    try {
      const res = await fetch(
        `/api/student/bookings?studentId=${encodeURIComponent(studentId)}&slotId=${encodeURIComponent(slotId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Huỷ buổi thất bại');
      toast.success('Đã huỷ buổi.');
      await load();
    } catch (e) {
      toast.error(errMessage(e, 'Lỗi kết nối mạng.'));
    } finally {
      setBusy(null);
    }
  };

  const weekLabel = `${formatDayMonth(weekStart)} – ${formatDayMonth(weekEnd)}`;

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[15px] font-bold text-foreground flex items-center gap-2">
              <Ticket size={16} className="text-primary" /> Chọn buổi lẻ
              {mine.length > 0 && <Badge tone="primary">{mine.length} buổi đã đặt</Badge>}
            </h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              Học theo từng buổi của lớp đang mở — không cần đăng ký cả khoá.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))} icon={<ChevronLeft size={14} />}>
              Tuần trước
            </Button>
            <span className="text-[12px] font-semibold text-foreground tabular px-1">{weekLabel}</span>
            <Button variant="secondary" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))} icon={<ChevronRight size={14} />}>
              Tuần sau
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="h-40 rounded-field bg-muted animate-pulse border border-line" />
        ) : slots.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={24} />}
            title="Không có buổi nào mở trong tuần này"
            description="Thử chuyển sang tuần khác, hoặc đăng ký lớp để học đều."
          />
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((date) => {
              const daySlots = byDay.get(date) || [];
              const isToday = date === today;
              const isPast = date < today;
              return (
                <div
                  key={date}
                  className={cn(
                    'rounded-field border p-1.5 min-h-[92px] space-y-1',
                    isToday ? 'border-primary bg-primary-soft/40' : 'border-line bg-card',
                    isPast && 'opacity-50'
                  )}
                >
                  <div className="text-center">
                    <div className="text-[10px] font-bold text-muted-foreground">{DAY_LABELS[dayOfWeek(date)]}</div>
                    <div className={cn('text-[12px] font-bold tabular', isToday ? 'text-primary' : 'text-foreground')}>
                      {formatDayMonth(date)}
                    </div>
                  </div>
                  {daySlots.map((slot) => {
                    const isSelected = selected.includes(slot.id);
                    const blocked = !!slot.conflict;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={blocked || busy !== null}
                        onClick={() => toggle(slot.id)}
                        title={
                          blocked
                            ? `Trùng giờ với ${slot.conflict?.className} (${slot.conflict?.startTime}–${slot.conflict?.endTime})`
                            : `${slot.className} · ${slot.startTime}–${slot.endTime}`
                        }
                        className={cn(
                          'w-full text-left px-1.5 py-1 rounded-[6px] border text-[10px] leading-tight transition',
                          blocked
                            ? 'border-warning/60 bg-warning-soft text-muted-foreground cursor-not-allowed'
                            : isSelected
                              ? 'border-primary bg-primary text-white'
                              : 'border-line bg-card hover:bg-muted'
                        )}
                      >
                        <span className="font-mono font-bold block">{slot.startTime}</span>
                        <span className="block truncate">{slot.className}</span>
                        {blocked && (
                          <span className="flex items-center gap-0.5 text-[9px]">
                            <AlertCircle size={9} /> trùng giờ
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[12px] text-muted-foreground">
            {selected.length > 0 ? `Đã chọn ${selected.length} buổi` : 'Bấm vào buổi để chọn, chọn nhiều buổi một lần được.'}
          </span>
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'book'}
            disabled={selected.length === 0 || busy !== null}
            onClick={handleBook}
            icon={<Check size={14} />}
          >
            Đăng ký {selected.length > 0 ? selected.length : ''} buổi
          </Button>
        </div>

        {mine.length > 0 && (
          <div className="pt-3 border-t border-line space-y-2">
            <h3 className="text-[13px] font-bold text-foreground">Buổi lẻ đã đặt</h3>
            <div className="space-y-1.5">
              {mine.map(({ booking, slot, cancellable }) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between gap-2 rounded-field border border-line bg-muted/50 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-foreground truncate">
                      {slot.className} · {formatDayMonth(slot.date)}
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 tabular">
                      <Clock size={11} /> {slot.startTime} – {slot.endTime}
                      {booking.status === 'Đã học' && <Badge tone="success" className="ml-1 text-[10px]">Đã học</Badge>}
                    </div>
                  </div>
                  {cancellable ? (
                    <Button
                      variant="danger-outline"
                      size="sm"
                      loading={busy === slot.id}
                      onClick={() => handleCancel(slot.id)}
                      icon={<X size={12} />}
                    >
                      Huỷ
                    </Button>
                  ) : (
                    <Badge tone="neutral" className="text-[10px]">
                      {booking.status}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
