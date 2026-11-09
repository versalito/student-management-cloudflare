import { bumpReferenceVersion, REFERENCE_CACHE_SCOPE } from '@/lib/cache/referenceCache';
import type { ClassSection } from '@/types/classroom';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleSlot, TimeShift } from '@/types/schedule';
import type { ScheduleSlotQuery, ScheduleSlotWithClassName } from '../IRepository';
import type { SessionBookingFilter, StudentSessionBooking } from '@/types/booking';
import { dateToDayOfWeek } from '@/utils/date';
import {
  mapScheduleSlotFromDb,
  mapScheduleSlotToDb,
  mapSessionBookingFromDb,
  mapSessionBookingToDb,
  isMissingBookingsTable,
  BOOKINGS_TABLE_MISSING_MESSAGE,
} from './mappers';

export class SupabaseScheduleRepo {
  constructor(private getClient: () => SupabaseClient | null, private getSectionsByStudentId: (studentId: string) => Promise<ClassSection[]>) {}

  public async getSessionBookings(filter: SessionBookingFilter = {}): Promise<StudentSessionBooking[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    if (filter.slotIds && filter.slotIds.length === 0) return [];

    try {
      let q = client
        .from('student_session_bookings')
        .select('id, student_id, slot_id, status, created_at, updated_at')
        .order('created_at', { ascending: true });

      if (filter.studentId) q = q.eq('student_id', filter.studentId);
      if (filter.slotId) q = q.eq('slot_id', filter.slotId);
      if (filter.slotIds) q = q.in('slot_id', filter.slotIds);
      if (filter.statuses) q = q.in('status', filter.statuses);

      const { data, error } = await q;
      if (error) {
        if (isMissingBookingsTable(error)) return [];
        throw new Error(error.message);
      }
      return (data || []).map(mapSessionBookingFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async createSessionBooking(booking: StudentSessionBooking): Promise<StudentSessionBooking> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('student_session_bookings')
      .insert({ ...mapSessionBookingToDb(booking), id: booking.id })
      .select('id, student_id, slot_id, status, created_at, updated_at')
      .single();
    if (error) throw new Error(isMissingBookingsTable(error) ? BOOKINGS_TABLE_MISSING_MESSAGE : error.message);
    return mapSessionBookingFromDb(data);
  }

  public async updateSessionBooking(booking: StudentSessionBooking): Promise<StudentSessionBooking> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('student_session_bookings')
      .update(mapSessionBookingToDb(booking))
      .eq('id', booking.id)
      .select('id, student_id, slot_id, status, created_at, updated_at')
      .single();
    if (error) throw new Error(isMissingBookingsTable(error) ? BOOKINGS_TABLE_MISSING_MESSAGE : error.message);
    return mapSessionBookingFromDb(data);
  }


  public async getAllScheduleSlots(): Promise<ScheduleSlot[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllScheduleSlots();

    try {
      const { data, error } = await client.from('schedule_slots').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapScheduleSlotFromDb);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Số lớn nhất trong các mã `SCHxxxx`.
   *
   * Không thể `order by id desc limit 1` vì so sánh chuỗi xếp `SCH9999` sau
   * `SCH10000`. Không dùng RPC `max_schedule_slot_number()` nữa: hàm đó chưa
   * được tạo trên DB production (PostgREST trả PGRST202) nên mọi lần tạo lịch
   * đều 500, trong khi code không thể tự tạo hàm (REST không cho DDL).
   *
   * Cách thuần REST: gom theo độ dài phần số. Trong cùng một độ dài, thứ tự
   * chuỗi trùng thứ tự số, nên chỉ cần `order=id.desc&limit=10` cho mỗi độ dài
   * và lấy mã khớp `^SCH\d{n}$` lớn nhất. Xét độ dài giảm dần: mã nhiều chữ số
   * luôn lớn hơn mã ít chữ số, nên dừng ngay ở độ dài đầu tiên có kết quả.
   */
  public async getMaxScheduleSlotNumber(): Promise<number> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    for (let digits = 10; digits >= 3; digits--) {
      const pattern = `SCH${'_'.repeat(digits)}`;
      const { data, error } = await client
        .from('schedule_slots')
        .select('id')
        .like('id', pattern)
        .order('id', { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);

      let maxForLength = 0;
      const re = new RegExp(`^SCH(\\d{${digits}})$`, 'i');
      for (const row of data || []) {
        // `_` trong LIKE khớp cả ký tự không phải số, nên vẫn phải lọc lại.
        const match = re.exec(String((row as any).id || ''));
        if (match) maxForLength = Math.max(maxForLength, Number(match[1]));
      }
      if (maxForLength > 0) return maxForLength;
    }
    return 0;
  }

  /**
   * Truy vấn ca học có lọc/giới hạn cột. Chỉ đọc các dòng khớp điều kiện
   * (index `idx_schedule_slots_date`, `(class_id, date)`) thay vì cả bảng.
   */
  public async getScheduleSlotsQuery(query: ScheduleSlotQuery = {}): Promise<ScheduleSlotWithClassName[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsQuery(query);

    try {
      let q = client
        .from('schedule_slots')
        .select('id, class_id, section_id, teacher_id, date, shift_id, start_time, end_time, subject, topic, meeting_link, status, classes(name, subject, meeting_link, start_time, end_time)');

      if (query.date) q = q.eq('date', query.date);
      if (query.dateFrom) q = q.gte('date', query.dateFrom);
      if (query.dateTo) q = q.lte('date', query.dateTo);
      if (query.ids) q = q.in('id', query.ids);
      if (query.classId) q = q.eq('class_id', query.classId);
      if (query.classIds) q = q.in('class_id', query.classIds);
      if (query.teacherId) q = q.eq('teacher_id', query.teacherId);
      if (query.sectionIds && query.sectionIds.length > 0) {
        const sectionFilter = `section_id.in.(${query.sectionIds.map(encodeURIComponent).join(',')})`;
        if (query.includeUnsectioned && query.classIds && query.classIds.length > 0) {
          // Buổi cũ chưa gán ca vẫn phải hiện cho học sinh của lớp đó.
          const legacyFilter = `and(section_id.is.null,class_id.in.(${query.classIds.map(encodeURIComponent).join(',')}))`;
          q = q.or(`${sectionFilter},${legacyFilter}`);
        } else {
          q = q.in('section_id', query.sectionIds);
        }
      }
      if (query.excludeCancelled) q = q.neq('status', 'Đã hủy');

      const { data, error } = await q;
      if (error) {
        throw new Error(error.message);
      }

      return (data || []).map((row) => {
        const slot = mapScheduleSlotFromDb(row);
        const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
        return {
          ...slot,
          subject: slot.subject || cls?.subject || cls?.name || '',
          meetingLink: slot.meetingLink || cls?.meeting_link || '',
          className: cls?.name || undefined,
        };
      });
    } catch (err) {
      throw err;
    }
  }

  
  // Time Shifts
  public async getAllTimeShifts(): Promise<TimeShift[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllTimeShifts();

    try {
      const { data, error } = await client.from('time_shifts').select('*').order('id', { ascending: true });
      if (error) {
        throw new Error(error.message);
      }
      // Bảng rỗng là trạng thái hợp lệ (chưa cấu hình ca) — trả mảng rỗng, không
      // thay bằng seed của LocalRepository.
      return (data || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        startTime: String(r.start_time).substring(0, 5),
        endTime: String(r.end_time).substring(0, 5),
        durationHours: Number(r.duration_hours) || 2.0,
        isActive: r.is_active ?? true
      }));
    } catch (err) {
      throw err;
    }
  }

