import { NextResponse } from 'next/server';
import { AdminBankConfig, DEFAULT_BANK_CONFIG } from '@/types/bank';
import { repo } from '@/repositories';
import { authenticate } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const BANK_SETTING_KEY = 'admin_bank_config';

export async function GET(request: Request) {
  const auth = await authenticate(request, ['ADMIN', 'TEACHER', 'STUDENT']);
  if (auth.response) return auth.response;

  let bankConfig: AdminBankConfig;
  try {
    const stored = await repo.getAppSetting<AdminBankConfig>(BANK_SETTING_KEY);
    bankConfig = validateBankConfig(stored) ? stored! : { ...DEFAULT_BANK_CONFIG };
  } catch (err) {
    console.warn('[bank-settings] Không đọc được cấu hình ngân hàng, dùng mặc định:', err);
    bankConfig = { ...DEFAULT_BANK_CONFIG };
  }

  return NextResponse.json({
    success: true,
    bankConfig,
  });
}

export async function POST(request: Request) {
  const auth = await authenticate(request, ['ADMIN']);
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { bankId, bankName, accountNumber, accountName } = body;

    if (!bankId || !accountNumber || !accountName) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng cung cấp đầy đủ Mã ngân hàng, Số tài khoản và Tên chủ thẻ' },
        { status: 400 }
      );
    }

    const bankConfig: AdminBankConfig = {
      bankId: bankId.trim().toUpperCase(),
      bankName: bankName?.trim() || bankId.trim().toUpperCase(),
      accountNumber: accountNumber.trim(),
      accountName: accountName.trim().toUpperCase(),
    };

    // Lưu xuống cơ sở dữ liệu để mọi instance Worker và sau khi restart vẫn đồng bộ.
    await repo.setAppSetting(BANK_SETTING_KEY, bankConfig);

    return NextResponse.json({
      success: true,
      message: 'Cập nhật tài khoản ngân hàng nhận học phí thành công!',
      bankConfig,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Lỗi xử lý yêu cầu' },
      { status: 500 }
    );
  }
}

/** Chỉ chấp nhận cấu hình đủ 4 trường hợp lệ, tránh giá trị rác từ DB. */
function validateBankConfig(value: any): value is AdminBankConfig {
  return Boolean(
    value &&
    typeof value.bankId === 'string' && value.bankId.trim() !== '' &&
    typeof value.accountNumber === 'string' && value.accountNumber.trim() !== '' &&
    typeof value.accountName === 'string' && value.accountName.trim() !== '' &&
    typeof value.bankName === 'string'
  );
}
