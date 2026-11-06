import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Webhook ngân hàng đã bị bỏ: hệ thống dùng thu học phí thủ công
 * (học sinh báo chuyển khoản, quản trị đối soát rồi xác nhận).
 * Giữ endpoint để trả 410 Gone thay vì 404 im lặng cho các tích hợp cũ.
 */
function gone() {
  return NextResponse.json(
    {
      error: 'Webhook thanh toán đã bị gỡ bỏ. Học sinh báo chuyển khoản trong mục Học phí, quản trị xác nhận thủ công.',
      code: 'GONE',
    },
    { status: 410 },
  );
}

export async function POST() {
  return gone();
}

export async function GET() {
  return gone();
}

export async function PUT() {
  return gone();
}
