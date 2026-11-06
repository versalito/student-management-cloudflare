import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { BulkScheduleService } from '@/services/BulkScheduleService';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const {
      classIds,
      startDate,
      endDate,
      shiftId,
      startTime,
      endTime,
      scheduleDays,
      overwriteExisting = false,
      previewOnly = false,
    } = body;

    if (!classIds || !Array.isArray(classIds) || classIds.length === 0) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp danh sách classIds hoặc ["all"]' },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp ngày bắt đầu (startDate) và ngày kết thúc (endDate)' },
        { status: 400 }
      );
    }

    const bulkService = new BulkScheduleService(repo);
    const result = await bulkService.generateRecurringSlots({
      classIds,
      startDate,
      endDate,
      shiftId: shiftId ? Number(shiftId) : undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      scheduleDays: Array.isArray(scheduleDays) ? scheduleDays.map(Number) : undefined,
      overwriteExisting: Boolean(overwriteExisting),
      actorId,
      previewOnly: Boolean(previewOnly),
    });

    if (previewOnly) {
      return NextResponse.json({
        success: true,
        preview: true,
        message: `Xem trước: sẽ tạo ${result.summary.createdCount} ca mới, cập nhật ${result.summary.updatedCount} ca, bỏ qua ${result.summary.skippedCount} ca, ${result.summary.conflictCount} ca bị trùng lịch.`,
        ...result,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Sinh lịch thành công: đã tạo ${result.summary.createdCount} ca mới, cập nhật ${result.summary.updatedCount} ca, bỏ qua ${result.summary.skippedCount} ca, ${result.summary.conflictCount} ca bị xung đột.`,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Lỗi khi thực hiện sinh lịch hàng loạt' },
      { status: 500 }
    );
  }
}