  public async getTimeShiftById(id: number): Promise<TimeShift | null> {
    const all = await this.getAllTimeShifts();
    return all.find(s => s.id === id) || null;
  }

  public async createTimeShift(shift: TimeShift): Promise<TimeShift> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createTimeShift(shift);

    try {
      const { error } = await client.from('time_shifts').upsert({
        id: shift.id,
        name: shift.name,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_hours: shift.durationHours || 2.0,
        is_active: shift.isActive ?? true,
      });
      if (error) {
        throw new Error(error.message);
      }
      return shift;
    } catch (err) {
      throw err;
    }
  }

  public async updateTimeShift(shift: TimeShift): Promise<TimeShift> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateTimeShift(shift);

    try {
      const { error } = await client.from('time_shifts').update({
        name: shift.name,
        start_time: shift.startTime,
        end_time: shift.endTime,
        duration_hours: shift.durationHours || 2.0,
        is_active: shift.isActive ?? true,
      }).eq('id', shift.id);
      if (error) {
        throw new Error(error.message);
      }
      return shift;
    } catch (err) {
      throw err;
    }
  }

  public async deleteTimeShift(id: number): Promise<boolean> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteTimeShift(id);

    try {
      const { error } = await client.from('time_shifts').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  public async getScheduleSlotById(id: string): Promise<ScheduleSlot | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotById(id);

    try {
      const { data, error } = await client
        .from('schedule_slots')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return data ? mapScheduleSlotFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getScheduleSlotsByTeacherId(teacherId: string): Promise<ScheduleSlot[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsByTeacherId(teacherId);

    try {
      const { data, error } = await client
        .from('schedule_slots')
        .select('*')
        .eq('teacher_id', teacherId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapScheduleSlotFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getScheduleSlotsByClassId(classId: string): Promise<ScheduleSlot[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsByClassId(classId);

    try {
      const { data, error } = await client
        .from('schedule_slots')
        .select('*')
        .eq('class_id', classId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapScheduleSlotFromDb);
    } catch (err) {
      throw err;
    }
  }

 public async getScheduleSlotsByStudentId(studentId: string): Promise<ScheduleSlot[]> {
   // Học sinh chỉ thấy các buổi thuộc ca mà mình tham gia.
   const studentSections = await this.getSectionsByStudentId(studentId);
   const classIds = [...new Set(studentSections.map(s => s.classId))];
   const sectionIds = [...new Set(studentSections.map(s => s.id))];
   if (classIds.length === 0) return [];

   const client = this.getClient();
   if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getScheduleSlotsByStudentId(studentId);

   try {
     const { data, error } = await client
       .from('schedule_slots')
       .select('*')
       .in('class_id', classIds);

     if (error) {
       throw new Error(error.message);
     }
    const sectionSet = new Set(sectionIds);
    // Thứ riêng của từng học sinh trong từng ca: chỉ thấy buổi thuộc thứ mình đã chọn.
    // Dữ liệu đã được nạp sẵn trong getSectionsByStudentId (studentScheduleDays),
    // nên không cần gọi thêm query cho từng ca (tránh N+1).
    const studentDaysBySection = new Map<string, number[]>();
    for (const sec of studentSections) {
      studentDaysBySection.set(sec.id, sec.studentScheduleDays?.[studentId] || []);
    }
    return (data || [])
      .map(mapScheduleSlotFromDb)
      .filter(s => {
        // Nếu buổi đã gán ca, học sinh chỉ thấy ca mình tham gia; buổi cũ chưa gán ca vẫn thấy được.
        if (s.sectionId) return sectionSet.has(s.sectionId);
        return true;
      })
      .filter(s => {
        if (!s.sectionId) return true;
        const days = studentDaysBySection.get(s.sectionId) || [];
        // Mảng rỗng = theo đúng lịch ca (không lọc thêm).
        if (days.length === 0) return true;
        const dow = dateToDayOfWeek(s.date);
        return dow !== null && days.includes(dow);
      });
  } catch (err) {
     throw err;
   }
 }

  public async createScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createScheduleSlot(slot);

    try {
      const row = mapScheduleSlotToDb(slot);
      const { error } = await client.from('schedule_slots').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return slot;
    } catch (err) {
      throw err;
    }
  }

  public async updateScheduleSlot(slot: ScheduleSlot): Promise<ScheduleSlot> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateScheduleSlot(slot);

    try {
      const row = mapScheduleSlotToDb(slot);
      const { error } = await client
        .from('schedule_slots')
        .update(row)
        .eq('id', slot.id);

      if (error) {
        throw new Error(error.message);
      }
      return slot;
    } catch (err) {
      throw err;
    }
  }

  public async createScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    if (!slots || slots.length === 0) return [];
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const rows = slots.map(mapScheduleSlotToDb);
    const { error } = await client.from('schedule_slots').insert(rows);
    if (error) {
      throw new Error(error.message);
    }
    return slots;
  }

  public async updateScheduleSlotsBatch(slots: ScheduleSlot[]): Promise<ScheduleSlot[]> {
    if (!slots || slots.length === 0) return [];
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const rows = slots.map(mapScheduleSlotToDb);
    const { error } = await client.from('schedule_slots').upsert(rows, { onConflict: 'id' });
    if (error) {
      throw new Error(error.message);
    }
    return slots;
  }

}
