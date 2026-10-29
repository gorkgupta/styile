import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { salonUrl } from '@/lib/tenant';
import { money } from '@/lib/billing';
import { billDocument, type BillType } from '@/lib/gst';
import { fmtCoins } from '@/lib/coins';
import { fmtDateShort, fmtTime, localDate } from '@/lib/time';
import { sendWhatsApp, WhatsAppError, type OutgoingMessage } from './cloud-api';

// Everything Styile sends on WhatsApp goes through here so it is logged in the salon's inbox.
// Inside the 24-hour window after a client's last message we send normal messages (free-form);
// outside it WhatsApp only allows pre-approved templates (see docs/WHATSAPP.md for their exact text).

export const TEMPLATES = {
  bookingConfirmation: 'booking_confirmation', // {{1}} name {{2}} salon {{3}} date & time {{4}} stylist {{5}} services
  reminder: 'appointment_reminder',            // {{1}} name {{2}} services {{3}} date & time {{4}} stylist {{5}} salon
  receipt: 'bill_receipt',                     // {{1}} name {{2}} salon {{3}} bill no {{4}} amount ; URL button param = invoice id
  coinsUpdate: 'coins_update',                 // {{1}} name {{2}} coins added {{3}} salon {{4}} balance
} as const;

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SalonWa { salonId: string; name: string; phoneNumberId: string; token: string; tz: string; botEnabled: boolean }

export async function getSalonWa(salonId: string): Promise<SalonWa | null> {
  const db = createAdminClient();
  const [{ data: salon }, { data: secret }] = await Promise.all([
    db.from('salons').select('id, name, timezone, wa_phone_number_id, wa_bot_enabled').eq('id', salonId).single(),
    db.from('salon_secrets').select('wa_access_token').eq('salon_id', salonId).maybeSingle(),
  ]);
  if (!salon?.wa_phone_number_id) return null;
  return {
    salonId, name: salon.name, tz: salon.timezone, botEnabled: salon.wa_bot_enabled,
    phoneNumberId: salon.wa_phone_number_id, token: secret?.wa_access_token || env.waAccessToken(),
  };
}

/** Find or create the conversation row for a client number. */
export async function ensureConversation(salonId: string, waId: string, customerId?: string | null, profileName?: string | null) {
  const db = createAdminClient();
  const { data: existing } = await db.from('wa_conversations').select('*').eq('salon_id', salonId).eq('wa_id', waId).maybeSingle();
  if (existing) {
    if ((customerId && !existing.customer_id) || (profileName && existing.profile_name !== profileName)) {
      await db.from('wa_conversations').update({ customer_id: existing.customer_id ?? customerId, profile_name: profileName ?? existing.profile_name }).eq('id', existing.id);
    }
    return existing as { id: string; last_inbound_at: string | null; bot_paused: boolean; state: Record<string, unknown>; customer_id: string | null };
  }
  const { data, error } = await db.from('wa_conversations')
    .upsert({ salon_id: salonId, wa_id: waId, customer_id: customerId ?? null, profile_name: profileName ?? null }, { onConflict: 'salon_id,wa_id' })
    .select('*').single();
  if (error) throw error;
  return data as { id: string; last_inbound_at: string | null; bot_paused: boolean; state: Record<string, unknown>; customer_id: string | null };
}

