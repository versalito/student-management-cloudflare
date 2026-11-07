export interface ClassEntity {
  id: string; // CLS01..CLS30
  code?: string; // Deprecated: mã lớp đã bị loại bỏ, giữ nullable để tương thích dữ liệu cũ
  name: string;
  subject: string;
  teacherId: string; // GV001..
  studentIds: string[]; // ST001..
  tuitionFee: number; // Học phí/học viên cho khóa này
  scheduleDays: number[]; // 2, 3, 4, 5, 6, 7, 8 (Thứ 2 đến Chủ Nhật)
  shiftId?: number; // 1, 2, 3, 4, 5 (optional/legacy)
  startTime?: string; // Format HH:mm ví dụ '18:30'
  endTime?: string;   // Format HH:mm ví dụ '20:30'
  isRecurring?: boolean; // Mặc định true: Lớp chạy xuyên suốt liên tục
  meetingLink?: string; // Link phòng học online (Google Meet, Zoom...)
  status: 'Đang mở' | 'Sắp khai giảng' | 'Đã kết thúc';
  // Chỉ có ở phản hồi dành cho học viên: `studentIds` bị bỏ, chỉ còn số lượng.
  studentCount?: number;
}

/** Một ca học riêng trong một lớp (lớp có thể có nhiều ca). */
export interface ClassSection {
  id: string;            // SEC_...
  classId: string;       // Lớp chứa ca này
  name: string;          // Tên ca, VD "Ca 1 (08:00 - 10:00)"
  shiftId?: number;      // Liên kết time_shifts
  startTime?: string;    // HH:mm
  endTime?: string;      // HH:mm
  scheduleDays: number[]; // Các thứ học
  teacherId?: string;
  isActive: boolean;
  studentIds?: string[];  // Danh sách học sinh thuộc ca (nạp khi cần)
  // Thứ riêng từng học sinh trong ca: studentId -> danh sách thứ (2..8). Rỗng = theo đủ lịch ca.
  studentScheduleDays?: Record<string, number[]>;
  // Chỉ có ở phản hồi dành cho học viên: ca này có học viên đang hỏi hay không.
  isMine?: boolean;
  studentCount?: number;
  createdAt?: string;
  updatedAt?: string;
}
