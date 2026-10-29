'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { fail, must } from '@/lib/actions';
import { can } from '@/lib/permissions';
import { notifyInvoice, notifyPackageSold } from '@/lib/whatsapp/outbox';
import { checkPackage, checkPlan, CLIENT_PACKAGE_SELECT, normalizeClientPackage, normalizeMembership, type PackageInput, type PlanInput } from '@/lib/packages';
import { getClientBenefits as benefitsOf } from '@/lib/queries';
import { localDate } from '@/lib/time';
import { ALL_PAY_METHODS, MONEY_METHODS, type ActionResult, type ClientMembership, type ClientPackage, type PayMethod } from '@/lib/types';

// Packages ("6 Facials for ₹9,000") and membership cards ("Glow Card: 10% off services for a year").
// Selling a package gives a package receipt, not a tax invoice — GST is charged on the bill when a session is used.
// A membership card's fee is billed as a normal bill line. All the rules live in 0012_packages_memberships.sql.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (s: unknown): s is string => typeof s === 'string' && ID_RE.test(s);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const MENU_ONLY = 'Only the owner or a manager can change packages and membership cards.';

function refresh() { revalidatePath('/app', 'layout'); }

// ---------------------------------------------------------------------------
// The menu (owner / manager)
// ---------------------------------------------------------------------------
export async function savePackage(input: PackageInput & { id?: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'manageMenu')) return { ok: false, error: MENU_ONLY };
    if (input.id && !isId(input.id)) return { ok: false, error: 'Package not found. Refresh and try again.' };
    const checked = checkPackage(input);
    if (!checked.ok) return checked;
    const v = checked.value;
    const row = must(await supabase.rpc('save_service_package', {
      p_salon: salon.id, p_package: input.id || null,
      p_data: {
        name: v.name, description: v.description, price: v.price, validity_days: v.validityDays, active: v.active,
        items: v.items.map((i) => ({ service_id: i.serviceId, sessions: i.sessions })),
      },
    })) as { id: string };
    refresh();
    return { ok: true, data: { id: row.id }, message: input.id ? 'Package saved' : 'Package added' };
  } catch (e) { return fail(e); }
}

/** Stop selling a package (clients who bought it keep their sessions), or sell it again. */
export async function setPackageActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'manageMenu')) return { ok: false, error: MENU_ONLY };
    if (!isId(id)) return { ok: false, error: 'Package not found.' };
    must(await supabase.from('service_packages').update({ active: !!active }).eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true, message: active ? 'Package is on sale again' : 'Package taken off sale. Clients keep the sessions they bought.' };
  } catch (e) { return fail(e); }
}

export async function savePlan(input: PlanInput & { id?: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'manageMenu')) return { ok: false, error: MENU_ONLY };
    if (input.id && !isId(input.id)) return { ok: false, error: 'Card not found. Refresh and try again.' };
    const checked = checkPlan(input);
    if (!checked.ok) return checked;
    const v = checked.value;
    const row = {
      name: v.name, description: v.description, fee: v.fee, validity_days: v.validityDays,
      service_discount_pct: v.serviceDiscountPct, product_discount_pct: v.productDiscountPct, active: v.active,
    };
    if (input.id) {
      must(await supabase.from('membership_plans').update(row).eq('id', input.id).eq('salon_id', salon.id).select('id').single());
      refresh();
      return { ok: true, data: { id: input.id }, message: 'Card saved. Cards already sold keep their discount.' };
    }
    const created = must(await supabase.from('membership_plans').insert({ salon_id: salon.id, ...row }).select('id').single()) as { id: string };
    refresh();
    return { ok: true, data: { id: created.id }, message: 'Membership card added' };
  } catch (e) { return fail(e); }
}

export async function setPlanActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'manageMenu')) return { ok: false, error: MENU_ONLY };
    if (!isId(id)) return { ok: false, error: 'Card not found.' };
    must(await supabase.from('membership_plans').update({ active: !!active }).eq('id', id).eq('salon_id', salon.id));
    refresh();
    return { ok: true, message: active ? 'Card is on sale again' : 'Card taken off sale. Members keep their discount until their card ends.' };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// At the desk
// ---------------------------------------------------------------------------
export interface SellPackageInput {
  customerId: string; packageId: string; method: PayMethod; reference?: string | null; note?: string | null;
  /** Send the client the package receipt on WhatsApp (default true). */
  sendOnWhatsApp?: boolean;
}

