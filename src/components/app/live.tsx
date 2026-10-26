'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Re-renders the page when rows change for this salon (a WhatsApp booking, another
 * receptionist's edit). Uses Supabase Realtime; RLS decides which rows this user may hear about.
 */
export function useLiveRefresh(salonId: string, tables: string[]) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(',');
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`live:${salonId}:${key}`);
    for (const table of key.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `salon_id=eq.${salonId}` }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 400);
      });
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [salonId, key, router]);
}