export function windowOpen(lastInboundAt: string | null | undefined, now = Date.now()) {
  return !!lastInboundAt && now - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

function describe(m: OutgoingMessage): { body: string; kind: string; payload: unknown } {
  switch (m.type) {
    case 'text': return { body: m.text, kind: 'text', payload: null };
    case 'buttons': return { body: m.text, kind: 'interactive', payload: { buttons: m.buttons.map((b) => b.title) } };
    case 'list': return { body: m.text, kind: 'interactive', payload: { list: m.sections.flatMap((s) => s.rows.map((r) => r.title)) } };
    case 'template': return { body: `[${m.name}] ${(m.bodyParams ?? []).join(' · ')}`, kind: 'template', payload: { template: m.name, params: m.bodyParams } };
  }
}

/** Send and log. Returns false (and logs nothing) when the salon has no WhatsApp connected. */
export async function deliver(wa: SalonWa, conversationId: string, to: string, m: OutgoingMessage, author: 'bot' | 'staff' | 'system'): Promise<string> {
  const db = createAdminClient();
  const id = await sendWhatsApp(wa.phoneNumberId, wa.token, to, m);
  const d = describe(m);
  await db.from('wa_messages').insert({
    conversation_id: conversationId, salon_id: wa.salonId, direction: 'out', author, kind: d.kind, body: d.body, payload: d.payload,
    wa_message_id: id, status: 'sent',
  });
  await db.from('wa_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);
  return id;
}

/**
 * Send to a client: free-form text if the 24h window is open, otherwise the given template.
 * Never throws — notifications must not break bookings or billing. Returns what happened.
 */
export async function notifyCustomer(salonId: string, phone: string, customerId: string | null,
  text: string, template: OutgoingMessage & { type: 'template' }): Promise<{ sent: boolean; reason?: string }> {
  try {
    const wa = await getSalonWa(salonId);
    if (!wa) return { sent: false, reason: 'WhatsApp is not connected' };
    const conv = await ensureConversation(salonId, phone, customerId);
    await deliver(wa, conv.id, phone, windowOpen(conv.last_inbound_at) ? { type: 'text', text } : template, 'system');
    return { sent: true };
  } catch (e) {
    console.error('notifyCustomer failed', e);
    return { sent: false, reason: e instanceof Error ? e.message : 'Send failed' };
  }
}

async function loadAppointment(appointmentId: string) {
  const db = createAdminClient();
  const { data } = await db.from('appointments')
    .select('id, salon_id, start_at, customer:customers(id, name, phone), staff:staff_id(name), services:appointment_services(name), salon:salons(name, timezone)')
    .eq('id', appointmentId).single();
  return data as unknown as {
    id: string; salon_id: string; start_at: string;
    customer: { id: string; name: string; phone: string }; staff: { name: string } | null;
    services: { name: string }[]; salon: { name: string; timezone: string };
  } | null;
}

function when(startAt: string, tz: string) {
  return `${fmtDateShort(localDate(new Date(startAt), tz))}, ${fmtTime(startAt, tz)}`;
}

export async function notifyBookingConfirmed(appointmentId: string) {
  const a = await loadAppointment(appointmentId);
  if (!a) return { sent: false, reason: 'Appointment not found' };
  const first = a.customer.name.split(' ')[0];
  const svc = a.services.map((s) => s.name).join(', ');
  const stylist = a.staff?.name ?? 'our team';
  const at = when(a.start_at, a.salon.timezone);
  return notifyCustomer(a.salon_id, a.customer.phone, a.customer.id,
    `Booked ✅ ${svc} with ${stylist}, ${at} at ${a.salon.name}. Reply here any time to change or cancel.`,
    { type: 'template', name: TEMPLATES.bookingConfirmation, bodyParams: [first, a.salon.name, at, stylist, svc] });
}

export async function sendReminder(appointmentId: string) {
  const a = await loadAppointment(appointmentId);
  if (!a) return { sent: false, reason: 'Appointment not found' };
  const first = a.customer.name.split(' ')[0];
  const svc = a.services.map((s) => s.name).join(', ');
  const at = when(a.start_at, a.salon.timezone);
  return notifyCustomer(a.salon_id, a.customer.phone, a.customer.id,
    `Hi ${first}, a reminder about your ${svc} at ${a.salon.name}, ${at} with ${a.staff?.name ?? 'our team'}. Reply here if you need to change it.`,
    { type: 'template', name: TEMPLATES.reminder, bodyParams: [first, svc, at, a.staff?.name ?? 'our team', a.salon.name] });
}

export async function notifyInvoice(invoiceId: string) {
  const db = createAdminClient();
  const { data } = await db.from('invoices')
    .select('id, salon_id, invoice_no, total, bill_type, customer:customers(id, name, phone), salon:salons(name, slug)')
    .eq('id', invoiceId).single();
  const inv = data as unknown as {
    id: string; salon_id: string; invoice_no: string; total: number; bill_type: BillType | null;
    customer: { id: string; name: string; phone: string } | null; salon: { name: string; slug: string };
  } | null;
  if (!inv) return { sent: false, reason: 'Bill not found' };
  if (!inv.customer) return { sent: false, reason: 'This bill has no client' };
  const link = salonUrl(inv.salon.slug, `/me/bills/${inv.id}`);
  const first = inv.customer.name.split(' ')[0];
  return notifyCustomer(inv.salon_id, inv.customer.phone, inv.customer.id,
    // "Your tax invoice GS-01043" / "Your bill of supply …" / "Your bill …" — the approved template keeps its fixed wording.
    `Thank you for visiting ${inv.salon.name}, ${first}! Your ${billDocument(inv.bill_type).noun} ${inv.invoice_no} for ${money(inv.total)}: ${link}`,
    { type: 'template', name: TEMPLATES.receipt, bodyParams: [first, inv.salon.name, inv.invoice_no, money(inv.total)], buttonUrlParam: inv.id });
}

/** Coins receipt after a sale at the desk: "₹5,000 received — 5,500 coins added at Glow Studio. Balance: 5,500 coins." */
export async function notifyCoinsAdded(salonId: string, customerId: string, paid: number, coinsAdded: number, balance: number) {
  const db = createAdminClient();
  const { data } = await db.from('customers').select('id, name, phone, salon:salons(name)').eq('id', customerId).eq('salon_id', salonId).single();
  const c = data as unknown as { id: string; name: string; phone: string; salon: { name: string } } | null;
  if (!c) return { sent: false, reason: 'Client not found' };
  const first = c.name.split(' ')[0];
  return notifyCustomer(salonId, c.phone, c.id,
    `${money(paid)} received — ${fmtCoins(coinsAdded)} coins added at ${c.salon.name}. Balance: ${fmtCoins(balance)} coins. Use them on your next bill here.`,
    { type: 'template', name: TEMPLATES.coinsUpdate, bodyParams: [first, fmtCoins(coinsAdded), c.salon.name, fmtCoins(balance)] });
}

/** A person at the salon replies from the inbox. Throws a readable error if the 24h window is closed. */
export async function sendStaffReply(conversationId: string, text: string) {
  const db = createAdminClient();
  const { data: conv } = await db.from('wa_conversations').select('id, salon_id, wa_id, last_inbound_at').eq('id', conversationId).single();
  if (!conv) throw new WhatsAppError('Conversation not found');
  if (!windowOpen(conv.last_inbound_at)) throw new WhatsAppError('It’s been more than 24 hours since this client last wrote. WhatsApp only allows template messages until they reply.');
  const wa = await getSalonWa(conv.salon_id);
  if (!wa) throw new WhatsAppError('Connect your WhatsApp number in Settings first.');
  await deliver(wa, conv.id, conv.wa_id, { type: 'text', text }, 'staff');
  await db.from('wa_conversations').update({ needs_attention: false, unread_count: 0 }).eq('id', conv.id);
}

/** Login codes for customers go from the platform's own number (authentication template). */
export async function sendLoginCode(phone: string, code: string) {
  const id = env.waPlatformPhoneId();
  if (!id) throw new WhatsAppError('WHATSAPP_PLATFORM_PHONE_NUMBER_ID is not set');
  await sendWhatsApp(id, env.waAccessToken(), phone, { type: 'template', name: env.waOtpTemplate(), otpCode: code });
}
