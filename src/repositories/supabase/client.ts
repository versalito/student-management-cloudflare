import type { SupabaseClient } from '@supabase/supabase-js';

export function getClientOrThrow(getClient: () => SupabaseClient | null): SupabaseClient {
  const client = getClient();
  if (!client) {
    throw new Error(
      'Supabase Cloud client is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }
  return client;
}
