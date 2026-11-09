import type { SupabaseClient } from '@supabase/supabase-js';
import type { Teacher } from '@/types/teacher';
import { bumpReferenceVersion, REFERENCE_CACHE_SCOPE } from '@/lib/cache/referenceCache';
import { mapTeacherFromDb, mapTeacherToDb } from './mappers';

export class SupabaseTeacherRepo {
  constructor(private getClient: () => SupabaseClient | null) {}

  public async getTeacherById(id: string): Promise<Teacher | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getTeacherById(id);

    try {
      const { data: teacher, error } = await client
        .from('teachers')
        .select('*, classes(id)')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (!teacher) return null;

      const assignedClassIds = (teacher.classes || []).map((c: { id: string }) => c.id);
      return mapTeacherFromDb({ ...teacher, assignedClassIds });
    } catch (err) {
      throw err;
    }
  }

  public async getAllTeachers(): Promise<Teacher[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllTeachers();

    try {
      const { data: teachers, error } = await client
        .from('teachers')
        .select('*, classes(id)');
      if (error) {
        throw new Error(error.message);
      }

      return (teachers || []).map((t: { classes?: { id: string }[] }) =>
        mapTeacherFromDb({ ...t, assignedClassIds: (t.classes || []).map(c => c.id) })
      );
    } catch (err) {
      throw err;
    }
  }

  public async updateTeacher(teacher: Teacher): Promise<Teacher> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateTeacher(teacher);

    try {
      const row = mapTeacherToDb(teacher);
      const { error } = await client.from('teachers').update(row).eq('id', teacher.id);
      if (error) {
        throw new Error(error.message);
      }
      return teacher;
    } catch (err) {
      throw err;
    }
  }

  public async createTeacher(teacher: Teacher): Promise<Teacher> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createTeacher(teacher);

    try {
      const row = mapTeacherToDb(teacher);
      const { error } = await client.from('teachers').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return teacher;
    } catch (err) {
      throw err;
    }
  }

  public async deleteTeacher(id: string): Promise<boolean> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteTeacher(id);

    try {
      // 1. Tháo gỡ ràng buộc trong classes và schedule_slots trước khi xóa
      await client.from('classes').update({ teacher_id: null }).eq('teacher_id', id);
      await client.from('schedule_slots').update({ teacher_id: null }).eq('teacher_id', id);

      // 2. Xóa trong bảng teachers
      const { error } = await client.from('teachers').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }

      // 3. Xóa user tương ứng
      await client.from('users').delete().eq('id', id);
      return true;
    } catch (err) {
      throw err;
    }
  }

}
