import { NextResponse } from 'next/server';
import { repo } from '@/repositories';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));

    const { logs, total } = await repo.getAuditLogsPage({
      search,
      limit,
      offset: (page - 1) * limit,
    });

    return NextResponse.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi khi tải nhật ký';
    return NextResponse.json({ logs: [], total: 0, error: message }, { status: 500 });
  }
}
