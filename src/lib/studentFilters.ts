/**
 * Bộ lọc "mục tiêu trường + khối thi" dùng chung cho Admin > Học viên.
 *
 * `ui` là giá trị mà dropdown gửi lên (`?uni=HAU_V`...). Cùng một bảng mã được
 * dùng ở hai nơi:
 *  - `matchesUniFilter`  : lọc trong bộ nhớ (LocalRepository, seed data, test).
 *  - `uniFilterToSql`    : dịch sang điều kiện PostgREST để lọc ở DB, tránh đọc
 *                          toàn bộ bảng students rồi lọc bằng JS.
 */
export type UniFilterCode =
  | 'HAU_V' | 'HAU_H' | 'HUCE_V' | 'HUCE_H' | 'MTCN_V' | 'MTCN_H'
  | 'NUAE' | 'HNUE' | 'VNUFA' | 'HOU' | 'VNU-SIS' | 'KHAC';

const UNI_FILTER_CODES = new Set<string>([
  'HAU_V', 'HAU_H', 'HUCE_V', 'HUCE_H', 'MTCN_V', 'MTCN_H',
  'NUAE', 'HNUE', 'VNUFA', 'HOU', 'VNU-SIS', 'KHAC',
]);

/** Mã lọc có hợp lệ không (mã lạ thì bỏ qua lọc ở cả hai tầng dữ liệu). */
export function isUniFilterCode(filter: string): boolean {
  return UNI_FILTER_CODES.has(filter);
}

export interface UniFilterSubject {
  targetUniversity?: string;
  examBlock?: string;
  customUniversity?: string;
}

export function matchesUniFilter(s: UniFilterSubject, filter: string): boolean {
  if (!isUniFilterCode(filter)) return true;
  switch (filter) {
    case 'HAU_V': return s.targetUniversity === 'HAU' && s.examBlock === 'KHOI_V';
    case 'HAU_H': return s.targetUniversity === 'HAU' && s.examBlock === 'KHOI_H';
    case 'HUCE_V': return s.targetUniversity === 'HUCE' && s.examBlock === 'KHOI_V';
    case 'HUCE_H': return s.targetUniversity === 'HUCE' && s.examBlock === 'KHOI_H';
    case 'MTCN_V': return s.targetUniversity === 'MTCN' && s.examBlock === 'KHOI_V';
    case 'MTCN_H': return s.targetUniversity === 'MTCN' && s.examBlock === 'KHOI_H';
    case 'NUAE': return s.targetUniversity === 'NUAE';
    case 'HNUE': return s.targetUniversity === 'HNUE';
    case 'VNUFA': return s.targetUniversity === 'VNUFA';
    case 'HOU': return s.targetUniversity === 'HOU';
    case 'VNU-SIS': return s.targetUniversity === 'VNU-SIS';
    case 'KHAC': return s.targetUniversity === 'KHAC' || !!s.customUniversity;
    default: return true;
  }
}

/**
 * Dịch mã lọc sang điều kiện PostgREST. Trả về `null` khi không lọc gì.
 * Trường hợp `KHAC` cần `or(...)` nên được xử lý riêng bởi caller.
 */
export function uniFilterToSql(filter: string): { university?: string; block?: string } | null {
  if (!filter || filter === 'ALL' || !isUniFilterCode(filter)) return null;
  const parts = filter.split('_');
  const block = parts.length === 2 ? parts.pop()! : undefined;
  const university = parts.join('_');
  if (!university) return null;
  return { university, block: block ? `KHOI_${block}` : undefined };
}
