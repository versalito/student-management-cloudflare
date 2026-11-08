/** Trạng thái cửa sổ điểm danh do server tính. Máy đọc, không phụ thuộc chuỗi lý do. */
export type SessionWindowStatus = 'open' | 'not_open' | 'ended';

/** Trạng thái buổi học do server tính (nguồn duy nhất cho đồng hồ mở/đóng ca). */
export interface SessionStateSlot {
  id: string;
  classId: string;
  className?: string;
  sectionId?: string;
  date: string;
  startTime: string;
  endTime: string;
  meetingLink?: string;
  canCheckIn: boolean;
  window: SessionWindowStatus;
  reason: string;
  checkedIn?: { status: string; checkinTime?: string };
}

export interface StudentSessionState {
  today: string;
  now: string;
  current: SessionStateSlot | null;
  next: SessionStateSlot | null;
  /** Tối đa 5 buổi kế tiếp (đã sort) để dashboard không tự lọc/sắp xếp. */
  upcoming: SessionStateSlot[];
  todaySessions: SessionStateSlot[];
  checkedInToday: SessionStateSlot[];
}
