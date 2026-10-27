'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_SALON_COOKIE } from '@/lib/context';
import { isReservedSlug, rootDomain, salonUrl, SLUG_RE } from '@/lib/tenant';
import { errorMessage } from '@/lib/actions';
import { normalizePhone } from '@/lib/phone';
import { safeNextPath } from '@/lib/safe-next';
import type { ActionResult } from '@/lib/types';

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
  if (phoneRaw && !phone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
  const { data, error } = await supabase.rpc('create_salon', {
    p_name: name, p_slug: slug, p_phone: phone, p_city: String(form.get('city') || '').trim() || null,
    p_owner_name: String(form.get('owner_name') || '').trim() || null, p_seed_menu: form.get('seed') !== 'off',
  });
  if (error) return { ok: false, error: errorMessage(error) };
  (await cookies()).set(ACTIVE_SALON_COOKIE, (data as { id: string }).id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  // Straight to the salon's own address (the login cookie is shared across *.styile.com).
  redirect(rootDomain() ? salonUrl(slug, '/app?welcome=1') : '/app?welcome=1');
}
