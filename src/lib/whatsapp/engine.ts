// The WhatsApp booking assistant's brain. Pure logic with injected dependencies (LLM, booking service,
// persistence) so it can be unit-tested without Supabase, Meta or Anthropic. Wiring lives in bot.ts.
//
// Safety model: the LLM can look things up and *propose* a booking, change or cancellation, but nothing
// is written until the client taps "Confirm" (or replies yes). Every proposal is re-validated against
// live availability, and the database exclusion constraint is the final guard against double booking.

import type { Slot } from '../availability';
import { nearestSlots } from '../availability';
import { addDays, dayKeyOf, fmtDateShort, fmtHhmm, isValidDateStr, localDate, localTime, zonedToUtc } from '../time';
import type { CoinKind, Hours } from '../types';
import { COIN_KIND_LABEL } from '../types';
import { fmtCoins } from '../coins';
import type { OutgoingMessage } from './cloud-api-payload';

// ---------- LLM protocol (Anthropic Messages API shapes) ----------
export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Block = TextBlock | ToolUseBlock | ToolResultBlock;
export interface LlmMessage { role: 'user' | 'assistant'; content: string | Block[] }
export interface LlmRequest {
  system: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[];
  messages: LlmMessage[];
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
}
export interface LlmResponse { stop_reason: string; content: Block[] }

// ---------- Inputs ----------
export interface EngineService { id: string; name: string; category: string | null; duration_min: number; price: number; gender: string; online_bookable: boolean }
export interface EngineStaff { id: string; name: string; title: string | null; specialties?: string[] }
export interface EngineVisit { id: string; start_at: string; staff: string | null; services: string[]; serviceIds: string[]; status: string }
/** A row of the client's coin ledger at this salon (coins: + added, − used). */
export interface EngineCoinTx { created_at: string; kind: CoinKind; coins: number; balance_after: number; bill: string | null }

export interface Pending {
  type: 'book' | 'cancel' | 'reschedule';
  serviceIds?: string[];
  start?: string;          // ISO
  staffId?: string | null;
  appointmentId?: string;
  summary: string;
  expiresAt: string;       // ISO
}

export interface EngineContext {
  salon: { name: string; address: string | null; phone: string | null; tz: string; hours: Hours; instructions: string | null; windowDays: number; bookingUrl: string };
  services: EngineService[];
  staff: EngineStaff[];
  /** usualStylist: who they've seen most in the last 12 months (only when that stylist is in `staff`). */
  customer: { name: string; visits: number; usualStylist?: { id: string; name: string } | null };
  now: Date;
  history: { role: 'user' | 'assistant'; text: string }[];  // oldest first, excluding the current message
  pending: Pending | null;
}

export interface EngineDeps {
  llm(req: LlmRequest): Promise<LlmResponse>;
  availability(q: { serviceIds: string[]; date: string; staffId?: string | null; excludeAppointmentId?: string }): Promise<Slot[]>;
  upcoming(): Promise<EngineVisit[]>;
  book(p: { serviceIds: string[]; start: string; staffId: string | null }): Promise<{ start: string; stylist: string; services: string[] }>;
  cancel(appointmentId: string): Promise<void>;
  reschedule(appointmentId: string, start: string, staffId: string | null): Promise<{ start: string; stylist: string }>;
  rename(name: string): Promise<void>;
  handoff(reason: string): Promise<void>;
  /** The client's coin balance at this salon and their latest coin transactions (newest first). */
  coins(): Promise<{ balance: number; recent: EngineCoinTx[] }>;
}

export interface Inbound { text: string; buttonId?: string | null }

export interface EngineResult {
  replies: OutgoingMessage[];
  pending: Pending | null;
  handedOff: boolean;
  /** What happened, for logs/tests. */
  actions: string[];
}

// ---------- Helpers ----------
const YES = /^\s*(yes|y|yep|yeah|ok|okay|confirm|confirmed|sure|done|book( it)?|haan|haa|ha|ji|han|theek hai|thik hai|ho|sari|houdu)\b[\s.!👍]*$/i;
const NO = /^\s*(no|n|nope|cancel|change|nahi|nahin|na|illa|beda)\b/i;
const PENDING_TTL_MS = 30 * 60 * 1000;

