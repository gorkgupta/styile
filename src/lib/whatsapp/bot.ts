import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { salonUrl } from '@/lib/tenant';
import { callClaude } from '@/lib/anthropic';
import { cancelBooking, createBooking, findOrCreateCustomer, getAvailability, listUpcoming, loadCatalog, rescheduleBooking } from '@/lib/booking';
import { markReadWithTyping, type OutgoingMessage } from './cloud-api';
import { deliver, ensureConversation, getSalonWa } from './outbox';
import { runEngine, type EngineContext, type Pending } from './engine';
import type { CoinKind } from '@/lib/types';
import { CLIENT_PACKAGE_SELECT, membershipState, normalizeClientPackage, normalizeMembership, packageState, sessionsLeft } from '@/lib/packages';
import { localDate } from '@/lib/time';

// Wires the assistant engine to Supabase, the booking service and WhatsApp.

interface WaMessageIn {
  id: string; from: string; timestamp: string; type: string;
  text?: { body: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  button?: { text: string; payload?: string };
  reaction?: unknown;
}
interface WaChangeValue {
  metadata?: { phone_number_id: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WaMessageIn[];
  statuses?: { id: string; status: string }[];
}
export interface WaWebhookPayload { object?: string; entry?: { changes?: { field: string; value: WaChangeValue }[] }[] }

export async function handleWebhookPayload(payload: WaWebhookPayload) {
  const db = createAdminClient();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const v = change.value;
      for (const s of v.statuses ?? []) {
        await db.from('wa_messages').update({ status: s.status }).eq('wa_message_id', s.id);
      }
      for (const m of v.messages ?? []) {
        if (!v.metadata?.phone_number_id) continue;
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        try {
          await handleMessage(v.metadata.phone_number_id, name, m);
        } catch (e) {
          console.error('WhatsApp message handling failed', e);
        }
      }
    }
  }
}

function readInbound(m: WaMessageIn): { text: string; buttonId: string | null; kind: string } {
  switch (m.type) {
    case 'text': return { text: m.text?.body ?? '', buttonId: null, kind: 'text' };
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return { text: r?.title ?? '', buttonId: r?.id ?? null, kind: 'button' };
    }
    case 'button': return { text: m.button?.text ?? '', buttonId: null, kind: 'button' };
    default: return { text: '', buttonId: null, kind: m.type };
  }
}

