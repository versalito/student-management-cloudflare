import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { authenticate, isSelfOrStaff } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const requestedUserId = searchParams.get('userId') || undefined;
  const requestedRole = searchParams.get('role') || undefined;

  // Học viên **và giáo viên** chỉ xem thông báo của chính mình; chỉ ADMIN được
  // xem theo người nhận/vai trò. Trước đây TEACHER nằm trong nhóm "staff" nên
  // gọi trần là đọc được thông báo của mọi người và `?userId=<khác>` cũng mở.
  if (auth.user.role !== 'ADMIN' && !isSelfOrStaff(auth.user, requestedUserId)) {
    return NextResponse.json({ error: 'Không có quyền xem thông báo của người khác' }, { status: 403 });
  }

  const notifications = await repo.getNotifications(
    auth.user.role === 'ADMIN' ? requestedUserId : auth.user.id,
    auth.user.role === 'ADMIN' ? requestedRole : auth.user.role,
  );
  return NextResponse.json({ notifications });
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { action, id, userId, role, title, message, type = 'INFO', link, recipientRole = 'ALL', recipientUserId } = body;

    // Đánh dấu đã đọc 1 thông báo
    if (action === 'MARK_READ' && id) {
      // Chỉ chủ thông báo (hoặc ADMIN) được đánh dấu đã đọc. TEACHER trước đây
      // nằm trong nhóm "staff" nên đánh dấu đọc được thông báo của học viên.
      if (auth.user.role !== 'ADMIN') {
        const own = await repo.getNotifications(auth.user.id, auth.user.role);
        if (!own.some((n) => n.id === id)) {
          return NextResponse.json({ error: 'Không có quyền với thông báo này' }, { status: 403 });
        }
      }
      await repo.markNotificationAsRead(id);
      return NextResponse.json({ success: true, message: 'Đã đánh dấu thông báo là đã đọc' });
    }

    // Đánh dấu đã đọc tất cả
    if (action === 'MARK_ALL_READ') {
      if (!isSelfOrStaff(auth.user, userId)) {
        return NextResponse.json({ error: 'Không có quyền đánh dấu thông báo của người khác' }, { status: 403 });
      }
      await repo.markAllNotificationsAsRead(auth.user.id);
      return NextResponse.json({ success: true, message: 'Đã đánh dấu tất cả là đã đọc' });
    }

    // Tạo thông báo mới (Admin hoặc Hệ thống)
    if (title && message) {
      if (auth.user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Chỉ quản trị viên được phát thông báo' }, { status: 403 });
      }
      const created = await repo.addNotification({
        title,
        message,
        type,
        link,
        recipientRole,
        recipientUserId,
        isRead: false,
      });

      await repo.addAuditLog({
        action: 'CREATE',
        userId: auth.user.id,
        userName: auth.user.name,
        userRole: auth.user.role,
        targetResource: 'NOTIFICATION',
        targetId: created.id,
        details: `Phát thông báo: "${title}" tới đối tượng [${recipientRole}]`,
      });

      return NextResponse.json({ success: true, notification: created });
    }

    return NextResponse.json({ error: 'Yêu cầu không hợp lệ' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lỗi xử lý thông báo' }, { status: 500 });
  }
}

/** ADMIN xoá hẳn một thông báo (dọn thông báo kiểm thử). */
export async function DELETE(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get('id');
    if (!id && request.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = await request.json();
        id = body.id;
      } catch {
        // body rỗng
      }
    }
    if (!id) {
      return NextResponse.json({ error: 'Thiếu id thông báo cần xoá' }, { status: 400 });
    }

    await repo.deleteNotification(id);
    await repo.addAuditLog({
      userId: auth.user.id,
      userName: auth.user.name,
      userRole: auth.user.role,
      action: 'DELETE',
      targetResource: 'NOTIFICATION',
      targetId: id,
      details: `Xoá thông báo ${id}`,
    });

    return NextResponse.json({ success: true, message: `Đã xoá thông báo ${id}` });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Lỗi khi xoá thông báo' }, { status: 500 });
  }
}
