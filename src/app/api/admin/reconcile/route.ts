import { NextResponse } from 'next/server';
import { repo } from '@/repositories';
import { ProfileReconcileService } from '@/services/ProfileReconcileService';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/reconcile — bổ sung hồ sơ students/teachers còn thiếu.
 * Gọi thủ công khi cần (hoặc qua `npm run db:reconcile`); không chạy trong GET.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const service = new ProfileReconcileService(repo);
    const result = await service.reconcile();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi đối soát hồ sơ';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
