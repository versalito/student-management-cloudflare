/**
 * Bản rút gọn của `Student` cho các màn hình chỉ cần hiển thị tên/SĐT
 * (lịch học, điểm danh). Giữ payload bootstrap nhỏ thay vì gửi cả hồ sơ.
 */
export interface StudentLite {
  id: string;
  name: string;
  phone: string;
  avatarUrl?: string;
}

export type StudentStatus = 'Đang học' | 'Tạm dừng' | 'Đã nghỉ học' | 'Bảo lưu' | 'Đã tốt nghiệp';

export type ExamBlock = 'KHOI_V' | 'KHOI_H';

export interface Student {
  id: string; // ST001..ST400, 26xxx
  name: string;
  phone: string;
  dateOfBirth?: string;
  gender?: 'Nam' | 'Nữ';
  address?: string;
  status: StudentStatus;
  enrolledClassIds: string[]; // Danh sách mã lớp đang tham gia
  avatarUrl?: string;
  parentPhone?: string;
  assignmentUrl?: string;
  createdAt: string;

  // Trường chuyên biệt luyện thi Kiến trúc & Mỹ thuật (Mr. Thuyết)
  homeTown?: string;               // Quê quán
  gradeLevel?: string;             // Lớp mấy: Lớp 10, Lớp 11, Lớp 12, Thí sinh tự do...
  targetUniversity?: string;        // HAU, HUCE, MTCN, NUAE, HNUE, VNUFA, HOU, VNU-SIS, KHAC
  customUniversity?: string;       // Tên trường tự do nếu chọn KHAC
  examBlock?: ExamBlock;           // Khối V hoặc Khối H (Tất cả các trường đều có)
  studyGoal?: string;              // Mục đích học: Thi ĐH, Năng khiếu...
  facebookUrl?: string;            // Link Facebook
  otherNotes?: string;             // Trường thông tin khác (Ghi chú tự do của học viên)
  registeredDate?: string;         // Ngày đăng ký bắt đầu học

  // Thống kê buổi học & Đếm số buổi còn lại
  totalSessionsInMonth?: number;    // Tổng số buổi gói tháng (VD: 8, 12)
  attendedSessionsInMonth?: number; // Số buổi đã học
  absentSessionsInMonth?: number;   // Số buổi nghỉ cần học bù
  remainingSessions?: number;       // SỐ BUỔI CÒN LẠI TRONG THÁNG (Cho phép tùy chỉnh thủ công)
}
