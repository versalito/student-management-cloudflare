import type { ClassEntity } from '@/types/classroom';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassRequest } from '@/types/schedule';
import type { AuditLog } from '@/types/audit';
import type { AuditLogPage, AuditLogPageQuery } from '../IRepository';
import type { AppNotification } from '@/types/notification';
import {
  mapClassRequestFromDb,
  mapClassRequestToDb,
  mapAuditLogFromDb,
  mapAuditLogToDb,
  mapNotificationFromDb,
  mapNotificationToDb,
} from './mappers';

export class SupabaseAuditRepo {
  constructor(private getClient: () => SupabaseClient | null, private getClassesByTeacherId: (teacherId: string) => Promise<ClassEntity[]>) {}

  public async getAppSetting<T = any>(key: string): Promise<T | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { data, error } = await client.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? (data.value as T) : null;
  }

  public async setAppSetting(key: string, value: any): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    const { error } = await client
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }


  public async getAllRequests(): Promise<ClassRequest[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllRequests();

    try {
      const { data, error } = await client.from('class_requests').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapClassRequestFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getRequestById(id: string): Promise<ClassRequest | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getRequestById(id);

    try {
      const { data, error } = await client
        .from('class_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return data ? mapClassRequestFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getRequestsByStudentId(studentId: string): Promise<ClassRequest[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getRequestsByStudentId(studentId);

    try {
      const { data, error } = await client
        .from('class_requests')
        .select('*')
        .eq('student_id', studentId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapClassRequestFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getRequestsByTeacherId(teacherId: string): Promise<ClassRequest[]> {
    const teacherClasses = await this.getClassesByTeacherId(teacherId);
    if (!teacherClasses || teacherClasses.length === 0) return [];
    const classIds = teacherClasses.map(c => c.id);

    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getRequestsByTeacherId(teacherId);

    try {
      const { data, error } = await client
        .from('class_requests')
        .select('*')
        .in('class_id', classIds);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapClassRequestFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async createRequest(request: ClassRequest): Promise<ClassRequest> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createRequest(request);

    try {
      const row = mapClassRequestToDb(request);
      const { error } = await client.from('class_requests').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return request;
    } catch (err) {
      throw err;
    }
  }

  public async updateRequest(request: ClassRequest): Promise<ClassRequest> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateRequest(request);

    try {
      const row = mapClassRequestToDb(request);
      const { error } = await client
        .from('class_requests')
        .update(row)
        .eq('id', request.id);

      if (error) {
        throw new Error(error.message);
      }
      return request;
    } catch (err) {
      throw err;
    }
  }

  public async deleteRequest(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteRequest(id);

    try {
      const { error } = await client.from('class_requests').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }


  // --------------------------------------------------------------------------

  public async getAllAuditLogs(): Promise<AuditLog[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllAuditLogs();

    try {
      const { data, error } = await client
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapAuditLogFromDb);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Trang nhật ký: chỉ các cột UI dùng, lọc + phân trang ở SQL.
   */
  public async getAuditLogsPage(query: AuditLogPageQuery = {}): Promise<AuditLogPage> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAuditLogsPage(query);

    const limit = Math.min(500, Math.max(1, query.limit || 50));
    const offset = Math.max(0, query.offset || 0);
    const search = (query.search || '').trim();

    try {
      let q = client
        .from('audit_logs')
        .select('id, user_id, user_name, user_role, action, target_resource, target_id, details, timestamp', { count: 'exact' });

      if (search) {
        const safe = search.replace(/[,()]/g, ' ').trim();
        const pattern = `%${safe}%`;
        q = q.or(`user_name.ilike.${pattern},user_id.ilike.${pattern},action.ilike.${pattern},details.ilike.${pattern}`);
      }

      if (query.action && query.action !== 'ALL') {
        q = q.eq('action', query.action);
      }

      const { data, error, count } = await q
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        throw new Error(error.message);
      }

      return {
        logs: (data || []).map(mapAuditLogFromDb),
        total: count ?? 0,
      };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Đếm số bản ghi theo từng loại thao tác. Dùng HEAD + count nên chỉ trả về số,
   * không kéo nội dung nhật ký.
   */
  public async getAuditActionCounts(actions: string[]): Promise<Record<string, number>> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

    try {
      const entries = await Promise.all(
        actions.map(async (action) => {
          const { count, error } = await client
            .from('audit_logs')
            .select('id', { count: 'exact', head: true })
            .eq('action', action);
          if (error) throw new Error(error.message);
          return [action, count ?? 0] as const;
        })
      );

      const { count: totalCount, error: totalError } = await client
        .from('audit_logs')
        .select('id', { count: 'exact', head: true });
      if (totalError) throw new Error(totalError.message);

      return { ...Object.fromEntries(entries), ALL: totalCount ?? 0 };
    } catch (err) {
      throw err;
    }
  }

  public async addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // addAuditLog(log);

    try {
      const id = `AUD${Date.now().toString().slice(-6)}`;
      const timestamp = new Date().toISOString();
      const fullLog: AuditLog = { ...log, id, timestamp };
      const row = mapAuditLogToDb(fullLog);
      const { error } = await client.from('audit_logs').insert(row);

      if (error) {
        throw new Error(error.message);
      }
      return fullLog;
    } catch (err) {
      throw err;
    }
  }


  public async getNotifications(userId?: string, role?: string): Promise<AppNotification[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getNotifications(userId, role);

    try {
      let query = client.from('notifications').select('*');
      if (userId && role) {
        query = query.or(`recipient_role.eq.ALL,recipient_role.eq.${role},recipient_user_id.eq.${userId}`);
      } else if (role) {
        query = query.or(`recipient_role.eq.ALL,recipient_role.eq.${role}`);
      } else if (userId) {
        query = query.or(`recipient_role.eq.ALL,recipient_user_id.eq.${userId}`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapNotificationFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async addNotification(notification: Omit<AppNotification, 'id' | 'createdAt'>): Promise<AppNotification> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // addNotification(notification);

    try {
      const id = `NOTIF_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const createdAt = new Date().toISOString();
      const fullNotif: AppNotification = { ...notification, id, createdAt };
      const row = mapNotificationToDb(fullNotif);

      const { error } = await client.from('notifications').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return fullNotif;
    } catch (err) {
      throw err;
    }
  }

  public async deleteNotification(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteNotification(id);

    try {
      const { error } = await client.from('notifications').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  public async markNotificationAsRead(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // markNotificationAsRead(id);

    try {
      const { error } = await client
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

  public async markAllNotificationsAsRead(userId?: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // markAllNotificationsAsRead(userId);

    try {
      let query = client.from('notifications').update({ is_read: true });
      if (userId) {
        query = query.or(`recipient_user_id.eq.${userId},recipient_role.eq.ALL`);
      } else {
        query = query.neq('id', '');
      }

      const { error } = await query;
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }


  public async resetData(): Promise<void> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }

    const tables = [
      'audit_logs',
      'notifications',
      'attendance_records',
      'student_session_bookings',
      'class_requests',
      'tuition_invoices',
      'teacher_payroll_periods',
      'schedule_slots',
      'class_students',
      'classes',
      'students',
      'teachers',
      'users',
    ];

    for (const table of tables) {
      const { error } = await client.from(table).delete().neq('id', '___PLACEHOLDER___');
      if (error) {
        throw new Error(`Khong the xoa du lieu bang ${table}: ${error.message}`);
      }
    }
  }

}
