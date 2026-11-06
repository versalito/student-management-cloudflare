export type AuditAction = 
  | 'CREATE' 
  | 'UPDATE' 
  | 'UPDATE_STATUS' 
  | 'DELETE' 
  | 'LOGIN' 
  | 'LOGOUT' 
  | 'ATTENDANCE_CHECK' 
  | 'SCHEDULE_CHANGE' 
  | 'PAYMENT_PROCESS' 
  | 'PACKAGE_PURCHASE'
  | 'CANCEL_INVOICE'
  | 'REQUEST_DECIDE';

export interface AuditLog {
  id: string; // AUD0001..
  userId: string; // ID người thực hiện
  userName: string;
  userRole: string;
  action: AuditAction;
  targetResource: string; // 'SCHEDULE', 'ATTENDANCE', 'TUITION', etc.
  targetId: string;
  details: string; // Mô tả hành động bằng Tiếng Việt
  oldValue?: string;
  newValue?: string;
  ipAddress?: string;
  timestamp: string; // ISO String
}
