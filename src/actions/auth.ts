'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_SALON_COOKIE } from '@/lib/context';
import { cookieDomain, isReservedSlug, rootDomain, salonUrl, SLUG_RE } from '@/lib/tenant';
import { errorMessage } from '@/lib/actions';
import { invalidPhoneMessage, normalizePhone } from '@/lib/phone';
import { safeNextPath } from '@/lib/safe-next';
import { cleanGstin, GSTIN_RE, stateByCode, stateByName } from '@/lib/gst';
import type { ActionResult } from '@/lib/types';
import { isLocale, LANG_COOKIE } from '@/lib/i18n/locales';
import { revalidatePath } from 'next/cache';

function safeNext(next: FormDataEntryValue | null, fallback: string) {
  return safeNextPath(next) ?? fallback;
}

export async function signIn(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get('email') || '').trim(),
    password: String(form.get('password') || ''),
  });
  if (error) return { ok: false, error: error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : errorMessage(error) };
  redirect(safeNext(form.get('next'), '/app'));
}

export async function signUp(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const name = String(form.get('name') || '').trim();
  if (!name) return { ok: false, error: 'Enter your name.' };
  if (password.length < 8) return { ok: false, error: 'Use at least 8 characters for the password.' };
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name }, emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/onboarding` },
  });
  if (error) return { ok: false, error: errorMessage(error) };
  if (!data.session) return { ok: true, message: 'Check your email and open the link to confirm your account.' };
  redirect('/onboarding');
}

/** The signed-in user's own app language (profiles.locale); also remembered on this browser for the salon site. */
export async function setMyLanguage(locale: string): Promise<ActionResult> {
  try {
    if (!isLocale(locale)) return { ok: false, error: 'Pick English, हिन्दी, नेपाली or বাংলা.' };
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { ok: false, error: 'Your session has ended. Log in again.' };
    // RLS (profiles_self_update) lets a user change only their own profile.
    const { error } = await supabase.from('profiles').update({ locale: locale === 'en' ? null : locale }).eq('id', data.user.id);
    if (error) return { ok: false, error: errorMessage(error) };
    (await cookies()).set(LANG_COOKIE, locale, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, domain: cookieDomain() });
    revalidatePath('/app', 'layout');
    return { ok: true };
  } catch (e) { return { ok: false, error: errorMessage(e) }; }
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function switchSalon(form: FormData) {
  const id = String(form.get('salon_id') || '');
  (await cookies()).set(ACTIVE_SALON_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  if (rootDomain()) {
    // Each salon has its own address; RLS only returns salons this user belongs to.
    const supabase = await createClient();
    const { data } = await supabase.from('salons').select('slug').eq('id', id).maybeSingle();
    if (data?.slug) redirect(salonUrl(data.slug, '/app'));
  }
  redirect('/app');
}

export async function createSalon(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const name = String(form.get('name') || '').trim();
  const slug = String(form.get('slug') || '').trim().toLowerCase();
  const phoneRaw = String(form.get('phone') || '').trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (name.length < 2) return { ok: false, error: 'Enter your salon name.' };
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'Your salon address can use lowercase letters, numbers and dashes (3–40 characters).' };
  if (isReservedSlug(slug)) return { ok: false, error: `“${slug}” is reserved. Try your salon’s name, for example ${slug}-salon.` };
  if (phoneRaw && !phone) return { ok: false, error: invalidPhoneMessage(phoneRaw) };
  const gstMode = String(form.get('gst_mode') || '');
  if (!['unregistered', 'composition', 'regular'].includes(gstMode)) return { ok: false, error: 'Tell us whether your salon is GST registered. Choose “Not registered” if you aren’t sure — you can change it later.' };
  const gstin = gstMode === 'unregistered' ? null : cleanGstin(String(form.get('gstin') || '')) || null;
  if (gstMode !== 'unregistered' && !gstin) return { ok: false, error: 'Enter your GSTIN, or choose “Not registered”.' };
  if (gstin && !GSTIN_RE.test(gstin)) return { ok: false, error: 'GSTIN should be 15 characters, like 19ABCDE1234F1Z5.' };
  // The GSTIN's first two digits are the state it was issued in.
  const state = stateByName(String(form.get('state') || '')) ?? stateByCode(gstin?.slice(0, 2));
  const { data, error } = await supabase.rpc('create_salon', {
    p_name: name, p_slug: slug, p_phone: phone, p_city: String(form.get('city') || '').trim() || null,
    p_owner_name: String(form.get('owner_name') || '').trim() || null, p_seed_menu: form.get('seed') !== 'off',
    p_gst_mode: gstMode, p_gstin: gstin, p_state: state?.name ?? null,
  });
  if (error) return { ok: false, error: errorMessage(error) };
  (await cookies()).set(ACTIVE_SALON_COOKIE, (data as { id: string }).id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  // Straight to the salon's own address (the login cookie is shared across *.styile.com).
  redirect(rootDomain() ? salonUrl(slug, '/app?welcome=1') : '/app?welcome=1');
}
