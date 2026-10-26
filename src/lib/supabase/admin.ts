import 'server-only';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Service-role client: bypasses RLS. Only for trusted server code paths that do their own checks:
 * the public booking page, the WhatsApp webhook, cron jobs, team invites and the platform console.
 * Never import this into a client component.
 */
export function createAdminClient(): SupabaseClient {
  if (!cached) {
    cached = createSupabaseClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
