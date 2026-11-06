export interface AdminBankConfig {
  bankId: string;       // Mã ngân hàng theo VietQR: MB, VCB, TCB, VPB, ACB, TPB, BIDV, CTG, etc.
  bankName: string;     // Tên hiển thị: Ngân hàng Quân Đội (MBBank)
  accountNumber: string;// Số tài khoản
  accountName: string;  // Tên chủ tài khoản: NGUYEN VAN A - ADMIN
}

export interface BankOption {
  id: string;
  name: string;
  shortName: string;
}

export const SUPPORTED_BANKS: BankOption[] = [
  { id: 'MB', name: 'Ngân hàng Quân Đội (MBBank)', shortName: 'MBBank' },
  { id: 'VCB', name: 'Ngân hàng Ngoại Thương (Vietcombank)', shortName: 'Vietcombank' },
  { id: 'TCB', name: 'Ngân hàng Kỹ Thương (Techcombank)', shortName: 'Techcombank' },
  { id: 'VPB', name: 'Ngân hàng Việt Nam Thịnh Vượng (VPBank)', shortName: 'VPBank' },
  { id: 'ACB', name: 'Ngân hàng Á Châu (ACB)', shortName: 'ACB' },
  { id: 'BIDV', name: 'Ngân hàng Đầu tư và Phát triển VN (BIDV)', shortName: 'BIDV' },
  { id: 'CTG', name: 'Ngân hàng Công Thương (VietinBank)', shortName: 'VietinBank' },
  { id: 'TPB', name: 'Ngân hàng Tiên Phong (TPBank)', shortName: 'TPBank' },
  { id: 'STB', name: 'Ngân hàng Sài Gòn Thương Tín (Sacombank)', shortName: 'Sacombank' },
  { id: 'VIB', name: 'Ngân hàng Quốc Tế (VIB)', shortName: 'VIB' },
  { id: 'OCB', name: 'Ngân hàng Phương Đông (OCB)', shortName: 'OCB' },
  { id: 'VBA', name: 'Ngân hàng Nông nghiệp & PTNT (Agribank)', shortName: 'Agribank' },
];

export const DEFAULT_BANK_CONFIG: AdminBankConfig = {
  bankId: 'MB',
  bankName: 'Ngân hàng Quân Đội (MBBank)',
  accountNumber: '0987654321',
  accountName: 'NGUYEN VAN A - ADMIN',
};
