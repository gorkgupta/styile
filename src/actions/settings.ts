'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { can } from '@/lib/permissions';
import { fail, must } from '@/lib/actions';
import { checkCoinPacks } from '@/lib/coins';
import { cleanHours } from '@/lib/hours';
import { invalidPhoneMessage, normalizePhone } from '@/lib/phone';
import { cleanGstin, GSTIN_RE, stateByCode, stateByName } from '@/lib/gst';
import { isValidVpa } from '@/lib/upi';
import { isLocale } from '@/lib/i18n/locales';
import { ALL_PAY_METHODS, type ActionResult, type CoinPack, type GstMode, type Hours, type PayMethod, type ReceiptSize } from '@/lib/types';

// Salon settings. Only the owner can change these (RLS: salons_owner_update). Subscription, booking link
// and WhatsApp number fields are guarded by a trigger and managed by the platform admin, so they are
// never written from here.

const NOT_ALLOWED = 'Only the salon owner can change settings.';
const GST_MODES: GstMode[] = ['unregistered', 'composition', 'regular'];
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

// GSTIN and state are saved with the GST status in updateBilling (Settings → Billing & GST).
export interface SalonProfileInput {
  name: string; legalName?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; city?: string | null; pincode?: string | null;
}

export async function updateSalonProfile(input: SalonProfileInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const name = text(input.name, 80);
    if (!name || name.length < 2) return { ok: false, error: 'Enter your salon’s name.' };
    let phone: string | null = null;
    if (input.phone && input.phone.trim()) {
      phone = normalizePhone(input.phone);
      if (!phone) return { ok: false, error: `${invalidPhoneMessage(input.phone).replace(/\.$/, '')}, or leave it blank.` };
    }
    const email = (input.email ?? '').trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter a valid email address, or leave it blank.' };
    const pincode = (input.pincode ?? '').replace(/\s/g, '') || null;
    if (pincode && !/^[1-9][0-9]{5}$/.test(pincode)) return { ok: false, error: 'PIN code should be 6 digits.' };

    must(await ctx.supabase.from('salons').update({
      name, legal_name: text(input.legalName, 120), phone, email,
      address: text(input.address, 240), city: text(input.city, 60), pincode,
    }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: 'Salon profile saved' };
  } catch (e) { return fail(e); }
}

export interface BillingSettingsInput {
  gstMode: GstMode; gstin?: string | null; state: string; pricesIncludeTax: boolean; invoicePrefix: string;
}

/** GST status, GSTIN, state (place of supply), price display and bill numbering. */
export async function updateBilling(input: BillingSettingsInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    if (!GST_MODES.includes(input.gstMode)) return { ok: false, error: 'Choose your GST status.' };
    const registered = input.gstMode !== 'unregistered';
    const gstin = cleanGstin(input.gstin) || null;
    if (registered && !gstin) return { ok: false, error: 'Enter your GSTIN. It’s printed on every bill once you’re registered.' };
    if (gstin && !GSTIN_RE.test(gstin)) return { ok: false, error: 'GSTIN should be 15 characters, like 19ABCDE1234F1Z5.' };
    const state = stateByName(input.state);
    if (!state) return { ok: false, error: 'Choose your state from the list.' };
    if (registered && gstin && stateByCode(gstin.slice(0, 2)) && gstin.slice(0, 2) !== state.code) {
      return { ok: false, error: `Your GSTIN starts with ${gstin.slice(0, 2)} (${stateByCode(gstin.slice(0, 2))!.name}), but the state is ${state.name}. Check both.` };
    }
    const prefix = (input.invoicePrefix ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(prefix)) return { ok: false, error: 'Bill number prefix: 1 to 6 letters or numbers, like GS or INV.' };
    must(await ctx.supabase.from('salons').update({
      gst_mode: input.gstMode,
      // An unregistered salon's old GSTIN is kept (it isn't printed) so switching back doesn't lose it.
      gstin: gstin ?? (registered ? null : ctx.salon.gstin),
      state: state.name,
      prices_include_tax: !!input.pricesIncludeTax, invoice_prefix: prefix,
    }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: input.gstMode === ctx.salon.gst_mode ? 'Billing settings saved' : 'GST status saved. New bills use it from now on.' };
  } catch (e) { return fail(e); }
}

export interface PaymentSettingsInput { methods: PayMethod[]; upiVpa: string | null; upiPayeeName: string | null; receiptSize: ReceiptSize
  /** Advance / cancellation policy printed on advance receipts (optional). */
  advancePolicy?: string | null;
}

/** Payment types the desk sees, the salon's own UPI ID for pay-by-QR, and the default receipt paper. */
export async function updatePayments(input: PaymentSettingsInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const methods = ALL_PAY_METHODS.filter((m) => (input.methods ?? []).includes(m));
    if (!methods.some((m) => m !== 'wallet')) return { ok: false, error: 'Keep at least one way to pay besides coins, such as Cash.' };
    const vpa = (input.upiVpa ?? '').trim() || null;
    if (vpa && !isValidVpa(vpa)) return { ok: false, error: 'UPI ID looks like name@bank, for example glowstudio@okicici. Copy it from your UPI app.' };
    const payee = text(input.upiPayeeName, 50);
    if (vpa && !payee) return { ok: false, error: 'Add the name clients should see when they pay (your salon or account name).' };
    if (!['a4', '80', '58'].includes(input.receiptSize)) return { ok: false, error: 'Choose A4, 80 mm or 58 mm for receipts.' };
    must(await ctx.supabase.from('salons').update({
      payment_methods: methods, upi_vpa: vpa, upi_payee_name: vpa ? payee : null, receipt_size: input.receiptSize,
      ...(input.advancePolicy !== undefined ? { advance_policy: text(input.advancePolicy, 500) } : {}),
    }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: 'Payment settings saved' };
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

export interface OnlineBookingInput {
  bookingEnabled: boolean; slotIntervalMin: number; bookingLeadMin: number; bookingWindowDays: number;
  /** Language of the booking page and the client pages (en, hi, ne, bn); clients can switch it themselves. */
  defaultLocale?: string;
}

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
    if (input.defaultLocale !== undefined && !isLocale(input.defaultLocale)) return { ok: false, error: 'Pick English, Hindi, Nepali or Bengali for your booking page.' };
    must(await ctx.supabase.from('salons').update({
      booking_enabled: !!input.bookingEnabled, slot_interval_min: interval, booking_lead_min: lead, booking_window_days: windowDays,
      ...(input.defaultLocale !== undefined ? { default_locale: input.defaultLocale } : {}),
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

export interface CoinSettingsInput { enabled: boolean; packs: CoinPack[] }

/** Turn coin sales on/off and set the coin packs the front desk can sell. */
export async function updateCoinSettings(input: CoinSettingsInput): Promise<ActionResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx) return { ok: false, error: NOT_ALLOWED };
    const packs = checkCoinPacks(input.packs);
    if (!packs.ok) return { ok: false, error: packs.error };
    must(await ctx.supabase.from('salons').update({ coins_enabled: !!input.enabled, coin_packs: packs.packs }).eq('id', ctx.salon.id));
    refresh();
    return { ok: true, message: input.enabled ? 'Coin settings saved' : 'Coin sales turned off. Clients can still use the coins they have.' };
  } catch (e) { return fail(e); }
}