export function describeWhen(startIso: string, tz: string, todayStr: string) {
  const d = localDate(new Date(startIso), tz);
  const day = d === todayStr ? 'today' : d === addDays(todayStr, 1) ? 'tomorrow' : fmtDateShort(d);
  return `${day}, ${fmtHhmm(localTime(new Date(startIso), tz))}`;
}

function money(n: number) {
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function confirmButtons(text: string): OutgoingMessage {
  return { type: 'buttons', text, buttons: [{ id: 'confirm', title: 'Confirm' }, { id: 'change', title: 'Change something' }] };
}

export function buildSystemPrompt(ctx: EngineContext): LlmRequest['system'] {
  const { salon, services, staff } = ctx;
  const today = localDate(ctx.now, salon.tz);
  const days = Array.from({ length: 8 }, (_, i) => {
    const d = addDays(today, i);
    const h = salon.hours[dayKeyOf(d)];
    const open = h && h.length ? h.map(([a, b]) => `${fmtHhmm(a)}–${fmtHhmm(b)}`).join(', ') : 'closed';
    return `- ${fmtDateShort(d)} = ${d}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}: ${open}`;
  }).join('\n');
  const menu = services.filter((s) => s.online_bookable)
    .map((s) => `- ${s.id} | ${s.category ?? 'Other'} | ${s.name} | ${s.duration_min} min | ${money(s.price)}${s.gender !== 'unisex' ? ` | ${s.gender} only` : ''}`).join('\n');
  const team = staff.map((s) => `- ${s.id} | ${staffLine(s)}`).join('\n');
  const usual = ctx.customer.usualStylist && staff.some((s) => s.id === ctx.customer.usualStylist!.id) ? ctx.customer.usualStylist : null;

  const stable = `You are the WhatsApp assistant for ${salon.name}, a salon${salon.address ? ` at ${salon.address}` : ''}. You help clients book, change and cancel appointments and answer questions about the salon.

How to talk:
- Reply in the client's language and script (English, Hindi, Hinglish, Kannada, Tamil, Telugu, Malayalam, Marathi, Bengali…). Be warm, brief and natural, like a good receptionist on WhatsApp. One or two short paragraphs at most.
- WhatsApp formatting only: *bold* sparingly, no markdown headings, no tables. Never show IDs.
- Prices include GST and are paid at the salon.

How to book:
- Only offer services from the menu below. If the client is vague ("haircut"), pick the closest service or ask one short question.
- Always call check_availability before suggesting or agreeing to any time. Never guess availability.
- When the client has chosen a service and a time, call propose_booking. The client then gets a Confirm button. Do not say the appointment is booked until it is confirmed.
- For changes or cancellations, call list_my_appointments first, then propose_reschedule or propose_cancellation.
- If the client asks for a particular stylist, pass their staff_id; otherwise leave it out and anyone free will be assigned.
- If the client asks who is good at something ("who does balayage?"), suggest stylists whose specialties match.
- If the client tells you their name and it differs from what you have, call update_my_name.

Coins: clients can prepay at ${salon.name} and get coins (1 coin = ₹1, often with a bonus) to pay their bills here. When the client asks how many coins they have, their balance, wallet or recent coin use, call my_coins and answer with the balance. Coins are bought at the front desk (cash, UPI or card) and can only be used at ${salon.name}; you can't add coins or take payments in this chat.

Hand over to the team (handoff_to_staff) when: the client asks for a person, has a complaint, asks about refunds or payments (other than checking their coins), needs bridal/group bookings or anything not on the menu, has a medical or allergy question, or you are unsure. Tell them someone from the salon will reply here.

Salon details:
- Phone: ${salon.phone ? '+' + salon.phone : 'not listed'}
- Online booking page: ${salon.bookingUrl}
${salon.instructions ? `- Notes from the salon: ${salon.instructions}\n` : ''}
Menu (id | category | service | duration | price):
${menu || '- (no services available for online booking)'}

Team (id | name (title; specialties)):
${team || '- (no stylists listed)'}`;

  const dynamic = `Now: ${fmtDateShort(today)} ${fmtHhmm(localTime(ctx.now, salon.tz))} (${salon.tz}). Bookings are accepted up to ${salon.windowDays} days ahead.
Opening hours for the coming days (date = YYYY-MM-DD to use in tools):
${days}

Client: ${ctx.customer.name}${ctx.customer.visits ? `, has visited ${ctx.customer.visits} times` : ', first-time client'}.${usual ? `\nTheir usual stylist: ${usual.name} (staff_id ${usual.id}). If they don't say who, offer their usual stylist first (check ${usual.name.split(' ')[0]}'s availability with that staff_id), and mention anyone else free if ${usual.name.split(' ')[0]} isn't.` : ''}${ctx.pending ? `\nWaiting for the client to confirm: ${ctx.pending.summary.replace(/\n/g, '; ')}` : ''}`;

  return [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamic },
  ];
}

