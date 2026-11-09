import { bumpReferenceVersion, REFERENCE_CACHE_SCOPE } from '@/lib/cache/referenceCache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassEntity, ClassSection } from '@/types/classroom';
import type { StudentSlotSwap } from '@/types/schedule';
import { diffRoster } from '@/utils/rosterDiff';
import { mapClassFromDb, mapClassToDb, mapClassSectionFromDb, mapClassSectionToDb } from './mappers';

export class SupabaseClassRepo {
  constructor(private getClient: () => SupabaseClient | null) {}

  public async getAllClasses(): Promise<ClassEntity[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllClasses();

    try {
      // Một round trip: PostgREST embed bảng ghi danh vào lớp (FK class_students.class_id).
      const { data: classes, error } = await client
        .from('classes')
        .select('*, class_students(student_id)');
      if (error) {
        throw new Error(error.message);
      }

      return (classes || []).map(mapClassFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getClassById(id: string): Promise<ClassEntity | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassById(id);

    try {
      const { data: cls, error } = await client
        .from('classes')
        .select('*, class_students(student_id)')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (!cls) return null;

      return mapClassFromDb(cls);
    } catch (err) {
      throw err;
    }
  }

  public async getClassesByTeacherId(teacherId: string): Promise<ClassEntity[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassesByTeacherId(teacherId);

    try {
      const { data: classes, error } = await client
        .from('classes')
        .select('*, class_students(student_id)')
        .eq('teacher_id', teacherId);

      if (error) {
        throw new Error(error.message);
      }

      return (classes || []).map(mapClassFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getClassesByStudentId(studentId: string): Promise<ClassEntity[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassesByStudentId(studentId);

    try {
      const { data: classStudents, error: csErr } = await client
        .from('class_students')
        .select('class_id')
        .eq('student_id', studentId);

      if (csErr) {
        throw new Error(csErr.message);
      }

      if (!classStudents || classStudents.length === 0) return [];
      const classIds = classStudents.map((cs: any) => cs.class_id);

      const { data: classes, error: clsErr } = await client
        .from('classes')
        .select('*, class_students(student_id)')
        .in('id', classIds);

      if (clsErr) {
        throw new Error(clsErr.message);
      }

      return (classes || []).map(mapClassFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async updateClass(classEntity: ClassEntity): Promise<ClassEntity> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateClass(classEntity);

    try {
      const row = mapClassToDb(classEntity);
      const { error: updateErr } = await client.from('classes').update(row).eq('id', classEntity.id);
      if (updateErr) {
        throw new Error(updateErr.message);
      }

      // Ghi danh theo lớp: chỉ áp phần chênh lệch. Xoá-rồi-chèn toàn bộ roster
      // làm cả lớp mất sạch học sinh nếu bước chèn lỗi (mạng/RLS), và tạo cửa sổ
      // bảng class_students trống — TKB/điểm danh đọc đúng lúc đó sẽ thấy lớp
      // không có ai. Chỉ ghi delta thì các dòng không đổi vẫn nguyên.
      const { data: currentRows, error: rosterErr } = await client
        .from('class_students')
        .select('student_id')
        .eq('class_id', classEntity.id);
      if (rosterErr) throw new Error(rosterErr.message);

      const { toAdd, toRemove } = diffRoster(
        classEntity.studentIds || [],
        (currentRows || []).map((r: any) => r.student_id)
      );

      if (toRemove.length > 0) {
        // delete().in() không đụng các dòng Roster khác của lớp khác.
        const { error: delErr } = await client
          .from('class_students')
          .delete()
          .eq('class_id', classEntity.id)
          .in('student_id', toRemove);
        if (delErr) throw new Error(delErr.message);
      }
      if (toAdd.length > 0) {
        const { error: insErr } = await client
          .from('class_students')
          .insert(toAdd.map((stId) => ({ class_id: classEntity.id, student_id: stId })));
        if (insErr) throw new Error(insErr.message);
      }

      return classEntity;
    } catch (err) {
      throw err;
    }
  }

  public async deleteClass(id: string): Promise<boolean> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('classes').delete().eq('id', id);
    if (error) {
      console.error('Lỗi khi xóa lớp học trên Supabase:', error);
      throw new Error(error.message);
    }
    return true;
  }

  public async createClass(classEntity: ClassEntity): Promise<ClassEntity> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createClass(classEntity);

    try {
      const row = mapClassToDb(classEntity);
      const { error: insertErr } = await client.from('classes').insert(row);
      if (insertErr) {
        throw new Error(insertErr.message);
      }

      if (classEntity.studentIds && classEntity.studentIds.length > 0) {
        const relationRows = classEntity.studentIds.map(stId => ({
          class_id: classEntity.id,
          student_id: stId,
        }));
        await client.from('class_students').insert(relationRows);
      }

      return classEntity;
    } catch (err) {
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // CLASS SECTIONS
  // --------------------------------------------------------------------------

  public async getClassSections(classId: string): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .eq('class_id', classId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async getSectionById(id: string): Promise<ClassSection | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapClassSectionFromDb(data) : null;
  }

  public async getSectionsByStudentId(studentId: string): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    // Một round trip: inner join lọc thẳng ca mà học sinh tham gia, kèm thứ riêng
    // của học sinh đó trong ca (class_section_students.schedule_days).
    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students!inner(student_id, schedule_days)')
      .eq('class_section_students.student_id', studentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async getSectionsByTeacherId(teacherId: string): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async getAllClassSections(): Promise<ClassSection[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { data, error } = await client
      .from('class_sections')
      .select('*, class_section_students(student_id, schedule_days)')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapClassSectionFromDb);
  }

  public async createClassSection(section: ClassSection): Promise<ClassSection> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    await client.from('class_sections').insert(mapClassSectionToDb(section));
    await this.replaceSectionStudents(section.id, section.studentIds || []);
    return section;
  }

  public async updateClassSection(section: ClassSection): Promise<ClassSection> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    const { error } = await client.from('class_sections').update(mapClassSectionToDb(section)).eq('id', section.id);
    if (error) throw new Error(error.message);

    if (section.studentIds !== undefined) {
      await this.replaceSectionStudents(section.id, section.studentIds);
    }
    return section;
  }

  public async deleteClassSection(id: string): Promise<boolean> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { error } = await client.from('class_sections').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  }

  public async addStudentToSection(sectionId: string, studentId: string, scheduleDays?: number[]): Promise<void> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    // Upsert giu nguyen schedule_days cu neu khong truyen tham so moi.
    const payload: any = { section_id: sectionId, student_id: studentId };
    if (scheduleDays !== undefined) payload.schedule_days = scheduleDays;
    const { error } = await client.from('class_section_students').upsert(payload, { onConflict: 'section_id,student_id' });
    if (error) throw new Error(error.message);
  }

  public async removeStudentFromSection(sectionId: string, studentId: string): Promise<void> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { error } = await client.from('class_section_students').delete().eq('section_id', sectionId).eq('student_id', studentId);
    if (error) throw new Error(error.message);
  }

  public async getSectionStudentScheduleDays(sectionId: string): Promise<Record<string, number[]>> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { data, error } = await client
      .from('class_section_students')
      .select('student_id, schedule_days')
      .eq('section_id', sectionId);
    if (error) throw new Error(error.message);
    const result: Record<string, number[]> = {};
    for (const row of data || []) {
      result[row.student_id] = Array.isArray(row.schedule_days) ? row.schedule_days : [];
    }
    return result;
  }

  public async getSlotSwaps(filter: { studentId?: string; toSlotId?: string; fromSlotId?: string; date?: string; status?: 'ACTIVE' | 'CANCELLED' }): Promise<StudentSlotSwap[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    let query = client.from('student_slot_swaps').select('*');
    if (filter.studentId) query = query.eq('student_id', filter.studentId);
    if (filter.toSlotId) query = query.eq('to_slot_id', filter.toSlotId);
    if (filter.fromSlotId) query = query.eq('from_slot_id', filter.fromSlotId);
    if (filter.date) query = query.eq('swap_date', filter.date);
    if (filter.status) query = query.eq('status', filter.status);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map((row: any) => ({
      id: row.id,
      studentId: row.student_id,
      fromSlotId: row.from_slot_id,
      toSlotId: row.to_slot_id,
      date: row.swap_date,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  public async createSlotSwap(swap: StudentSlotSwap): Promise<StudentSlotSwap> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { data, error } = await client.from('student_slot_swaps').insert({
      student_id: swap.studentId,
      from_slot_id: swap.fromSlotId,
      to_slot_id: swap.toSlotId,
      swap_date: swap.date,
      status: swap.status || 'ACTIVE',
    }).select().single();
    if (error) throw new Error(error.message);
    return {
      id: data.id,
      studentId: data.student_id,
      fromSlotId: data.from_slot_id,
      toSlotId: data.to_slot_id,
      date: data.swap_date,
      status: data.status,
      createdAt: data.created_at,
    };
  }

  private async replaceSectionStudents(sectionId: string, studentIds: string[]): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    await client.from('class_section_students').delete().eq('section_id', sectionId);
    if (studentIds.length > 0) {
      const rows = studentIds.map(stId => ({ section_id: sectionId, student_id: stId }));
      const { error } = await client.from('class_section_students').insert(rows);
      if (error) throw new Error(error.message);
    }
  }

}
