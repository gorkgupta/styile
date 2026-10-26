'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail } from '@/lib/actions';
import type { ActionResult, Salon } from '@/lib/types';

// Platform console actions (the Styile team only). Each one re-checks profiles.is_platform_admin as the signed-in
// user, then writes with the service-role client.

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLANS: Salon['plan'][] = ['trial', 'starter', 'growth', 'pro'];
const STATUSES: Salon['plan_status'][] = ['trialing', 'active', 'past_due', 'suspended', 'cancelled'];

class AdminError extends Error {}

async function requirePlatformAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new AdminError('Your session has ended. Log in again.');
  const { data: profile } = await supabase.from('profiles').select('is_platform_admin').eq('id', auth.user.id).maybeSingle();
  if (!profile?.is_platform_admin) throw new AdminError('Only Styile platform admins can do this.');
  return auth.user;
}

function checkSalonId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new AdminError('Salon not found.');
  return id;
}

function failAdmin(e: unknown): ActionResult<never> {
  if (e instanceof AdminError) return { ok: false, error: e.message };
  console.error('admin action failed', e);
  return fail(e);
}

function refresh() { revalidatePath('/admin'); }

/** Change a salon's plan and subscription status; trialEndsAt is a YYYY-MM-DD date (end of that day, IST) or null to clear. */
export async function setSalonPlan(salonId: string, plan: Salon['plan'], status: Salon['plan_status'], trialEndsAt?: string | null): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const id = checkSalonId(salonId);
    if (!PLANS.includes(plan)) return { ok: false, error: 'Pick a plan.' };
    if (!STATUSES.includes(status)) return { ok: false, error: 'Pick a status.' };
    const patch: Record<string, unknown> = { plan, plan_status: status };
    if (trialEndsAt !== undefined) {
      if (trialEndsAt === null || trialEndsAt === '') patch.trial_ends_at = null;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(trialEndsAt) && !Number.isNaN(new Date(`${trialEndsAt}T23:59:59+05:30`).getTime())) {
        patch.trial_ends_at = new Date(`${trialEndsAt}T23:59:59+05:30`).toISOString();
      } else return { ok: false, error: 'Enter the trial end as a date.' };
    }
    const { data, error } = await createAdminClient().from('salons').update(patch).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: 'Salon not found.' };
    refresh();
    return { ok: true, message: 'Plan updated' };
  } catch (e) { return failAdmin(e); }
}

export interface ConnectWhatsAppInput { phoneNumberId: string; businessAccountId: string; displayNumber: string; accessToken?: string }

/** Route a WhatsApp Cloud API number to a salon. An empty token means the platform's system-user token is used. */
export async function connectWhatsApp(salonId: string, input: ConnectWhatsAppInput): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const id = checkSalonId(salonId);
    const phoneNumberId = String(input?.phoneNumberId ?? '').trim();
    const waba = String(input?.businessAccountId ?? '').trim();
    const display = String(input?.displayNumber ?? '').trim();
    const token = String(input?.accessToken ?? '').trim();
    if (!/^\d{6,20}$/.test(phoneNumberId)) return { ok: false, error: 'Phone number ID is the long number from WhatsApp Manager › API setup (digits only).' };
    if (!/^\d{6,20}$/.test(waba)) return { ok: false, error: 'WhatsApp Business Account ID should be digits only.' };
    if (display.replace(/\D/g, '').length < 10) return { ok: false, error: 'Enter the WhatsApp number clients see, with country code.' };
    if (token && (token.length < 20 || /\s/.test(token))) return { ok: false, error: 'That access token doesn’t look right. Paste the full token, or leave it empty to use the platform token.' };

    const db = createAdminClient();
    const { data: clash } = await db.from('salons').select('id, name').eq('wa_phone_number_id', phoneNumberId).neq('id', id).maybeSingle();
    if (clash) return { ok: false, error: `That phone number ID is already connected to ${clash.name}. Disconnect it there first.` };

    const { data, error } = await db.from('salons')
      .update({ wa_phone_number_id: phoneNumberId, wa_business_account_id: waba, wa_display_number: display })
      .eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: 'Salon not found.' };
    const { error: secretErr } = await db.from('salon_secrets')
      .upsert({ salon_id: id, wa_access_token: token || null, updated_at: new Date().toISOString() }, { onConflict: 'salon_id' });
    if (secretErr) throw secretErr;
    refresh();
    return { ok: true, message: 'WhatsApp connected' };
  } catch (e) { return failAdmin(e); }
}

export async function disconnectWhatsApp(salonId: string): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const id = checkSalonId(salonId);
    const db = createAdminClient();
    const { error } = await db.from('salons').update({ wa_phone_number_id: null, wa_business_account_id: null, wa_display_number: null }).eq('id', id);
    if (error) throw error;
    await db.from('salon_secrets').update({ wa_access_token: null, updated_at: new Date().toISOString() }).eq('salon_id', id);
    refresh();
    return { ok: true, message: 'WhatsApp disconnected' };
  } catch (e) { return failAdmin(e); }
}
