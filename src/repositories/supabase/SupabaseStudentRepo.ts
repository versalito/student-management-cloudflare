import type { SupabaseClient } from '@supabase/supabase-js';
import type { Student } from '@/types/student';
import type { StudentPage, StudentPageQuery, ClassMembership, ClassMembershipQuery } from '../IRepository';
import { uniFilterToSql } from '@/lib/studentFilters';
import { mapStudentFromDb, mapStudentToDb } from './mappers';

export class SupabaseStudentRepo {
  constructor(private getClient: () => SupabaseClient | null) {}

  public async getStudentById(id: string): Promise<Student | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getStudentById(id);

    try {
      const { data: student, error } = await client
        .from('students')
        .select('*, class_students(class_id)')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (!student) return null;

      return mapStudentFromDb(student);
    } catch (err) {
      throw err;
    }
  }

  public async getStudentsByIds(ids: string[]): Promise<Student[]> {
    // Không có mã nào -> không mở round trip; `in()` rỗng sẽ trả toàn bảng.
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return [];

    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    // PostgREST nhận mã qua query string: 100 mã/lần giữ URL an toàn với danh
    // sách lớp lớn, vẫn chỉ là vài round trip song song.
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 100) {
      chunks.push(unique.slice(i, i + 100));
    }

    const rows = await Promise.all(
      chunks.map(async (chunk) => {
        const { data, error } = await client
          .from('students')
          .select('*, class_students(class_id)')
          .in('id', chunk);
        if (error) throw new Error(error.message);
        return data || [];
      })
    );

    return rows.flat().map(mapStudentFromDb);
  }

  public async getAllStudents(): Promise<Student[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllStudents();

    try {
      const { data: students, error } = await client
        .from('students')
        .select('*, class_students(class_id)');
      if (error) {
        throw new Error(error.message);
      }

      return (students || []).map(mapStudentFromDb);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Trang học viên: lọc `search` + `limit`/offset ở SQL, kèm tổng số dòng
   * (`count: 'exact'`) và danh sách lớp ghi danh embed trong cùng round trip.
   */
  public async getStudentsPage(query: StudentPageQuery = {}): Promise<StudentPage> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getStudentsPage(query);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(1000, Math.max(1, query.limit || 50));
    const search = (query.search || '').trim();
    const uniFilter = query.uni && query.uni !== 'ALL' ? uniFilterToSql(query.uni) : null;

    try {
      let q = client
        .from('students')
        .select('*, class_students(class_id)', { count: 'exact' });

      if (search) {
        // Bỏ ký tự phá cú pháp `or(...)` của PostgREST; `%` giữ nguyên làm wildcard.
        const safe = search.replace(/[,()]/g, ' ').trim();
        const pattern = `%${safe}%`;
        // `students` trên Supabase production không có cột `email` (schema drift);
        // thêm `email.ilike` vào `or()` sẽ làm cả request 400. UI chỉ tìm mã/tên/SĐT.
        q = q.or(`id.ilike.${pattern},name.ilike.${pattern},phone.ilike.${pattern}`);
      }

      if (query.status && query.status !== 'ALL') {
        q = q.eq('status', query.status);
      }

      // Phạm vi giáo viên: lọc ngay ở SQL để `count` và `range` vẫn đúng.
      if (query.studentIds) {
        if (query.studentIds.length === 0) {
          return { students: [], total: 0 };
        }
        q = q.in('id', query.studentIds);
      }

      if (query.uni === 'KHAC') {
        // "Khác" = chọn trường KHAC hoặc có nhập tên trường tự do.
        q = q.or('target_university.eq.KHAC,custom_university.not.is.null');
      } else if (uniFilter?.university) {
        q = q.eq('target_university', uniFilter.university);
        if (uniFilter.block) q = q.eq('exam_block', uniFilter.block);
      }

      q = q.order('id', { ascending: true });

      // `limit=all` là trang duy nhất nhưng vẫn có trần: không bao giờ đọc
      // không giới hạn, kể cả khi phía gọi xin "tất cả".
      const from = query.all ? 0 : (page - 1) * limit;
      q = q.range(from, from + limit - 1);

      const { data, error, count } = await q;

      if (error) {
        throw new Error(error.message);
      }

      return {
        students: (data || []).map(mapStudentFromDb),
        total: count ?? 0,
      };
    } catch (err) {
      throw err;
    }
  }

  public async getClassMemberships(query: ClassMembershipQuery = {}): Promise<ClassMembership[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getClassMemberships(query);

    try {
      let q = client.from('class_students').select('class_id, student_id');
      if (query.studentId) q = q.eq('student_id', query.studentId);

      const { data, error } = await q;
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map((row) => ({ classId: row.class_id, studentId: row.student_id }));
    } catch (err) {
      throw err;
    }
  }

  public async updateStudent(student: Student): Promise<Student> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateStudent(student);

    try {
      const row = mapStudentToDb(student);
      let { error: updateErr } = await client.from('students').update(row).eq('id', student.id);
      if (updateErr && updateErr.code === 'PGRST204') {
        const { home_town, grade_level, target_university, custom_university, exam_block, study_goal, facebook_url, other_notes, registered_date, total_sessions_in_month, attended_sessions_in_month, absent_sessions_in_month, remaining_sessions, ...legacyRow } = row;
        const retry = await client.from('students').update(legacyRow).eq('id', student.id);
        updateErr = retry.error;
      }
      if (updateErr) {
        throw new Error(updateErr.message);
      }

      await client.from('class_students').delete().eq('student_id', student.id);
      if (student.enrolledClassIds && student.enrolledClassIds.length > 0) {
        const relationRows = student.enrolledClassIds.map(cId => ({
          class_id: cId,
          student_id: student.id,
        }));
        await client.from('class_students').insert(relationRows);
      }

      return student;
    } catch (err) {
      throw err;
    }
  }

  public async createStudent(student: Student): Promise<Student> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createStudent(student);

    try {
      const row = mapStudentToDb(student);
      let { error: insertErr } = await client.from('students').insert(row);
      if (insertErr && insertErr.code === 'PGRST204') {
        const { home_town, grade_level, target_university, custom_university, exam_block, study_goal, facebook_url, other_notes, registered_date, total_sessions_in_month, attended_sessions_in_month, absent_sessions_in_month, remaining_sessions, ...legacyRow } = row;
        const retry = await client.from('students').insert(legacyRow);
        insertErr = retry.error;
      }
      if (insertErr) {
        throw new Error(insertErr.message);
      }

      if (student.enrolledClassIds && student.enrolledClassIds.length > 0) {
        const relationRows = student.enrolledClassIds.map(cId => ({
          class_id: cId,
          student_id: student.id,
        }));
        await client.from('class_students').insert(relationRows);
      }

      return student;
    } catch (err) {
      throw err;
    }
  }

  public async deleteStudent(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteStudent(id);

    try {
      const { error } = await client.from('students').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

}
