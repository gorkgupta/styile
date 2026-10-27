'use client';
import { createBrowserClient } from '@supabase/ssr';
import { cookieDomain } from '@/lib/tenant';

/** Browser client — used for realtime subscriptions and phone-OTP login. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { domain: cookieDomain() },
  });
}