/** "Meera Iyer (Colour specialist; balayage, global colour)" for the team list in the prompt. */
export function staffLine(s: EngineStaff): string {
  const about = [s.title, (s.specialties ?? []).filter(Boolean).join(', ')].filter(Boolean).join('; ');
  return about ? `${s.name} (${about})` : s.name;
}

export const TOOLS: LlmRequest['tools'] = [
  {
    name: 'check_availability',
    description: 'Free start times for the given services on a date. Use before offering any time.',
    input_schema: {
      type: 'object',
      properties: {
        service_ids: { type: 'array', items: { type: 'string' }, description: 'Menu ids' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        preferred_time: { type: 'string', description: 'HH:MM 24h, if the client mentioned a time' },
        staff_id: { type: 'string', description: 'Only if the client wants a specific stylist' },
      },
      required: ['service_ids', 'date'],
    },
  },
  {
    name: 'propose_booking',
    description: 'Ask the client to confirm a booking. Only after check_availability showed the time is free.',
    input_schema: {
      type: 'object',
      properties: {
        service_ids: { type: 'array', items: { type: 'string' } },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM 24h' },
        staff_id: { type: 'string' },
      },
      required: ['service_ids', 'date', 'time'],
    },
  },
  { name: 'list_my_appointments', description: "The client's upcoming appointments.", input_schema: { type: 'object', properties: {} } },
  {
    name: 'propose_cancellation',
    description: 'Ask the client to confirm cancelling one of their upcoming appointments.',
    input_schema: { type: 'object', properties: { appointment_id: { type: 'string' } }, required: ['appointment_id'] },
  },
  {
    name: 'propose_reschedule',
    description: 'Ask the client to confirm moving an upcoming appointment to a new free time (check availability first).',
    input_schema: {
      type: 'object',
      properties: { appointment_id: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, staff_id: { type: 'string' } },
      required: ['appointment_id', 'date', 'time'],
    },
  },
  {
    name: 'update_my_name',
    description: "Save the client's name when they tell you.",
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'my_coins',
    description: "The client's coin balance at this salon (prepaid, 1 coin = ₹1) and their last 5 coin transactions.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'handoff_to_staff',
    description: 'Pass the chat to a person at the salon. The assistant stops replying in this chat until the team resumes it.',
    input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  },
];

/** Claude needs alternating roles starting with the user; merge and trim the stored history accordingly. */
export function toLlmMessages(history: EngineContext['history'], current: string): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const h of [...history.slice(-16), { role: 'user' as const, text: current }]) {
    const text = h.text?.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === h.role) last.content = `${last.content}\n${text}`;
    else out.push({ role: h.role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// ---------- The engine ----------
export async function runEngine(ctx: EngineContext, deps: EngineDeps, inbound: Inbound): Promise<EngineResult> {
  const { tz } = ctx.salon;
  const today = localDate(ctx.now, tz);
  const actions: string[] = [];
  let pending = ctx.pending && new Date(ctx.pending.expiresAt).getTime() > ctx.now.getTime() ? ctx.pending : null;

  // 1. Answers to a pending proposal are handled without the LLM.
  const said = inbound.text.trim();
  const confirming = pending && (inbound.buttonId === 'confirm' || (!inbound.buttonId && YES.test(said)));
  if (pending && confirming) {
    try {
      const reply = await executePending(pending, deps, tz, today);
      actions.push(`executed:${pending.type}`);
      return { replies: [{ type: 'text', text: reply }], pending: null, handedOff: false, actions };
    } catch (e) {
      actions.push(`failed:${pending.type}`);
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      return {
        replies: [{ type: 'text', text: `Sorry — ${msg.replace(/\.$/, '')}. Tell me another time that suits you and I'll check.` }],
        pending: null, handedOff: false, actions,
      };
    }
  }
  if (pending && (inbound.buttonId === 'change' || (!inbound.buttonId && NO.test(said) && said.split(/\s+/).length <= 2))) {
    actions.push('pending:cleared');
    return { replies: [{ type: 'text', text: 'No problem. What would you like to change — the day, the time, the stylist or the service?' }], pending: null, handedOff: false, actions };
  }
  if (!said) {
    return { replies: [{ type: 'text', text: 'I can read text messages here. Please type what you need — for example “haircut tomorrow at 5”.' }], pending, handedOff: false, actions };
  }

  // 2. Let the model work with tools.
  const req: LlmRequest = { system: buildSystemPrompt({ ...ctx, pending }), messages: toLlmMessages(ctx.history, said), tools: TOOLS };
  let proposal: OutgoingMessage | null = null;
  let handedOff = false;
  let finalText = '';

  for (let turn = 0; turn < 6; turn++) {
    const res = await deps.llm(req);
    const texts = res.content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    const uses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) { finalText = texts; break; }

    req.messages.push({ role: 'assistant', content: res.content });
    const results: ToolResultBlock[] = [];
    for (const use of uses) {
      try {
        const out = await runTool(use, ctx, deps, today);
        if (out.pending) {
          pending = out.pending;
          proposal = confirmButtons(out.pending.summary);
          actions.push(`proposed:${out.pending.type}`);
        }
        if (out.handoff) { handedOff = true; actions.push('handoff'); }
        if (out.renamed) actions.push('renamed');
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out.result) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: e instanceof Error ? e.message : 'Tool failed', is_error: true });
      }
    }
    req.messages.push({ role: 'user', content: results });
    if (proposal) break; // the Confirm buttons are the reply
    if (turn === 5) finalText = texts;
  }

  const replies: OutgoingMessage[] = [];
  if (proposal) replies.push(proposal);
  else if (finalText) replies.push({ type: 'text', text: finalText });
  else replies.push({ type: 'text', text: handedOff ? 'I’ve asked the team to help — someone from the salon will reply here shortly.' : 'Sorry, I didn’t catch that. Could you say it another way?' });
  return { replies, pending, handedOff, actions };
}

