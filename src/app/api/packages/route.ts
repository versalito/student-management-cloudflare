import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { withCacheHeader, withReferenceCache } from '@/lib/cache/referenceCache';
import { SessionPackage } from '@/types/package';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN','TEACHER','STUDENT']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const result = await withReferenceCache('packages', 'all', () => repo.getAllSessionPackages());
    const packages = activeOnly ? result.value.filter((p) => p.isActive) : result.value;
    return withCacheHeader(NextResponse.json({ success: true, packages }), result.status);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const { name, sessionCount, price, isActive = true, description } = body;

    if (!name || !sessionCount || sessionCount <= 0 || price === undefined || price < 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Vui lòng cung cấp đầy đủ tên gói, số buổi học (> 0) và giá tiền (>= 0).' 
      }, { status: 400 });
    }

    const id = body.id || `PKG${sessionCount}_${Date.now().toString().slice(-4)}`;

    const newPkg: SessionPackage = {
      id,
      name: name.trim(),
      sessionCount: Number(sessionCount),
      price: Number(price),
      isActive: Boolean(isActive),
      description: description ? description.trim() : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = await repo.createSessionPackage(newPkg);

    await repo.addAuditLog({
      action: 'CREATE',
      userId: actorId,
      userName: actorName,
      userRole: 'ADMIN',
      targetResource: 'PACKAGE',
      targetId: created.id,
      details: `Tạo gói buổi học [${created.id}] "${created.name}" - ${created.sessionCount} buổi, ${created.price.toLocaleString('vi-VN')} đ`,
    });

    return NextResponse.json({ success: true, package: created }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;
  const actorId = auth.user.id;
  const actorName = auth.user.name;

  try {
    const body = await request.json();
    const { id, name, sessionCount, price, isActive, description } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu mã gói (id)' }, { status: 400 });
    }

    const existing = await repo.getSessionPackageById(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: `Không tìm thấy gói buổi học với mã ${id}` }, { status: 404 });
    }

    if (name !== undefined) existing.name = name.trim();
    if (sessionCount !== undefined) existing.sessionCount = Number(sessionCount);
    if (price !== undefined) existing.price = Number(price);
    if (isActive !== undefined) existing.isActive = Boolean(isActive);
    if (description !== undefined) existing.description = description ? description.trim() : undefined;
    existing.updatedAt = new Date().toISOString();

    const updated = await repo.updateSessionPackage(existing);

    await repo.addAuditLog({
      action: 'UPDATE',
      userId: actorId,
      userName: actorName,
      userRole: 'ADMIN',
      targetResource: 'PACKAGE',
      targetId: updated.id,
      details: `Cập nhật gói buổi học [${updated.id}] "${updated.name}" - ${updated.sessionCount} buổi, ${updated.price.toLocaleString('vi-VN')} đ, Trạng thái: ${updated.isActive ? 'Bật' : 'Tắt'}`,
    });

    return NextResponse.json({ success: true, package: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const actorId = auth.user.id;
    const actorName = searchParams.get('actorName') || 'Quản trị viên';

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu tham số mã gói (id)' }, { status: 400 });
    }

    const existing = await repo.getSessionPackageById(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: `Không tìm thấy gói buổi học với mã ${id}` }, { status: 404 });
    }

    await repo.deleteSessionPackage(id);

    await repo.addAuditLog({
      action: 'DELETE',
      userId: actorId,
      userName: actorName,
      userRole: 'ADMIN',
      targetResource: 'PACKAGE',
      targetId: id,
      details: `Xóa gói buổi học [${id}] "${existing.name}"`,
    });

    return NextResponse.json({ success: true, message: `Đã xóa gói ${id}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
