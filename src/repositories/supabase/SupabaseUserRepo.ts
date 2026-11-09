import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@/types/auth';
import { mapUserFromDb, mapUserToDb, quotePgValue } from './mappers';

export class SupabaseUserRepo {
  constructor(private getClient: () => SupabaseClient | null) {}

  public async getUserById(id: string): Promise<User | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getUserById(id);

    try {
      const clean = id.trim();
      // Tra cứu chính xác nên dùng `eq`, không dùng `ilike`: id người dùng gõ vào
      // `?id=` từng chứa được `%` (khớp mọi tài khoản) và `,`/`)` (chèn thêm điều
      // kiện vào `or(...)`, hoặc làm PostgREST trả 400). Giá trị được bọc nháy kép
      // theo cú pháp PostgREST nên `,` và `)` bên trong là dữ liệu, không phải cú pháp.
      const quoted = quotePgValue(clean);
      const { data, error } = await client
        .from('users')
        .select('*')
        .or(`id.eq.${quoted},username.eq.${quoted}`)
        .limit(1);

      if (error) {
        throw new Error(error.message);
      }

      const row = (data || [])[0];
      return row ? mapUserFromDb(row) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getUserByUsername(username: string): Promise<User | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getUserByUsername(username);

    try {
      const clean = username.trim();
      // Cùng lý do như `getUserById`: tra cứu chính xác, giá trị được quote.
      const quoted = quotePgValue(clean);
      const { data, error } = await client
        .from('users')
        .select('*')
        .or(`username.eq.${quoted},id.eq.${quoted}`)
        .limit(1);

      if (error) {
        throw new Error(error.message);
      }

      const row = (data || [])[0];
      return row ? mapUserFromDb(row) : null;
    } catch (err) {
      throw err;
    }
  }

  public async getAllUsers(): Promise<User[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllUsers();

    try {
      const { data, error } = await client.from('users').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapUserFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async updateUser(user: User): Promise<User> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateUser(user);

    try {
      const row = mapUserToDb(user);
      const { error } = await client.from('users').update(row).eq('id', user.id);
      if (error) {
        throw new Error(error.message);
      }
      return user;
    } catch (err) {
      throw err;
    }
  }

  public async createUser(user: User): Promise<User> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // createUser(user);

    try {
      const row = mapUserToDb(user);
      const { error } = await client.from('users').insert(row);
      if (error) {
        throw new Error(error.message);
      }
      return user;
    } catch (err) {
      throw err;
    }
  }

  public async deleteUser(id: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // deleteUser(id);

    try {
      const { error } = await client.from('users').delete().eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw err;
    }
  }

}
