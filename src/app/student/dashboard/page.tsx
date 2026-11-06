'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { useApp } from '@/context/AppContext';
import { RoleGuard } from '@/components/common/RoleGuard';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkButton } from '@/components/ui/LinkButton';
import { Badge, AttendanceBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { getTodayDateStr } from '@/utils/date';
import { useStudentCheckin } from '@/hooks/useStudentCheckin';
import { formatSlotShortLabel } from '@/utils/schedule';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Receipt,
  ArrowRight,
  Video,
  ExternalLink,
  Sparkles,
  Inbox,
  MapPin,
  UserCheck,
  CalendarX2,
  ArrowRightLeft,
} from 'lucide-react';

const WEEKDAY_LABELS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

function formatDayLabel(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const [, mm, dd] = dateStr.split('-');
  return `${WEEKDAY_LABELS[d.getDay()]}, ${dd}/${mm}`;
}

function money(v?: number) {
  if (!v) return '0đ';
  return v.toLocaleString('vi-VN') + 'đ';
}

export default function StudentDashboardPage() {
  const { currentUser, isReady } = useApp();
  const toast = useToast();
  const [student, setStudent] = useState<any>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [finance, setFinance] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [absenceSlot, setAbsenceSlot] = useState<any | null>(null);
  const [absenceReason, setAbsenceReason] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [swapSlot, setSwapSlot] = useState<any | null>(null);
  const [swapTargets, setSwapTargets] = useState<any[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const {
    sessionState,
    setSessionState,
    sessionMap,
    checking,
    checkinState,
    handleCheckin,
    refreshSessionState,
  } = useStudentCheckin({ studentId: currentUser?.id, attendance });

  // Ngày hôm nay lấy từ server để nhãn ngày không lệch theo đồng hồ máy.
  const todayStr = sessionState?.today || getTodayDateStr();

  useEffect(() => {
    if (!isReady || !currentUser?.id) return;
    (async () => {
      const safe = async (url: string) => {
        try {
          const r = await fetch(url);
          return r.ok ? await r.json() : {};
        } catch {
          return {};
        }
      };
      const [st, sc, at, fi, rq, ss] = await Promise.all([
        safe(`/api/students?id=${currentUser.id}`),
        safe(`/api/schedule?studentId=${currentUser.id}`),
        safe(`/api/attendance?studentId=${currentUser.id}`),
        safe(`/api/finance?studentId=${currentUser.id}&summary=true`),
        safe(`/api/requests?studentId=${currentUser.id}`),
        safe(`/api/student/session-state?studentId=${currentUser.id}`),
      ]);
      setStudent(st.student || null);
      setSlots(sc.slots || []);
      setAttendance(at.records || []);
      setFinance(fi || null);
      setRequests(rq.requests || []);
      setSessionState(ss?.today ? ss : null);
      setLoading(false);
    })();
  }, [isReady, currentUser]);

  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  /** Ca hôm nay + 5 ca kế tiếp đều do server chọn (đã sort, đúng lớp của HS). */
  const todaySlots = useMemo(
    () => (sessionState?.todaySessions || []).map((s) => ({ ...slotById.get(s.id), ...s })),
    [sessionState, slotById]
  );

  const upcoming = useMemo(
    () => (sessionState?.upcoming || []).map((s) => ({ ...slotById.get(s.id), ...s })),
    [sessionState, slotById]
  );

  const openAbsence = (slot: any) => {
    setAbsenceSlot(slot);
    setAbsenceReason('');
  };

  const submitAbsence = async () => {
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
    } catch {
      toast.error('Không kết nối được, bạn thử lại nhé.');
    } finally {
      setRequestSubmitting(false);
    }
  };

  const openSwap = async (slot: any) => {
    if (!currentUser?.id) return;
    setSwapSlot(slot);
    setSwapTargets([]);
    try {
      const res = await fetch('/api/schedule?classId=' + slot.classId + '&date=' + slot.date);
      const data = await res.json();
      const all = (data.slots || []).filter(
        (s: any) => s.id !== slot.id && s.status !== 'Đã hủy'
      );
      setSwapTargets(all.sort((a: any, b: any) => (a.startTime || '').localeCompare(b.startTime || '')));
    } catch {
      toast.error('Không tải được các ca khác.');
    }
  };

  const confirmSwap = async (toSlotId: string) => {
    if (!swapSlot || !currentUser?.id) return;
    setSwapLoading(true);
    try {
      const res = await fetch('/api/student/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: currentUser.id,
          fromSlotId: swapSlot.id,
          toSlotId,
          date: swapSlot.date,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Đã đổi ca trong ngày. Sổ điểm danh sẽ cập nhật theo ca mới.');
        setSwapSlot(null);
      } else {
        toast.error(data.error || 'Đổi ca thất bại.');
      }
    } catch {
      toast.error('Không kết nối được, bạn thử lại nhé.');
    } finally {
      setSwapLoading(false);
    }
  };

  const present = attendance.filter((a) => a.status === 'Có mặt').length;
  const late = attendance.filter((a) => a.status === 'Đi muộn').length;
  const absent = attendance.filter((a) => a.status.includes('Vắng')).length;
  const attended = present + late;
  const rate = attendance.length ? Math.round((attended / attendance.length) * 100) : 100;
  const remaining = student?.remainingSessions ?? 0;
  const debt = finance?.totalDebt ?? 0;

  const pendingRequests = requests.filter((r) => r.status === 'CHỜ_DUYỆT');

  return (
    <RoleGuard allowedRoles={['STUDENT', 'ADMIN']}>
      <div className="flex-1 flex flex-col min-h-screen">
        <Header title="Trang chủ" subtitle={`Chào ${currentUser?.name || ''}, đây là việc học hôm nay`} />

        <main className="p-4 sm:p-6 max-w-content mx-auto w-full space-y-5">
          {/* Ca học hôm nay */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-foreground">Ca học hôm nay</h2>
              <span className="text-[12px] text-muted-foreground">{formatDayLabel(todayStr)}</span>
            </div>

            {loading ? (
              <div className="h-28 rounded-card bg-muted animate-pulse" />
            ) : todaySlots.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<CalendarDays size={24} />}
                  title="Hôm nay bạn không có ca học"
                  description="Xem thời khoá biểu để biết các buổi sắp tới."
                  action={
                    <LinkButton href="/student/schedule" variant="secondary">
                      Xem thời khoá biểu
                    </LinkButton>
                  }
                />
              </Card>
            ) : (
              todaySlots.map((slot) => {
                const state = checkinState(slot);
                const slotLabel = formatSlotShortLabel(slot);
                return (
                  <Card key={slot.id} className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone="primary">{slotLabel}</Badge>
                        {!slotLabel.includes('–') && (
                          <span className="text-[13px] font-semibold text-muted-foreground tabular">
                            {slot.startTime} – {slot.endTime}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-bold text-foreground mt-1.5">
                        {sessionMap[slot.id]?.className || slot.className || slot.classId}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-[13px] text-muted-foreground flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <UserCheck size={13} /> GV {slot.teacherName || slot.teacherId}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<CalendarX2 size={14} />}
                          onClick={() => openAbsence(slot)}
                        >
                          Xin vắng
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<ArrowRightLeft size={14} />}
                          disabled={state.type === 'closed' && state.reason === 'Ca đã kết thúc'}
                          onClick={() => openSwap(slot)}
                        >
                          Đổi ca
                        </Button>
                      </div>
                      {state.type === 'done' ? (
                        <AttendanceBadge status={state.status as any} />
                      ) : state.type === 'open' ? (
                        <Button
                          size="lg"
                          loading={checking === slot.id}
                          icon={<CheckCircle2 size={18} />}
                          onClick={() => handleCheckin(slot)}
                        >
                          Điểm danh
                        </Button>
                      ) : (
                        <div className="text-right">
                          <Button size="lg" disabled>
                            Điểm danh
                          </Button>
                          <p className="text-[11px] text-muted-foreground mt-1 text-center">{state.reason}</p>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </section>

          {/* Số liệu học tập */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Tỉ lệ đi học"
              value={`${rate}%`}
              hint={`${attended} buổi có mặt`}
              tone="success"
              icon={<CheckCircle2 size={18} />}
            />
            <StatCard
              label="Buổi đã học"
              value={attended}
              hint="Tính khi có mặt hoặc đi muộn"
              tone="primary"
              icon={<Sparkles size={18} />}
            />
            <StatCard
              label="Buổi vắng"
              value={absent}
              hint={late ? `${late} buổi đi muộn` : 'Không có buổi muộn'}
              tone="warning"
              icon={<Clock size={18} />}
            />
            <StatCard
              label="Buổi còn lại"
              value={remaining}
              hint="Trừ dần khi học xong ca"
              tone="info"
              icon={<CalendarDays size={18} />}
            />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Buổi học sắp tới */}
            <Card className="lg:col-span-2">
              <CardHeader
                icon={<CalendarDays size={18} />}
                title="Buổi học sắp tới"
                subtitle="Lịch học của bạn trong những ngày tới"
                action={
                  <Link
                    href="/student/schedule"
                    className="text-[13px] font-semibold text-primary hover:text-primary-hover inline-flex items-center gap-1"
                  >
                    Toàn bộ <ArrowRight size={14} />
                  </Link>
                }
              />
              {upcoming.length === 0 ? (
                <EmptyState icon={<CalendarDays size={22} />} title="Chưa có buổi học nào sắp tới" />
              ) : (
                <div className="divide-y divide-line -mx-1">
                  {upcoming.map((slot) => (
                    <div key={slot.id} className="py-3 px-1 flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-field bg-primary-soft text-primary-ink flex flex-col items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold leading-none">
                          {WEEKDAY_LABELS[new Date(slot.date + 'T00:00:00').getDay()].replace('Thứ ', 'T')}
                        </span>
                        <span className="text-[13px] font-extrabold leading-tight tabular">
                          {slot.date.slice(8)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-foreground truncate">
                          {slot.className || slot.classId}
                        </p>
                        <p className="text-[12px] text-muted-foreground tabular">
                          {slot.date.slice(8, 10)}/{slot.date.slice(5, 7)} · {slot.startTime} – {slot.endTime}
                        </p>
                      </div>
                      {slot.meetingLink && (
                        <a
                          href={slot.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-pill bg-primary-soft text-primary-ink text-[12px] font-semibold hover:bg-primary/15 transition"
                        >
                          <Video size={14} /> Vào lớp <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Học phí + đơn từ */}
            <div className="space-y-5">
              <Card>
                <CardHeader icon={<Receipt size={18} />} title="Học phí" />
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] text-muted-foreground">Còn phải nộp</span>
                    <span className={`text-lg font-extrabold tabular ${debt > 0 ? 'text-danger' : 'text-success'}`}>
                      {money(debt)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] text-muted-foreground">Buổi còn lại</span>
                    <span className="text-lg font-extrabold tabular text-foreground">{remaining}</span>
                  </div>
                  <LinkButton href="/student/tuition" variant="secondary" fullWidth icon={<Receipt size={16} />} className="block">
                    Chọn gói & thanh toán
                  </LinkButton>
                </div>
              </Card>

              <Card>
                <CardHeader
                  icon={<Inbox size={18} />}
                  title="Yêu cầu của tôi"
                  action={
                    <Link href="/student/schedule" className="text-[13px] font-semibold text-primary">
                      Gửi yêu cầu
                    </Link>
                  }
                />
                {pendingRequests.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    Bạn không có yêu cầu vắng mặt/đổi ca nào đang chờ duyệt.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {pendingRequests.slice(0, 3).map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 p-2.5 rounded-field bg-muted">
                        <span className="text-[13px] font-medium text-foreground truncate">
                          {r.type === 'DOI_CA' ? 'Đổi ca học' : 'Xin vắng mặt'}
                        </span>
                        <Badge tone="warning">Chờ duyệt</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* Sheet xin vắng mặt */}
          <Sheet
            isOpen={!!absenceSlot}
            onClose={() => {
              if (!requestSubmitting) setAbsenceSlot(null);
            }}
            title="Xin vắng mặt"
            description={
              absenceSlot
                ? absenceSlot.subject + ' • ' + absenceSlot.date + ' (' + absenceSlot.startTime + ' – ' + absenceSlot.endTime + ')'
                : undefined
            }
            size="sm"
            footer={
              <Button variant="primary" fullWidth loading={requestSubmitting} onClick={submitAbsence}>
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

          {/* Sheet đổi ca trong ngày */}
          <Sheet
            isOpen={!!swapSlot}
            onClose={() => {
              if (!swapLoading) setSwapSlot(null);
            }}
            title="Đổi ca trong ngày"
            description={
              swapSlot
                ? 'Chọn một ca khác cùng lớp trong ngày ' + swapSlot.date + ' để chuyển tạm thời.'
                : undefined
            }
            size="sm"
          >
            {swapSlot && (
              <div className="space-y-3">
                <div className="rounded-field bg-muted border border-line p-3 text-[13px] flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Ca hiện tại</span>
                  <span className="font-semibold tabular">
                    {swapSlot.startTime} – {swapSlot.endTime}
                  </span>
                </div>
                {swapTargets.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    Không có ca nào khác cùng lớp vào ngày này để đổi.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {swapTargets.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-field border border-line"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-foreground tabular">
                            {t.startTime} – {t.endTime}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">{t.subject}</p>
                        </div>
                        <Button
                          size="sm"
                          loading={swapLoading}
                          onClick={() => confirmSwap(t.id)}
                          icon={<ArrowRightLeft size={14} />}
                        >
                          Chọn
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Sheet>
        </main>
      </div>
    </RoleGuard>
  );
}
