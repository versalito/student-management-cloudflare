import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { ScheduleSlot, TeacherCheckinStatus } from '@/types/schedule';
import { getTodayDateStr, getNowTimeStr, timeToMinutes } from '@/utils/date';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Số phút đầu ca được tính là đúng giờ. */
const ON_TIME_WINDOW_MINUTES = 15;
/** Mở chấm công sớm trước giờ vào ca. */
const EARLY_OPEN_MINUTES = 30;
/** Cho phép kết ca muộn hơn giờ kết thúc để giáo viên kịp chốt ca. */
const CHECKOUT_GRACE_MINUTES = 60;

/** Kiểm tra chuỗi giờ hợp lệ theo định dạng HH:mm (00:00 - 23:59). */
function isValidHHmm(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * GET /api/teacher-checkin?teacherId=GV001&month=2026-10
 * Trả về danh sách ca kèm trạng thái chấm công để dựng sổ chấm công.
 */
export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const teacherId = searchParams.get('teacherId');
    const month = searchParams.get('month');
    const date = searchParams.get('date');

    // Giáo viên chỉ xem chấm công của chính mình.
    if (auth.user.role === 'TEACHER' && !isSelfOrStaff(auth.user, teacherId)) {
      return NextResponse.json({ success: false, error: 'Không có quyền xem chấm công của giáo viên khác' }, { status: 403 });
    }

    let slots: ScheduleSlot[] = teacherId
      ? await repo.getScheduleSlotsByTeacherId(teacherId)
      : await repo.getAllScheduleSlots();

    if (month) slots = slots.filter((s) => s.date.startsWith(month));
    if (date) slots = slots.filter((s) => s.date === date);

    slots.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

    const checkedIn = slots.filter((s) => !!s.checkinTime).length;
    const late = slots.filter((s) => s.checkinStatus === 'Đi muộn').length;

    return NextResponse.json({
      success: true,
      slots,
      summary: { total: slots.length, checkedIn, late },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Lỗi tải sổ chấm công' }, { status: 500 });
  }
}

/**
 * POST /api/teacher-checkin
 * - action 'CHECKIN': giáo viên vào ca. Trong 15 phút đầu ca -> 'Đúng giờ', sau đó -> 'Đi muộn'.
 * - action 'CHECKOUT': giáo viên kết ca, ghi giờ ra.
 * - action 'ADMIN_SET': admin chấm bù / chỉnh tay cho bất kỳ ca nào.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const action = body.action || 'CHECKIN';
    const slotId = body.slotId;

    if (!slotId) {
      return NextResponse.json({ success: false, error: 'Thiếu mã ca dạy' }, { status: 400 });
    }

    const slot = await repo.getScheduleSlotById(slotId);
    if (!slot) {
      return NextResponse.json({ success: false, error: 'Ca dạy không tồn tại' }, { status: 404 });
    }

    if (slot.status === 'Đã hủy') {
      return NextResponse.json({ success: false, error: 'Ca dạy đã hủy, không thể chấm công' }, { status: 400 });
    }

    // --- Admin chấm bù / chỉnh tay ---
    if (action === 'ADMIN_SET') {
      if (auth.user.role !== 'ADMIN') {
        return NextResponse.json(
          { success: false, error: 'Chỉ quản trị viên được chấm công bù' },
          { status: 403 }
        );
      }
      const checkinTime = (body.checkinTime || '').trim();
      const checkoutTime = (body.checkoutTime || '').trim();
      if (checkinTime && !isValidHHmm(checkinTime)) {
        return NextResponse.json({ success: false, error: 'Giờ vào ca không hợp lệ (HH:mm)' }, { status: 400 });
      }
      if (checkoutTime && !isValidHHmm(checkoutTime)) {
        return NextResponse.json({ success: false, error: 'Giờ ra ca không hợp lệ (HH:mm)' }, { status: 400 });
      }
      if (checkoutTime && !checkinTime) {
        return NextResponse.json(
          { success: false, error: 'Cần có giờ vào ca trước khi ghi giờ ra ca' },
          { status: 400 }
        );
      }

      slot.checkinTime = checkinTime || undefined;
      slot.checkoutTime = checkoutTime || undefined;
      if (!checkinTime) {
        slot.checkinStatus = 'Chưa chấm công';
      } else {
        const startMins = timeToMinutes(slot.startTime);
        const inMins = timeToMinutes(checkinTime);
        slot.checkinStatus = inMins <= startMins + ON_TIME_WINDOW_MINUTES ? 'Đúng giờ' : 'Đi muộn';
      }
      slot.checkinMethod = 'ADMIN';
      slot.checkinNote = (body.note || '').trim() || undefined;
      // Ca chỉ được coi là hoàn thành khi đã có đủ giờ vào và giờ ra.
      if (checkinTime && checkoutTime && slot.status === 'Đã lên lịch') {
        slot.status = 'Đã hoàn thành';
      } else if (!checkinTime && slot.status === 'Đã hoàn thành') {
        // Xoá giờ vào ca thì ca quay lại trạng thái chưa hoàn thành.
        slot.status = 'Đã lên lịch';
      }

      const saved = await repo.updateScheduleSlot(slot);
      await repo.addAuditLog({
        userId: auth.user.id,
        userName: auth.user.name,
        userRole: auth.user.role,
        action: 'UPDATE',
        targetResource: 'SCHEDULE',
        targetId: slot.id,
        details:
          'Chấm công bù ca ' +
          slot.id +
          ' (' +
          slot.date +
          '): vào ' +
          (checkinTime || '—') +
          ', ra ' +
          (checkoutTime || '—'),
      });
      return NextResponse.json({ success: true, slot: saved });
    }

    // --- Giáo viên tự chấm công ---
    const teacherId = body.teacherId || auth.user.id;
    if (!teacherId) {
      return NextResponse.json({ success: false, error: 'Thiếu mã giáo viên' }, { status: 400 });
    }
    // Giáo viên chỉ tự chấm công cho ca của mình.
    if (!isSelfOrStaff(auth.user, teacherId)) {
      return NextResponse.json({ success: false, error: 'Không có quyền chấm công cho giáo viên khác' }, { status: 403 });
    }
    if (slot.teacherId !== teacherId) {
      return NextResponse.json(
        { success: false, error: 'Ca dạy này không thuộc phân công của bạn' },
        { status: 403 }
      );
    }

    const todayStr = getTodayDateStr();
    if (slot.date !== todayStr) {
      return NextResponse.json(
        { success: false, error: 'Chỉ chấm công được cho ca dạy hôm nay (' + todayStr + ')' },
        { status: 400 }
      );
    }

    const nowTimeStr = getNowTimeStr();
    const nowMins = timeToMinutes(nowTimeStr);
    const startMins = timeToMinutes(slot.startTime);
    const endMins = timeToMinutes(slot.endTime);
    const isOvernight = startMins > endMins;
    const endMinsWithGrace = endMins + CHECKOUT_GRACE_MINUTES;

    // Vào ca: chỉ mở trong khoảng ca học (sớm tối đa EARLY_OPEN_MINUTES).
    const inCheckinWindow = isOvernight
      ? nowMins >= startMins - EARLY_OPEN_MINUTES || nowMins <= endMins
      : nowMins >= startMins - EARLY_OPEN_MINUTES && nowMins <= endMins;

    // Kết ca: cho phép muộn hơn giờ kết thúc tối đa CHECKOUT_GRACE_MINUTES để giáo viên kịp chốt ca.
    const inCheckoutWindow = isOvernight
      ? nowMins >= startMins || nowMins <= endMinsWithGrace
      : nowMins >= startMins - EARLY_OPEN_MINUTES && nowMins <= endMinsWithGrace;

    if (action === 'CHECKIN' && !inCheckinWindow) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Chưa tới giờ chấm công. Ca học ' +
            slot.startTime +
            ' - ' +
            slot.endTime +
            ', hiện tại ' +
            nowTimeStr,
        },
        { status: 400 }
      );
    }

    if (action === 'CHECKOUT' && !inCheckoutWindow) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Ca học đã kết thúc quá lâu, không thể kết ca. Ca học ' +
            slot.startTime +
            ' - ' +
            slot.endTime +
            ', hiện tại ' +
            nowTimeStr,
        },
        { status: 400 }
      );
    }

    if (action === 'CHECKIN') {
      if (slot.checkinTime) {
        return NextResponse.json(
          { success: false, error: 'Bạn đã vào ca lúc ' + slot.checkinTime, slot },
          { status: 409 }
        );
      }
      const status: TeacherCheckinStatus =
        nowMins <= startMins + ON_TIME_WINDOW_MINUTES ? 'Đúng giờ' : 'Đi muộn';
      slot.checkinTime = nowTimeStr;
      slot.checkinStatus = status;
      slot.checkinMethod = 'TEACHER_SELF';
      if (body.note) slot.checkinNote = String(body.note).trim();

      const saved = await repo.updateScheduleSlot(slot);
      await repo.addAuditLog({
        userId: teacherId,
        userName: body.teacherName || teacherId,
        userRole: 'TEACHER',
        action: 'UPDATE',
        targetResource: 'SCHEDULE',
        targetId: slot.id,
        details: 'Giáo viên vào ca ' + slot.id + ' (' + status + ') lúc ' + nowTimeStr,
      });
      return NextResponse.json({ success: true, slot: saved, checkinStatus: status });
    }

    if (action === 'CHECKOUT') {
      if (!slot.checkinTime) {
        return NextResponse.json(
          { success: false, error: 'Bạn cần vào ca trước khi kết ca' },
          { status: 400 }
        );
      }
      if (slot.checkoutTime) {
        return NextResponse.json(
          { success: false, error: 'Ca này đã kết thúc lúc ' + slot.checkoutTime, slot },
          { status: 409 }
        );
      }
      slot.checkoutTime = nowTimeStr;
      if (slot.status === 'Đã lên lịch') slot.status = 'Đã hoàn thành';

      const saved = await repo.updateScheduleSlot(slot);
      await repo.addAuditLog({
        userId: teacherId,
        userName: body.teacherName || teacherId,
        userRole: 'TEACHER',
        action: 'UPDATE',
        targetResource: 'SCHEDULE',
        targetId: slot.id,
        details: 'Giáo viên kết ca ' + slot.id + ' lúc ' + nowTimeStr,
      });
      return NextResponse.json({ success: true, slot: saved });
    }

    return NextResponse.json({ success: false, error: 'Hành động không hợp lệ' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Lỗi chấm công' }, { status: 500 });
  }
}
