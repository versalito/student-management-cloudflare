import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

/**
 * Lấy Supabase Admin Client.
 *
 * Chỉ dùng khoá bí mật (service role / sb_secret_*): mọi truy vấn đi qua đây
 * cố tình bỏ qua RLS, nên khoá công khai (anon / sb_publishable_*) không bao giờ
 * là fallback hợp lệ — nó chỉ tạo ra lỗi 401 "permission denied" khó truy.
 * Thiếu khoá thì trả null để caller báo lỗi cấu hình rõ ràng.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  cachedClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

export const supabaseAdmin = getSupabaseAdminClient();
