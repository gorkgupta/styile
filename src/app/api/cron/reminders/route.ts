import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendReminder } from '@/lib/whatsapp/outbox';

// Called every 15 minutes (Supabase pg_cron + pg_net, see supabase/schedules.sql).
// Sends a WhatsApp reminder ~24h before each appointment, and a 2h nudge for bookings made well in advance.

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${env.cronSecret()}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const db = createAdminClient();
  const now = Date.now();
  const iso = (ms: number) => new Date(now + ms).toISOString();
  const H = 3600000;
  const results = { day: 0, soon: 0, failed: 0 };

  const { data: dayAhead } = await db.from('appointments').select('id')
    .in('status', ['booked', 'confirmed']).is('reminder_24h_sent_at', null)
    .gte('start_at', iso(22 * H)).lte('start_at', iso(26 * H)).limit(300);
  // One salon's bad data must not stop reminders for every other salon: mark first, and never let one send throw.
  const safeSend = (id: string) => sendReminder(id).catch((e) => { console.error('reminder failed', id, e); return { sent: false }; });
  for (const a of dayAhead ?? []) {
    await db.from('appointments').update({ reminder_24h_sent_at: new Date().toISOString() }).eq('id', a.id);
    const r = await safeSend(a.id);
    if (r.sent) results.day++; else results.failed++;
  }

  const { data: soon } = await db.from('appointments').select('id, created_at')
    .in('status', ['booked', 'confirmed']).is('reminder_2h_sent_at', null)
    .gte('start_at', iso(1.5 * H)).lte('start_at', iso(2.5 * H)).limit(300);
  for (const a of soon ?? []) {
    await db.from('appointments').update({ reminder_2h_sent_at: new Date().toISOString() }).eq('id', a.id);
    if (now - new Date(a.created_at).getTime() < 6 * H) continue; // booked recently — no need to nudge
    const r = await safeSend(a.id);
    if (r.sent) results.soon++; else results.failed++;
  }
  return NextResponse.json(results);
}