interface ToolOutcome { result: unknown; pending?: Pending; handoff?: boolean; renamed?: boolean }

function serviceList(ctx: EngineContext, ids: unknown): EngineService[] {
  if (!Array.isArray(ids) || !ids.length) throw new Error('Choose at least one service from the menu');
  const list = ids.map((id) => ctx.services.find((s) => s.id === id && s.online_bookable));
  if (list.some((s) => !s)) throw new Error('Unknown service id — use ids from the menu');
  return list as EngineService[];
}

function checkDate(ctx: EngineContext, date: unknown, today: string): string {
  if (!isValidDateStr(date)) throw new Error('Use a date in YYYY-MM-DD format');
  if (date < today) throw new Error('That date is in the past');
  if (date > addDays(today, ctx.salon.windowDays)) throw new Error(`Bookings open only ${ctx.salon.windowDays} days ahead`);
  return date;
}

function checkTime(t: unknown): string {
  if (typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error('Use a time in HH:MM 24-hour format');
  return t;
}

function staffName(ctx: EngineContext, id: string | null | undefined) {
  return ctx.staff.find((s) => s.id === id)?.name ?? 'our team';
}

async function runTool(use: ToolUseBlock, ctx: EngineContext, deps: EngineDeps, today: string): Promise<ToolOutcome> {
  const i = use.input ?? {};
  const tz = ctx.salon.tz;
  const staffId = typeof i.staff_id === 'string' && i.staff_id ? i.staff_id : null;
  if (staffId && !ctx.staff.some((s) => s.id === staffId)) throw new Error('Unknown staff id');

  switch (use.name) {
    case 'check_availability': {
      const services = serviceList(ctx, i.service_ids);
      const date = checkDate(ctx, i.date, today);
      const ids = services.map((s) => s.id);
      const slots = await deps.availability({ serviceIds: ids, date, staffId });
      const pick = (list: Slot[]) => {
        const pref = typeof i.preferred_time === 'string' && /^\d{2}:\d{2}$/.test(i.preferred_time) ? i.preferred_time : null;
        if (pref) return nearestSlots(list, pref, 6);
        // spread across the day: up to 8 evenly spaced options
        if (list.length <= 8) return list;
        const step = list.length / 8;
        return Array.from({ length: 8 }, (_, k) => list[Math.floor(k * step)]);
      };
      const shaped = (list: Slot[]) => pick(list).map((s) => ({ time: s.time, label: fmtHhmm(s.time), stylists: s.staffIds.map((id) => staffName(ctx, id)) }));
      if (slots.length) return { result: { date, total_free_times: slots.length, options: shaped(slots), duration_min: services.reduce((a, s) => a + s.duration_min, 0) } };
      // Nothing that day: look ahead a few days so the model can offer an alternative.
      for (let k = 1; k <= 4; k++) {
        const d = addDays(date, k);
        if (d > addDays(today, ctx.salon.windowDays)) break;
        const next = await deps.availability({ serviceIds: ids, date: d, staffId });
        if (next.length) return { result: { date, options: [], message: 'No free time that day', next_available_date: d, next_options: shaped(next) } };
      }
      return { result: { date, options: [], message: 'No free time in the next few days' } };
    }

    case 'propose_booking': {
      const services = serviceList(ctx, i.service_ids);
      const date = checkDate(ctx, i.date, today);
      const time = checkTime(i.time);
      const slots = await deps.availability({ serviceIds: services.map((s) => s.id), date, staffId });
      const slot = slots.find((s) => s.time === time);
      if (!slot) return { result: { ok: false, error: 'That time is not free. Check availability and offer other times.' } };
      const chosen = staffId ?? slot.staffIds[0];
      const minutes = services.reduce((a, s) => a + s.duration_min, 0);
      const total = services.reduce((a, s) => a + Number(s.price), 0);
      const summary = `Please confirm your booking at ${ctx.salon.name}:\n*${services.map((s) => s.name).join(' + ')}* with ${staffName(ctx, chosen)}\n${describeWhen(zonedToUtc(date, time, tz).toISOString(), tz, today)} · ${minutes} min · ${money(total)}`;
      return {
        result: { ok: true, status: 'Confirm button sent to client' },
        pending: {
          type: 'book', serviceIds: services.map((s) => s.id), start: zonedToUtc(date, time, tz).toISOString(),
          staffId: staffId ?? chosen, summary, expiresAt: new Date(ctx.now.getTime() + PENDING_TTL_MS).toISOString(),
        },
      };
    }

    case 'list_my_appointments': {
      const visits = await deps.upcoming();
      return {
        result: visits.length
          ? visits.map((v) => ({ appointment_id: v.id, when: describeWhen(v.start_at, tz, today), services: v.services, stylist: v.staff, status: v.status }))
          : { message: 'No upcoming appointments' },
      };
    }

    case 'propose_cancellation': {
      const visits = await deps.upcoming();
      const v = visits.find((x) => x.id === i.appointment_id);
      if (!v) return { result: { ok: false, error: 'Appointment not found among upcoming ones' } };
      return {
        result: { ok: true, status: 'Confirm button sent to client' },
        pending: {
          type: 'cancel', appointmentId: v.id,
          summary: `Cancel this appointment?\n*${v.services.join(' + ')}*${v.staff ? ` with ${v.staff}` : ''}\n${describeWhen(v.start_at, tz, today)}`,
          expiresAt: new Date(ctx.now.getTime() + PENDING_TTL_MS).toISOString(),
        },
      };
    }

    case 'propose_reschedule': {
      const visits = await deps.upcoming();
      const v = visits.find((x) => x.id === i.appointment_id);
      if (!v) return { result: { ok: false, error: 'Appointment not found among upcoming ones' } };
      const date = checkDate(ctx, i.date, today);
      const time = checkTime(i.time);
      const serviceIds = v.serviceIds;
      const slots = await deps.availability({ serviceIds, date, staffId, excludeAppointmentId: v.id });
      const slot = slots.find((s) => s.time === time);
      if (!slot) return { result: { ok: false, error: 'That time is not free. Check availability and offer other times.' } };
      const start = zonedToUtc(date, time, tz).toISOString();
      return {
        result: { ok: true, status: 'Confirm button sent to client' },
        pending: {
          type: 'reschedule', appointmentId: v.id, start, staffId,
          summary: `Move your *${v.services.join(' + ')}*\nfrom ${describeWhen(v.start_at, tz, today)}\nto *${describeWhen(start, tz, today)}*${staffId ? ` with ${staffName(ctx, staffId)}` : ''}?`,
          expiresAt: new Date(ctx.now.getTime() + PENDING_TTL_MS).toISOString(),
        },
      };
    }

    case 'update_my_name': {
      const name = typeof i.name === 'string' ? i.name.trim().slice(0, 60) : '';
      if (name.length < 2) throw new Error('Name looks too short');
      await deps.rename(name);
      return { result: { ok: true }, renamed: true };
    }

    case 'my_coins': {
      const { balance, recent } = await deps.coins();
      return {
        result: {
          balance, balance_text: `${fmtCoins(balance)} coins (worth ${money(balance)} on bills at ${ctx.salon.name})`,
          recent: recent.slice(0, 5).map((t) => ({
            date: fmtDateShort(localDate(new Date(t.created_at), tz)), what: COIN_KIND_LABEL[t.kind],
            coins: `${t.coins > 0 ? '+' : '−'}${fmtCoins(Math.abs(t.coins))}`, balance_after: fmtCoins(t.balance_after), ...(t.bill ? { bill: t.bill } : {}),
          })),
          note: balance > 0 ? 'Coins are used at the salon when paying the bill — the client just asks at the front desk.' : 'No coins yet. Coins are bought at the front desk.',
        },
      };
    }

    case 'handoff_to_staff': {
      await deps.handoff(typeof i.reason === 'string' ? i.reason.slice(0, 300) : 'Client asked for help');
      return { result: { ok: true, note: 'The team has been alerted. Tell the client someone will reply here.' }, handoff: true };
    }

    default:
      throw new Error(`Unknown tool ${use.name}`);
  }
}

async function executePending(p: Pending, deps: EngineDeps, tz: string, today: string): Promise<string> {
  if (p.type === 'book') {
    const r = await deps.book({ serviceIds: p.serviceIds!, start: p.start!, staffId: p.staffId ?? null });
    return `Booked ✅ ${r.services.join(' + ')} with ${r.stylist}, ${describeWhen(r.start, tz, today)}.\nWe’ll remind you before your visit. Reply here any time to change or cancel.`;
  }
  if (p.type === 'cancel') {
    await deps.cancel(p.appointmentId!);
    return 'Your appointment is cancelled. Hope to see you soon — just message here when you’d like to book again.';
  }
  const r = await deps.reschedule(p.appointmentId!, p.start!, p.staffId ?? null);
  return `Done ✅ Your appointment is now ${describeWhen(r.start, tz, today)} with ${r.stylist}.`;
}
