import { NextResponse } from 'next/server';
import { withCacheHeader, withReferenceCache } from '@/lib/cache/referenceCache';
import { ShiftService } from '@/services/ShiftService';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;

  try {
    const result = await withReferenceCache('shifts', 'all', () => ShiftService.getAllShifts());
    return withCacheHeader(NextResponse.json({ success: true, shifts: result.value }), result.status);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const shiftId = body.shiftId !== undefined ? body.shiftId : body.id;
    const { startTime, endTime, name, isActive } = body;

    if (shiftId === undefined || !startTime || !endTime) {
      return NextResponse.json({ success: false, error: 'Thiếu shiftId, startTime hoặc endTime' }, { status: 400 });
    }

    const updated = await ShiftService.updateShift(Number(shiftId), {
      shiftId: Number(shiftId),
      startTime,
      endTime,
      name,
      isActive,
    }, false, { id: auth.user.id, name: auth.user.name, role: auth.user.role });

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy ca học' }, { status: 404 });
    }

    return NextResponse.json({ success: true, shift: updated, message: 'Cập nhật khung giờ ca học thành công' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    if (body.bulkShifts && Array.isArray(body.bulkShifts)) {
      const result = await ShiftService.bulkUpdateShifts(body.bulkShifts, body.syncFutureSlots ?? true, {
        id: auth.user.id,
        name: auth.user.name,
        role: auth.user.role,
      });
      return NextResponse.json({ success: true, ...result, message: 'Đã cập nhật hàng loạt khung giờ ca học' });
    }

    if (body.presetType) {
      const shifts = await ShiftService.applyPreset(body.presetType, {
        id: auth.user.id,
        name: auth.user.name,
        role: auth.user.role,
      });
      return NextResponse.json({ success: true, shifts, message: 'Đã áp dụng mẫu cấu hình thành công' });
    }

    const { shiftNumber, name, startTime, endTime, isActive } = body;
    if (!startTime || !endTime) {
      return NextResponse.json({ success: false, error: 'Vui lòng cung cấp giờ bắt đầu và kết thúc' }, { status: 400 });
    }

    const newShift = await ShiftService.createShift({
      shiftNumber: shiftNumber ? Number(shiftNumber) : undefined,
      name,
      startTime,
      endTime,
      isActive,
    }, { id: auth.user.id, name: auth.user.name, role: auth.user.role });
    return NextResponse.json({ success: true, shift: newShift, message: 'Thêm ca học mới thành công' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu mã ca học cần xóa' }, { status: 400 });
    }

    const ok = await ShiftService.deleteShift(Number(id), {
      id: auth.user.id,
      name: auth.user.name,
      role: auth.user.role,
    });
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy ca học cần xóa' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Đã xóa ca học thành công' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
