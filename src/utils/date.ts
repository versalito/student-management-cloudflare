/**
 * Trả về chuỗi ngày hiện tại định dạng YYYY-MM-DD theo múi giờ Việt Nam (Asia/Saigon / GMT+7)
 * Đảm bảo đồng nhất tuyệt đối dù server chạy ở Cloudflare Workers (UTC), Local hay Docker.
 */
export function getTodayDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' }).format(new Date());
}

/**
 * Trả về chuỗi giờ hiện tại định dạng HH:mm theo múi giờ Việt Nam (Asia/Saigon / GMT+7)
 */
export function getNowTimeStr(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Saigon',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

/**
 * Chuyển chuỗi HH:mm thành số phút từ đầu ngày
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

/**
 * Đổi số phút từ đầu ngày thành chuỗi giờ HH:mm (hỗ trợ > 24h, ví dụ 25:30).
 */
export function minutesTo24h(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Chuẩn hóa chuỗi giờ về HH:mm (bỏ phần giây nếu có, ví dụ "18:30:00" -> "18:30").
 * Dùng khi DB lưu schedule_slots.start_time/end_time dạng HH:mm:ss.
 */
export function formatTimeHM(timeStr?: string): string {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

/**
 * Trả về chuỗi YYYY-MM-DD cho một Date cụ thể, theo múi giờ Việt Nam (Asia/Saigon).
 * Dùng để cộng/trừ ngày an toàn không bị lệch múi giờ UTC.
 */
export function getTodayDateStrByDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon' }).format(d);
}

/**
 * Thứ trong tuần theo quy ước dự án: 2 = Thứ 2 ... 7 = Thứ 7, 8 = Chủ Nhật.
 * Chuỗi ngày YYYY-MM-DD là ngày lịch, không phải mốc thời gian: tách năm/tháng/ngày
 * rồi tra cứu bằng UTC nên kết quả giống nhau ở mọi múi giờ máy chạy
 * (Cloudflare Workers luôn là UTC, còn Node local là Asia/Saigon).
 */
export function dateToDayOfWeek(dateStr: string): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0: CN, 1: T2 ... 6: T7
  return jsDay === 0 ? 8 : jsDay + 1;
}