/** Sell a package: money received with a package receipt (not a tax invoice). */
export async function sellPackage(input: SellPackageInput): Promise<ActionResult<{ package: ClientPackage; sentOnWhatsApp: boolean }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'sellPackages')) return { ok: false, error: 'Your role can’t sell packages. Ask the front desk or a manager.' };
    if (!isId(input.customerId)) return { ok: false, error: 'Choose a client first.' };
    if (!isId(input.packageId)) return { ok: false, error: 'Pick a package.' };
    if (!MONEY_METHODS.includes(input.method)) return { ok: false, error: 'Pick how the client paid: cash, UPI or card. Coins can’t buy a package.' };
    const row = must(await supabase.rpc('sell_package', {
      p_salon: salon.id, p_customer: input.customerId, p_package: input.packageId, p_method: input.method,
      p_reference: input.reference?.trim().slice(0, 120) || null, p_note: input.note?.trim().slice(0, 300) || null,
    })) as { id: string; receipt_no: string };
    const pkg = normalizeClientPackage(must(await supabase.from('client_packages').select(CLIENT_PACKAGE_SELECT).eq('id', row.id).single()));
    let message = `${pkg.name} sold · receipt ${pkg.receipt_no}`;
    let sentOnWhatsApp = false;
    if (input.sendOnWhatsApp !== false) {
      const sent = await notifyPackageSold(salon.id, pkg.id);
      sentOnWhatsApp = sent.sent;
      if (sent.sent) message += ' · sent on WhatsApp';
      else if (sent.reason !== 'WhatsApp is not connected') message += ` · not sent on WhatsApp (${sent.reason ?? 'send failed'})`;
    }
    refresh();
    return { ok: true, data: { package: pkg, sentOnWhatsApp }, message };
  } catch (e) { return fail(e); }
}

/** Owner/manager: cancel a package, optionally recording money handed back (shows on that day's close). */
export async function cancelPackage(id: string, reason: string, refund?: { amount: number; method: PayMethod } | null): Promise<ActionResult> {
  try {
    const { supabase, role } = await getSalonContext();
    if (!can(role, 'cancelPackages')) return { ok: false, error: 'Only an owner or manager can cancel a package.' };
    if (!isId(id)) return { ok: false, error: 'Package not found.' };
    if (!reason?.trim()) return { ok: false, error: 'Give a reason — it stays with the package.' };
    if (refund && (!finite(refund.amount) || refund.amount <= 0)) return { ok: false, error: 'Enter the money handed back, or leave it empty.' };
    if (refund && !MONEY_METHODS.includes(refund.method)) return { ok: false, error: 'Say how the money was handed back: cash, UPI or card.' };
    must(await supabase.rpc('cancel_client_package', {
      p_package: id, p_reason: reason.trim().slice(0, 300),
      p_refund: refund ? Math.round(refund.amount * 100) / 100 : null, p_refund_method: refund ? refund.method : null,
    }));
    refresh();
    return { ok: true, message: refund ? 'Package cancelled and the money handed back recorded' : 'Package cancelled' };
  } catch (e) { return fail(e); }
}

export interface SellMembershipInput {
  customerId: string; planId: string;
  payments: { method: PayMethod; amount: number; reference?: string | null }[];
  /** Send the card's bill on WhatsApp. */
  sendOnWhatsApp?: boolean;
}

/** Sell (or renew) a membership card. The fee is billed as a normal bill line, so the salon's GST mode applies. */
export async function sellMembership(input: SellMembershipInput): Promise<ActionResult<{ invoiceId: string; invoiceNo: string; membership: ClientMembership }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'sellPackages')) return { ok: false, error: 'Your role can’t sell membership cards. Ask the front desk or a manager.' };
    if (!isId(input.customerId)) return { ok: false, error: 'Choose a client first.' };
    if (!isId(input.planId)) return { ok: false, error: 'Pick a membership card.' };
    const payments = (input.payments ?? []).filter((p) => finite(p.amount) && p.amount > 0);
    if (!payments.length) return { ok: false, error: 'Take the card fee: cash, UPI, card or coins.' };
    for (const p of payments) if (!ALL_PAY_METHODS.includes(p.method)) return { ok: false, error: 'Pick a payment method.' };
    const r = must(await supabase.rpc('sell_membership', {
      p_salon: salon.id, p_customer: input.customerId, p_plan: input.planId,
      p_payments: payments.map((p) => ({ method: p.method, amount: Math.round(p.amount * 100) / 100, reference: p.reference?.trim() || null })),
    })) as { membership: ClientMembership; invoice: { id: string; invoice_no: string } };
    let message = `${r.membership.name} sold · bill ${r.invoice.invoice_no}`;
    if (input.sendOnWhatsApp) {
      const sent = await notifyInvoice(r.invoice.id);
      message += sent.sent ? ' · sent on WhatsApp' : sent.reason === 'WhatsApp is not connected' ? '' : ` · not sent on WhatsApp (${sent.reason ?? 'send failed'})`;
    }
    refresh();
    return { ok: true, data: { invoiceId: r.invoice.id, invoiceNo: r.invoice.invoice_no, membership: normalizeMembership(r.membership) }, message };
  } catch (e) { return fail(e); }
}

/** What a client can use on a bill today: packages with sessions left, and their membership card. For the POS. */
export async function getClientBenefits(customerId: string): Promise<ActionResult<{ packages: ClientPackage[]; membership: ClientMembership | null; advance: { left: number; receipts: string[] } }>> {
  try {
    const { supabase, salon, role } = await getSalonContext();
    if (!can(role, 'bill')) return { ok: false, error: 'Your role can’t bill.' };
    if (!isId(customerId)) return { ok: false, error: 'Client not found.' };
    return { ok: true, data: await benefitsOf(supabase, salon.id, customerId, localDate(new Date(), salon.timezone)) };
  } catch (e) { return fail(e); }
}
