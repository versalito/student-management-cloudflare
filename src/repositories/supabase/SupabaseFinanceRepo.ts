import { bumpReferenceVersion, REFERENCE_CACHE_SCOPE } from '@/lib/cache/referenceCache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionPackage } from '@/types/package';
import type { TuitionInvoice, PayrollRecord } from '@/types/finance';
import {
  mapSessionPackageFromDb,
  mapSessionPackageToDb,
  mapTuitionInvoiceFromDb,
  mapTuitionInvoiceToDb,
  mapPayrollRecordFromDb,
  mapPayrollRecordToDb,
} from './mappers';

export class SupabaseFinanceRepo {
  constructor(private getClient: () => SupabaseClient | null) {}

  // --------------------------------------------------------------------------

  // Session Packages
  public async getAllSessionPackages(): Promise<SessionPackage[]> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { data, error } = await client
      .from('session_packages')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      throw new Error(error.message);
    }
    return (data || []).map(mapSessionPackageFromDb);
  }

  public async getSessionPackageById(id: string): Promise<SessionPackage | null> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { data, error } = await client.from('session_packages').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return data ? mapSessionPackageFromDb(data) : null;
  }

  public async createSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('session_packages').insert(mapSessionPackageToDb(pkg));
    if (error) {
      throw new Error(error.message);
    }
    return pkg;
  }

  public async updateSessionPackage(pkg: SessionPackage): Promise<SessionPackage> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('session_packages').update(mapSessionPackageToDb(pkg)).eq('id', pkg.id);
    if (error) {
      throw new Error(error.message);
    }
    return pkg;
  }

  public async deleteSessionPackage(id: string): Promise<boolean> {
    bumpReferenceVersion(REFERENCE_CACHE_SCOPE);
    const client = this.getClient();
    if (!client) {
      throw new Error('Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    const { error } = await client.from('session_packages').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
    return true;
  }

  public async getAllTuitionInvoices(): Promise<TuitionInvoice[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllTuitionInvoices();

    try {
      const { data, error } = await client.from('tuition_invoices').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapTuitionInvoiceFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getTuitionInvoicesByStudentId(studentId: string): Promise<TuitionInvoice[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getTuitionInvoicesByStudentId(studentId);

    try {
      const { data, error } = await client
        .from('tuition_invoices')
        .select('*')
        .eq('student_id', studentId);

      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapTuitionInvoiceFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getTuitionInvoiceById(id: string): Promise<TuitionInvoice | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getTuitionInvoiceById(id);

    try {
      const { data, error } = await client
        .from('tuition_invoices')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return data ? mapTuitionInvoiceFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async createTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    const client = this.getClient();
    if (!client) {
      throw new Error("Supabase Cloud client is not configured.");
    }
    try {
      const dbRow = mapTuitionInvoiceToDb(invoice);
      const { data, error } = await client.from("tuition_invoices").insert([dbRow]).select().single();
      if (error) {
        throw new Error(error.message);
      }
      return data ? mapTuitionInvoiceFromDb(data) : invoice;
    } catch (err) {
      throw err;
    }
  }

  public async updateTuitionInvoice(invoice: TuitionInvoice): Promise<TuitionInvoice> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updateTuitionInvoice(invoice);

    try {
      const row = mapTuitionInvoiceToDb(invoice);
      const { error } = await client
        .from('tuition_invoices')
        .update(row)
        .eq('id', invoice.id);

      if (error) {
        throw new Error(error.message);
      }
      return invoice;
    } catch (err) {
      throw err;
    }
  }

  public async getAllPayrollRecords(month?: string): Promise<PayrollRecord[]> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getAllPayrollRecords(month);

    try {
      let query = client.from('teacher_payroll_periods').select('*');
      if (month) {
        query = query.eq('month', month);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(error.message);
      }
      return (data || []).map(mapPayrollRecordFromDb);
    } catch (err) {
      throw err;
    }
  }

  public async getPayrollByTeacherId(teacherId: string, month?: string): Promise<PayrollRecord | null> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // getPayrollByTeacherId(teacherId, month);

    try {
      let query = client.from('teacher_payroll_periods').select('*').eq('teacher_id', teacherId);
      if (month) {
        query = query.eq('month', month);
      }
      const { data, error } = await query.maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      return data ? mapPayrollRecordFromDb(data) : null;
    } catch (err) {
      throw err;
    }
  }

  public async updatePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // updatePayrollRecord(record);

    try {
      const row = mapPayrollRecordToDb(record);
      const { error } = await client
        .from('teacher_payroll_periods')
        .update(row)
        .eq('id', record.id);

      if (error) {
        throw new Error(error.message);
      }
      return record;
    } catch (err) {
      throw err;
    }
  }

  public async savePayrollRecord(record: PayrollRecord): Promise<PayrollRecord> {
    const client = this.getClient();
    if (!client) throw new Error("Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); // savePayrollRecord(record);

    try {
      const row = mapPayrollRecordToDb(record);
      const { error } = await client
        .from('teacher_payroll_periods')
        .upsert(row, { onConflict: 'teacher_id,month' });

      if (error) {
        throw new Error(error.message);
      }
      return record;
    } catch (err) {
      throw err;
    }
  }

}
