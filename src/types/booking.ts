/**
 * Đăng ký buổi lẻ: học sinh đặt một buổi cụ thể của lớp đang mở, không theo ca dài hạn.
 *
 * Bất biến: `(studentId, slotId)` là duy nhất; huỷ là đổi `status`, không xoá dòng
 * (giữ vết để tính lịch sử và tránh đặt lại trùng).
 */
export type SessionBookingStatus = 'Đã đăng ký' | 'Đã hủy' | 'Đã học';

export interface StudentSessionBooking {
  id: string;
  studentId: string;
  slotId: string;
  status: SessionBookingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionBookingFilter {
  studentId?: string;
  slotId?: string;
  slotIds?: string[];
  /** Chỉ lấy các trạng thái này; bỏ trống = mọi trạng thái. */
  statuses?: SessionBookingStatus[];
}
