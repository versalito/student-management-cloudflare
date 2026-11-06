/**
 * Xác thực webhook ngân hàng.
 *
 * Trước đây `POST /api/payment/webhook` mở hoàn toàn: ai biết URL cũng có thể
 * gửi payload "đã chuyển 5.000.000đ cho TUI001" và hệ thống tự gạch nợ. Endpoint
 * này giờ bắt buộc phải có secret chia sẻ với cổng thanh toán.
 *
 * Chấp nhận 3 kiểu header phổ biến, so sánh theo thời gian hằng:
 *   - `x-webhook-secret: <secret>`            (cấu hình thủ công)
 *   - `authorization: Bearer <secret>`        (SePay)
 *   - `secure-token: <secret>`                (Casso)
 *
 * Fail closed: khi backend là Supabase mà chưa cấu hình `BANK_WEBHOOK_SECRET`
 * thì từ chối mọi request (500) thay vì cho qua. Chỉ môi trường local/test
 * (`DATA_SOURCE=local`) mới được bỏ trống secret.
 */

export const WEBHOOK_SECRET_ENV = 'BANK_WEBHOOK_SECRET';

/** Secret tối thiểu 32 ký tự — cùng chuẩn với SESSION_SECRET. */
const MIN_SECRET_LENGTH = 32;

function isLocalBackend(): boolean {
  return (process.env.DATA_SOURCE || 'supabase').toLowerCase() === 'local';
}

export type WebhookAuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

function headerSecret(request: Request): string | null {
  const direct = request.headers.get('x-webhook-secret');
  if (direct && direct.trim()) return direct.trim();

  const secureToken = request.headers.get('secure-token');
  if (secureToken && secureToken.trim()) return secureToken.trim();

  const auth = request.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  return null;
}

/** So sánh chuỗi theo thời gian hằng, không thoát sớm ở ký tự khác đầu tiên. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function verifyWebhookRequest(request: Request): WebhookAuthResult {
  const expected = (process.env[WEBHOOK_SECRET_ENV] || '').trim();

  if (!expected) {
    if (isLocalBackend()) return { ok: true };
    return {
      ok: false,
      status: 500,
      message: `Hệ thống chưa cấu hình ${WEBHOOK_SECRET_ENV}`,
    };
  }

  if (expected.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      status: 500,
      message: `${WEBHOOK_SECRET_ENV} quá ngắn (tối thiểu ${MIN_SECRET_LENGTH} ký tự)`,
    };
  }

  const provided = headerSecret(request);
  if (!provided || !timingSafeEqualString(provided, expected)) {
    return { ok: false, status: 401, message: 'Webhook không có hoặc sai secret' };
  }

  return { ok: true };
}
