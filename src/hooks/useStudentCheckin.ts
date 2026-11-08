'use client';

import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { AttendanceRecord } from '@/types/attendance';
import type { SessionStateSlot, SessionWindowStatus, StudentSessionState } from '@/types/session';

interface BadgeOverride {
  status: string;
  time: string;
}

export type CheckinState =
  | { type: 'done'; status: string; time: string }
  | { type: 'open' }
  | { type: 'closed'; reason: string; window: SessionWindowStatus };

interface Options {
  studentId?: string;
  /** Bản ghi điểm danh đã tải (chỉ dùng làm fallback khi session-state chưa tới). */
  attendance?: AttendanceRecord[];
}

export function indexSessionState(state: StudentSessionState | null): Record<string, SessionStateSlot> {
  const map: Record<string, SessionStateSlot> = {};
  [...(state?.todaySessions || []), state?.current, state?.next].forEach((s) => {
    if (s?.id) map[s.id] = s;
  });
  return map;
}

/**
 * Điểm danh tự phục vụ của học sinh, dùng chung cho dashboard và thời khoá biểu.
 * Trạng thái nút luôn lấy từ `session-state` do server tính (Asia/Saigon),
 * client không tự so đồng hồ máy.
 */
export function useStudentCheckin({ studentId, attendance = [] }: Options) {
  const toast = useToast();
  const [sessionState, setSessionState] = useState<StudentSessionState | null>(null);
  const [badges, setBadges] = useState<Record<string, BadgeOverride>>({});
  const [checking, setChecking] = useState<string | null>(null);

  const sessionMap = useMemo(() => indexSessionState(sessionState), [sessionState]);

  const refreshSessionState = useCallback(async () => {
    if (!studentId) return;
    try {
      const r = await fetch(`/api/student/session-state?studentId=${studentId}`);
      if (r.ok) setSessionState(await r.json());
    } catch {
      /* giữ trạng thái cũ, lần điểm danh kế tiếp sẽ đồng bộ lại */
    }
  }, [studentId]);

  const checkinState = useCallback(
    (slot: { id: string }): CheckinState => {
      const fresh = badges[slot.id];
      if (fresh) return { type: 'done', status: fresh.status, time: fresh.time };

      const rec = attendance.find((a) => a.scheduleSlotId === slot.id && a.studentId === studentId);
      if (rec) return { type: 'done', status: rec.status, time: rec.checkinTime || '' };

      const srv = sessionMap[slot.id];
      if (srv) {
        if (srv.checkedIn) {
          return { type: 'done', status: srv.checkedIn.status, time: srv.checkedIn.checkinTime || '' };
        }
        if (srv.canCheckIn) return { type: 'open' };
        return { type: 'closed', reason: srv.reason, window: srv.window };
      }
      // Chưa có dữ liệu server cho buổi này: coi như chưa mở, không đoán giờ.
      return { type: 'closed', reason: 'Chưa tới giờ', window: 'not_open' };
    },
    [attendance, badges, sessionMap, studentId]
  );

  const handleCheckin = useCallback(
    async (slot: { id: string }) => {
      if (!studentId || checking) return;
      setChecking(slot.id);
      try {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'STUDENT_CHECKIN',
            studentId,
            scheduleSlotId: slot.id,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          const rec = data.record;
          setBadges((p) => ({
            ...p,
            [slot.id]: { status: rec?.status || 'Có mặt', time: rec?.checkinTime || '' },
          }));
          toast.success(
            `Điểm danh xong: ${rec?.status || 'Có mặt'}${rec?.checkinTime ? ' lúc ' + rec.checkinTime : ''}`
          );
          void refreshSessionState();
        } else if (res.status === 409 && data.record) {
          setBadges((p) => ({
            ...p,
            [slot.id]: { status: data.record.status, time: data.record.checkinTime || '' },
          }));
          toast.info('Ca này đã được điểm danh rồi.');
        } else {
          toast.error(data.error || 'Điểm danh chưa thành công, bạn thử lại nhé.');
        }
      } catch {
        toast.error('Không kết nối được, bạn thử lại nhé.');
      } finally {
        setChecking(null);
      }
    },
    [checking, refreshSessionState, studentId, toast]
  );

  return {
    sessionState,
    setSessionState,
    sessionMap,
    badges,
    checking,
    checkinState,
    handleCheckin,
    refreshSessionState,
  };
}
