'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { can } from '@/lib/permissions';
import { fail, must } from '@/lib/actions';
import { cleanHours } from '@/lib/hours';
import { normalizePhone } from '@/lib/phone';
import type { ActionResult, Hours } from '@/lib/types';

// Salon settings. Only the owner can change these (RLS: salons_owner_update). Subscription, booking link
// and WhatsApp number fields are guarded by a trigger and managed by the platform admin, so they are
// never written from here.

const NOT_ALLOWED = 'Only the salon owner can change settings.';
const GST_RATES = [0, 5, 12, 18, 28];
const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60];
const ASSISTANT_NOTES_MAX = 1500; // keep in step with the Settings screen counter

function refresh() { revalidatePath('/app', 'layout'); }

async function ownerContext() {
  const ctx = await getSalonContext();
  return can(ctx.role, 'settings') ? ctx : null;
}

const text = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, max) : null;
};

export interface SalonProfileInput {
  name: string; legalName?: string | null; gstin?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; city?: string | null; state?: string | null; pincode?: string | null;
}

export async function updateSalonProfile(input: SalonProfileInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const name = text(input.name, 80);
    if (!name || name.length < 2) return { ok: false, error: 'Enter your salon’s name.' };
    const gstin = (input.gstin ?? '').replace(/\s/g, '').toUpperCase() || null;
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return { ok: false, error: 'GSTIN should be 15 characters, like 29ABCDE1234F1Z5. Leave it blank if you aren’t registered.' };
    let phone: string | null = null;
    if (input.phone && input.phone.trim()) {
      phone = normalizePhone(input.phone);
      if (!phone) return { ok: false, error: 'Enter a valid phone number with area or mobile code.' };
    }
    const email = (input.email ?? '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter a valid email address, or leave it blank.' };
    const pincode = (input.pincode ?? '').replace(/\s/g, '') || null;
    if (pincode && !/^[1-9][0-9]{5}$/.test(pincode)) return { ok: false, error: 'PIN code should be 6 digits.' };

    must(await ctx.supabase.from('salons').update({
      name, legal_name: text(input.legalName, 120), gstin, phone, email,
      address: text(input.address, 240), city: text(input.city, 60), state: text(input.state, 60), pincode,
    }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: 'Salon profile saved' };
  } catch (e) { return fail(e); }
}

export interface BillingSettingsInput { pricesIncludeTax: boolean; defaultGstRate: number; invoicePrefix: string }

export async function updateBilling(input: BillingSettingsInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const rate = Number(input.defaultGstRate);
    if (!GST_RATES.includes(rate)) return { ok: false, error: 'GST rate must be 0, 5, 12, 18 or 28%.' };
    const prefix = (input.invoicePrefix ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(prefix)) return { ok: false, error: 'Bill number prefix: 1 to 6 letters or numbers, like GS or INV.' };
    must(await ctx.supabase.from('salons').update({
      prices_include_tax: !!input.pricesIncludeTax, default_gst_rate: rate, invoice_prefix: prefix,
    }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: 'Billing settings saved' };
  } catch (e) { return fail(e); }
}

export async function updateBusinessHours(hours: Hours): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const h = cleanHours(hours);
    if (!h.ok) return { ok: false, error: h.error };
    if (!Object.values(h.hours).some((d) => d && d.length)) return { ok: false, error: 'Open at least one day a week.' };
    must(await ctx.supabase.from('branches').update({ business_hours: h.hours }).eq('id', ctx.branch.id).eq('salon_id', ctx.salon.id));
    refresh();
    return { ok: true, message: 'Opening hours saved' };
  } catch (e) { return fail(e); }
}

export interface OnlineBookingInput { bookingEnabled: boolean; slotIntervalMin: number; bookingLeadMin: number; bookingWindowDays: number }

export async function updateOnlineBooking(input: OnlineBookingInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const interval = Number(input.slotIntervalMin);
    const lead = Math.round(Number(input.bookingLeadMin));
    const windowDays = Math.round(Number(input.bookingWindowDays));
    if (!SLOT_INTERVALS.includes(interval)) return { ok: false, error: 'Time slots must be every 5, 10, 15, 20, 30 or 60 minutes.' };
    if (!Number.isFinite(lead) || lead < 0 || lead > 7 * 24 * 60) return { ok: false, error: 'Minimum notice must be between 0 minutes and 7 days.' };
    if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 180) return { ok: false, error: 'Clients can book between 1 and 180 days ahead.' };
    must(await ctx.supabase.from('salons').update({
      booking_enabled: !!input.bookingEnabled, slot_interval_min: interval, booking_lead_min: lead, booking_window_days: windowDays,
    }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: 'Online booking settings saved' };
  } catch (e) { return fail(e); }
}

export interface AssistantInput { botEnabled: boolean; instructions: string | null }

export async function updateAssistant(input: AssistantInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const instructions = (input.instructions ?? '').trim();
    if (instructions.length > ASSISTANT_NOTES_MAX) return { ok: false, error: `Keep the notes under ${ASSISTANT_NOTES_MAX} characters (now ${instructions.length}).` };
    must(await ctx.supabase.from('salons').update({ wa_bot_enabled: !!input.botEnabled, wa_bot_instructions: instructions || null }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: input.botEnabled ? 'Assistant settings saved' : 'Assistant turned off. Chats will wait for your team.' };
  } catch (e) { return fail(e); }
}