async function handleMessage(phoneNumberId: string, profileName: string | null, m: WaMessageIn) {
  if (m.type === 'reaction' || m.type === 'system' || m.type === 'unsupported') return;
  const db = createAdminClient();
  const { data: salon } = await db.from('salons')
    .select('id, name, slug, phone, address, timezone, plan_status, wa_bot_enabled, wa_bot_instructions, booking_window_days, gst_mode, prices_include_tax')
    .eq('wa_phone_number_id', phoneNumberId).maybeSingle();
  if (!salon || ['suspended', 'cancelled'].includes(salon.plan_status)) return;

  const waId = m.from.replace(/\D/g, '');
  const inbound = readInbound(m);
  const customer = await findOrCreateCustomer(db, salon.id, waId, profileName);
  const conv = await ensureConversation(salon.id, waId, customer.id, profileName);

  // Store the message first; a duplicate delivery from Meta hits the unique wa_message_id and stops here.
  const { data: stored } = await db.from('wa_messages').upsert({
    conversation_id: conv.id, salon_id: salon.id, direction: 'in', author: 'customer', kind: inbound.kind,
    body: inbound.text || `[${m.type}]`, payload: inbound.buttonId ? { button_id: inbound.buttonId } : null, wa_message_id: m.id,
  }, { onConflict: 'wa_message_id', ignoreDuplicates: true }).select('id');
  if (!stored?.length) return;

  const receivedAt = new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString();
  const { data: fresh } = await db.from('wa_conversations').select('unread_count, bot_paused, state').eq('id', conv.id).single();
  await db.from('wa_conversations').update({
    last_inbound_at: receivedAt, last_message_at: receivedAt, unread_count: (fresh?.unread_count ?? 0) + 1,
  }).eq('id', conv.id);

  if (!salon.wa_bot_enabled || fresh?.bot_paused) {
    await db.from('wa_conversations').update({ needs_attention: true }).eq('id', conv.id);
    return;
  }

  const wa = await getSalonWa(salon.id);
  if (!wa) return;
  await markReadWithTyping(wa.phoneNumberId, wa.token, m.id);

  const send = (reply: OutgoingMessage) => deliver(wa, conv.id, waId, reply, 'bot');

  try {
    const catalog = await loadCatalog(db, salon.id);
    const { data: past } = await db.from('wa_messages').select('direction, body, kind').eq('conversation_id', conv.id)
      .neq('id', stored[0].id).order('created_at', { ascending: false }).limit(20);
    const history = (past ?? []).reverse()
      .filter((x) => x.body && x.kind !== 'template')
      .map((x) => ({ role: x.direction === 'in' ? 'user' as const : 'assistant' as const, text: x.body as string }));

    const { data: cats } = await db.from('service_categories').select('id, name').eq('salon_id', salon.id);

    // Clients only see stylists offered online; their usual one (most visits in the last year) is offered first.
    const team = catalog.staff.filter((s) => s.bookable && s.show_on_booking !== false);
    const { data: usualId } = await db.rpc('usual_stylist', { p_salon: salon.id, p_customer: customer.id });
    const usual = team.find((s) => s.id === usualId) ?? null;
    const catMap = new Map<string, string>((cats ?? []).map((c: { id: string; name: string }) => [c.id, c.name] as [string, string]));

    const ctx: EngineContext = {
      salon: {
        name: salon.name, address: salon.address, phone: salon.phone, tz: salon.timezone, hours: catalog.branch.business_hours,
        instructions: salon.wa_bot_instructions, windowDays: salon.booking_window_days, bookingUrl: salonUrl(salon.slug) || `${env.appUrl()}/s/${salon.slug}`,
        priceNote: salon.gst_mode === 'regular'
          ? (salon.prices_include_tax ? 'Prices include GST' : 'GST (5% on services) is added to these prices on the bill')
          : 'Prices are final, with no GST added',
      },
      services: catalog.services.map((s) => ({
        id: s.id, name: s.name, category: s.category_id ? catMap.get(s.category_id) ?? null : null,
        duration_min: s.duration_min, price: Number(s.price), gender: s.gender, online_bookable: s.online_bookable,
      })),
      staff: team.map((s) => ({ id: s.id, name: s.name, title: s.title, specialties: s.specialties ?? [] })),
      customer: {
        name: customer.name, visits: (customer as { visit_count?: number }).visit_count ?? 0,
        usualStylist: usual ? { id: usual.id, name: usual.name } : null,
      },
      now: new Date(),
      history,
      pending: ((fresh?.state as { pending?: Pending } | null)?.pending) ?? null,
    };

    const result = await runEngine(ctx, {
      llm: callClaude,
      availability: (q) => getAvailability(db, catalog, { ...q, onlineOnly: true }),
      upcoming: async () => (await listUpcoming(db, salon.id, customer.id)).map((v) => ({
        id: v.id, start_at: v.start_at, status: v.status, staff: v.staff?.name ?? null,
        services: v.services.map((s) => s.name), serviceIds: v.services.map((s) => s.service_id).filter(Boolean) as string[],
      })),
      book: async (p) => {
        const r = await createBooking(db, catalog, {
          customerId: customer.id, serviceIds: p.serviceIds, start: p.start, staffId: p.staffId, source: 'whatsapp', onlineOnly: true,
        });
        return { start: r.appointment.start_at, stylist: r.stylist.name, services: r.services.map((s) => s.name) };
      },
      cancel: (id) => cancelBooking(db, salon.id, customer.id, id, 'Cancelled by client on WhatsApp'),
      reschedule: async (id, start, staffId) => {
        const r = await rescheduleBooking(db, catalog, customer.id, id, start, staffId);
        return { start: r.appointment.start_at, stylist: r.stylist.name };
      },
      rename: async (name) => { await db.from('customers').update({ name }).eq('id', customer.id); },
      handoff: async (reason) => {
        await db.from('wa_conversations').update({ bot_paused: true, needs_attention: true }).eq('id', conv.id);
        await db.from('wa_messages').insert({ conversation_id: conv.id, salon_id: salon.id, direction: 'out', author: 'system', kind: 'note', body: `Assistant handed this chat to the team: ${reason}` });
      },
      // Coins are per salon: this client record belongs to the salon whose number was messaged.
      coins: async () => {
        const [{ data: c }, { data: tx }] = await Promise.all([
          db.from('customers').select('coin_balance').eq('id', customer.id).eq('salon_id', salon.id).single(),
          db.from('coin_transactions').select('kind, coins, balance_after, created_at, invoice:invoices(invoice_no)')
            .eq('salon_id', salon.id).eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(5),
        ]);
        type Row = { kind: CoinKind; coins: number; balance_after: number; created_at: string; invoice: { invoice_no: string } | null };
        return {
          balance: Number((c as { coin_balance: number } | null)?.coin_balance ?? 0),
          recent: ((tx ?? []) as unknown as Row[]).map((t) => ({
            kind: t.kind, coins: Number(t.coins), balance_after: Number(t.balance_after), created_at: t.created_at, bill: t.invoice?.invoice_no ?? null,
          })),
        };
      },
      // Packages and cards are per salon too.
      packages: async () => {
        const today = localDate(new Date(), salon.timezone);
        const [{ data: pk }, { data: cards }] = await Promise.all([
          db.from('client_packages').select(CLIENT_PACKAGE_SELECT).eq('salon_id', salon.id).eq('customer_id', customer.id).eq('status', 'active').gte('expires_on', today).order('expires_on'),
          db.from('client_memberships').select('*').eq('salon_id', salon.id).eq('customer_id', customer.id).eq('status', 'active').gte('ends_on', today).order('ends_on'),
        ]);
        const packages = (pk ?? []).map(normalizeClientPackage).filter((p) => packageState(p, today) === 'active');
        const card = (cards ?? []).map(normalizeMembership).find((m) => ['active', 'upcoming'].includes(membershipState(m, today))) ?? null;
        return {
          packages: packages.map((p) => ({ name: p.name, expires_on: p.expires_on, items: p.items.map((i) => ({ name: i.name, left: sessionsLeft(i), total: i.sessions_total })) })),
          membership: card ? { name: card.name, starts_on: card.starts_on, ends_on: card.ends_on, service_discount_pct: card.service_discount_pct, product_discount_pct: card.product_discount_pct } : null,
        };
      },
    }, inbound);

    await db.from('wa_conversations').update({ state: { pending: result.pending } }).eq('id', conv.id);
    for (const reply of result.replies) await send(reply);
  } catch (e) {
    console.error('Assistant failed', e);
    await db.from('wa_conversations').update({ needs_attention: true }).eq('id', conv.id);
    await send({ type: 'text', text: 'Sorry, I’m having trouble right now. Someone from the salon will reply here shortly.' }).catch(() => {});
  }
}
