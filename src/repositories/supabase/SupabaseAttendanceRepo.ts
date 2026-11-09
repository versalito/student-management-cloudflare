import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceRecord } from '@/types/attendance';
import { mapAttendanceRecordFromDb, mapAttendanceRecordToDb } from './mappers';

export class SupabaseAttendanceRepo {
  constructor(private getClient: () => SupabaseClient | null) {}

  public async getAttendanceBySlotId(slotId: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceBySlotId(slotId);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('schedule_slot_id', slotId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getAttendanceByStudentId(studentId: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceByStudentId(studentId);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('student_id', studentId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getAttendanceByClassId(classId: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceByClassId(classId);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('class_id', classId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAttendanceByDate(date);

    try {
      const { data, error } = await client
        .from('attendance_records')
        .select('*')
        .eq('date', date);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAttendanceRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Đọc sổ điểm danh của cả tháng bằng một query (`date >= đầu tháng`, `< đầu tháng sau`).
   *
   * Bản cũ lặp từng lớp và gọi `getAttendanceByClassId`, tức N+1 round trip cho
   * bảng thống kê chuyên cần.
   */
  public async getAttendanceByMonth(month: string): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const mon = Number(monthStr);
    const start = `${month}-01`;
    const nextStart = mon === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

    const { data, error } = await client
      .from('attendance_records')
      .select('*')
      .gte('date', start)
      .lt('date', nextStart);
    if (error) throw new Error(error.message);
    return (data || []).map(mapAttendanceRecordFromDb);
  }

  public async saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // saveAttendanceRecord(record);

    try {
      const row = mapAttendanceRecordToDb(record);
      let res = await client
        .from('attendance_records')
        .upsert(row, { onConflict: 'schedule_slot_id,student_id' });

      if (res.error && res.error.message && res.error.message.includes('schema cache')) {
        // Fallback tương thích nếu bảng Supabase chưa chạy migration các cột mới
        const compatRow = { ...row };
        delete compatRow.original_slot_id;
        delete compatRow.makeup_reason;
        delete compatRow.method;
        res = await client.from('attendance_records').upsert(compatRow, { onConflict: 'schedule_slot_id,student_id' });
      }

      if (res.error) {
        throw new Error(res.error.message);
      }
      return record;
    } catch (err) {
      throw err;
    }
  }

  public async saveAttendanceBatch(records: AttendanceRecord[]): Promise<AttendanceRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // saveAttendanceBatch(records);

    try {
      const rows = records.map(mapAttendanceRecordToDb);
      const { error } = await client
        .from('attendance_records')
        .upsert(rows, { onConflict: 'schedule_slot_id,student_id' });

      if (error) {
        throw new Error(error.message);
      }
      return records;
    } catch (err) {
      throw err;
    }
  }

}
