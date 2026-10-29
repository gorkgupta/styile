'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { can } from '@/lib/permissions';
import { fail, must } from '@/lib/actions';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { cleanHours } from '@/lib/hours';
import { invalidPhoneMessage, normalizePhone } from '@/lib/phone';
import { cleanBio, cleanSpecialties, cleanYears, isStaffPhotoUrl } from '@/lib/stylists';
import type { ActionResult, Hours, MemberRole } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';

// Team: the people who appear on the calendar (staff rows) and who can sign in to the app
// (salon_members). A stylist can have a staff row without app access, and the owner usually has app access
// without being bookable.

const ROLES: MemberRole[] = ['owner', 'manager', 'receptionist', 'stylist'];
const NOT_ALLOWED = 'Only the owner or a manager can change the team.';
const OWNER_ONLY = 'Only the salon owner can manage who has app access.';

function refresh() { revalidatePath('/app', 'layout'); }

export interface StaffInput {
  id?: string;
  name: string;
  phone?: string | null;
  title?: string | null;
  color: string;
  commissionPct: number;
  bookable: boolean;
  active?: boolean;
  /** null = follow the salon's opening hours */
  workingHours: Hours | null;
  /** Services they perform; empty = all services */
  serviceIds: string[];
  // Booking page profile. Left out = unchanged.
  /** Public URL of a photo uploaded to this salon's folder in the staff-photos bucket; null = no photo. */
  photoUrl?: string | null;
  bio?: string | null;
  specialties?: string[];
  yearsExperience?: number | null;
  /** false = front desk only: not offered to clients online or on WhatsApp. */
  showOnBooking?: boolean;
}

export async function saveStaff(input: StaffInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getSalonContext();
    if (!can(ctx.role, 'manageStaff')) return { ok: false, error: NOT_ALLOWED };
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return { ok: false, error: 'Enter their name.' };
    if (name.length > 60) return { ok: false, error: 'Keep the name under 60 characters.' };
    let phone: string | null = null;
    if (input.phone && input.phone.trim()) {
      phone = normalizePhone(input.phone);
      if (!phone) return { ok: false, error: `${invalidPhoneMessage(input.phone).replace(/\.$/, '')}, or leave it blank.` };
    }
    const title = (input.title ?? '').trim().slice(0, 60) || null;
    const color = (input.color ?? '').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color)) return { ok: false, error: 'Pick a calendar colour.' };
    const commission = Math.round(Number(input.commissionPct) * 100) / 100;
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) return { ok: false, error: 'Commission must be between 0 and 100%.' };

    let workingHours: Hours | null = null;
    if (input.workingHours) {
      const h = cleanHours(input.workingHours);
      if (!h.ok) return { ok: false, error: h.error };
      workingHours = h.hours;
    }

    // Booking page profile (the database checks the same limits).
    const profile: Record<string, unknown> = {};
    if (input.photoUrl !== undefined) {
      if (input.photoUrl !== null && !isStaffPhotoUrl(input.photoUrl, env.supabaseUrl(), ctx.salon.id)) {
        return { ok: false, error: 'That photo didn’t upload properly. Remove it and add it again.' };
      }
      profile.photo_url = input.photoUrl;
    }
    if (input.bio !== undefined) {
      const bio = cleanBio(input.bio);
      if (!bio.ok) return { ok: false, error: bio.error };
      profile.bio = bio.value;
    }
    if (input.specialties !== undefined) {
      const sp = cleanSpecialties(input.specialties);
      if (!sp.ok) return { ok: false, error: sp.error };
      profile.specialties = sp.value;
    }
    if (input.yearsExperience !== undefined) {
      const years = cleanYears(input.yearsExperience);
      if (!years.ok) return { ok: false, error: years.error };
      profile.years_experience = years.value;
    }
    if (input.showOnBooking !== undefined) profile.show_on_booking = !!input.showOnBooking;

    const serviceIds = [...new Set(input.serviceIds ?? [])];
    if (serviceIds.length) {
      const found = must(await ctx.supabase.from('services').select('id').eq('salon_id', ctx.salon.id).in('id', serviceIds)) as { id: string }[];
      if (found.length !== serviceIds.length) return { ok: false, error: 'One of the services was removed. Refresh and try again.' };
    }

    const row = {
      name, phone, title, color, commission_pct: commission, bookable: !!input.bookable,
      active: input.active ?? true, working_hours: workingHours, ...profile,
    };
    let id = input.id;
    if (id) {
      const updated = must(await ctx.supabase.from('staff').update(row).eq('id', id).eq('salon_id', ctx.salon.id).select('id')) as { id: string }[];
      if (!updated.length) return { ok: false, error: 'That team member was removed. Refresh and try again.' };
    } else {
      const last = await ctx.supabase.from('staff').select('sort').eq('salon_id', ctx.salon.id).order('sort', { ascending: false }).limit(1).maybeSingle();
      const created = must(await ctx.supabase.from('staff').insert({ ...row, salon_id: ctx.salon.id, branch_id: ctx.branch.id, sort: (last.data?.sort ?? 0) + 1 })
        .select('id').single()) as { id: string };
      id = created.id;
    }

    // Replace their skills. No rows = can do every service.
    must(await ctx.supabase.from('staff_services').delete().eq('staff_id', id).eq('salon_id', ctx.salon.id));
    if (serviceIds.length) {
      must(await ctx.supabase.from('staff_services').insert(serviceIds.map((service_id) => ({ staff_id: id, service_id, salon_id: ctx.salon.id }))));
    }
    refresh();
    return { ok: true, data: { id }, message: input.id ? `${name} saved` : `${name} added to the team` };
  } catch (e) { return fail(e); }
}

/** Takes someone off the calendar and online booking. Past appointments and commissions keep their name. */
export async function deactivateStaff(id: string, active = false): Promise<ActionResult> {
  try {
    const ctx = await getSalonContext();
    if (!can(ctx.role, 'manageStaff')) return { ok: false, error: NOT_ALLOWED };
    if (!active) {
      const now = new Date().toISOString();
      const upcoming = await ctx.supabase.from('appointments').select('id', { count: 'exact', head: true })
        .eq('salon_id', ctx.salon.id).eq('staff_id', id).gte('start_at', now).in('status', ['booked', 'confirmed', 'checked_in']);
      if ((upcoming.count ?? 0) > 0) {
        return { ok: false, error: `They have ${upcoming.count} upcoming appointment${upcoming.count === 1 ? '' : 's'}. Move or cancel ${upcoming.count === 1 ? 'it' : 'them'} on the calendar first.` };
      }
    }
    must(await ctx.supabase.from('staff').update({ active }).eq('id', id).eq('salon_id', ctx.salon.id));
    refresh();
    return { ok: true, message: active ? 'Back on the team' : 'Removed from the calendar. Their history is kept.' };
  } catch (e) { return fail(e); }
}

export interface InviteInput { email: string; role: MemberRole; staffId?: string | null; name?: string | null }

/** Give someone a login to this salon. Sends a Supabase invite email to new users. */
export async function inviteMember(input: InviteInput): Promise<ActionResult> {
  try {
    const ctx = await getSalonContext();
    if (!can(ctx.role, 'manageTeamAccess')) return { ok: false, error: OWNER_ONLY };
    const email = (input.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
    if (!ROLES.includes(input.role)) return { ok: false, error: 'Choose a role.' };

    let staffName: string | null = null;
    if (input.staffId) {
      const st = await ctx.supabase.from('staff').select('id, name, user_id').eq('id', input.staffId).eq('salon_id', ctx.salon.id).maybeSingle();
      if (!st.data) return { ok: false, error: 'That team member was removed. Refresh and try again.' };
      if (st.data.user_id) return { ok: false, error: `${st.data.name} already has app access.` };
      staffName = st.data.name as string;
    }
    const fullName = (input.name ?? '').trim() || staffName || null;

    const admin = createAdminClient();
    let userId: string | null = null;
    let invited = false;
    const res = await admin.auth.admin.inviteUserByEmail(email, {
      data: fullName ? { full_name: fullName } : {},
      redirectTo: `${env.appUrl()}/login`,
    });
    if (res.error) {
      // Already has a Styile login (e.g. works at another salon or is a client): link the existing account.
      const msg = String(res.error.message ?? '').toLowerCase();
      if (!msg.includes('already') && !msg.includes('registered') && !msg.includes('exists')) throw res.error;
      const profile = await admin.from('profiles').select('id').ilike('email', email.replace(/[%_\\]/g, '\\$&')).maybeSingle();
      if (!profile.data) return { ok: false, error: 'This email already has an account but we couldn’t find it. Ask them to sign in once, then try again.' };
      userId = profile.data.id as string;
      // Only link the login whose own, confirmed email is this address (never trust the profile row alone).
      const existingUser = (await admin.auth.admin.getUserById(userId)).data?.user as { email?: string | null; email_confirmed_at?: string | null } | undefined;
      if (String(existingUser?.email ?? '').toLowerCase() !== email || !existingUser?.email_confirmed_at) return { ok: false, error: 'This email already has an account but it isn’t confirmed yet. Ask them to open their confirmation email, then try again.' };
    } else {
      userId = (res.data?.user?.id as string | undefined) ?? null;
      invited = true;
    }
    if (!userId) return { ok: false, error: 'Couldn’t send the invite. Please try again.' };

    const existing = await admin.from('salon_members').select('role').eq('salon_id', ctx.salon.id).eq('user_id', userId).maybeSingle();
    if (existing.data) return { ok: false, error: `${email} already has access as ${ROLE_LABEL[existing.data.role as MemberRole]}. Change their role below instead.` };

    // Admin client: we've checked the caller is this salon's owner above.
    must(await admin.from('salon_members').insert({ salon_id: ctx.salon.id, user_id: userId, role: input.role, staff_id: input.staffId || null }));
    if (input.staffId) {
      must(await admin.from('staff').update({ user_id: userId }).eq('id', input.staffId).eq('salon_id', ctx.salon.id));
    }
    refresh();
    return {
      ok: true,
      message: invited ? `Invite sent to ${email}` : `${email} already had a Styile login — they can now open ${ctx.salon.name}.`,
    };
  } catch (e) { return fail(e); }
}

async function countOwners(ctx: Awaited<ReturnType<typeof getSalonContext>>) {
  const { count } = await ctx.supabase.from('salon_members').select('user_id', { count: 'exact', head: true }).eq('salon_id', ctx.salon.id).eq('role', 'owner');
  return count ?? 0;
}

export async function changeMemberRole(userId: string, role: MemberRole): Promise<ActionResult> {
  try {
    const ctx = await getSalonContext();
    if (!can(ctx.role, 'manageTeamAccess')) return { ok: false, error: OWNER_ONLY };
    if (!ROLES.includes(role)) return { ok: false, error: 'Choose a role.' };
    const cur = must(await ctx.supabase.from('salon_members').select('role').eq('salon_id', ctx.salon.id).eq('user_id', userId).single()) as { role: MemberRole };
    if (cur.role === role) return { ok: true };
    if (userId === ctx.user.id) return { ok: false, error: 'You can’t change your own role. Ask another owner to do it.' };
    if (cur.role === 'owner' && (await countOwners(ctx)) <= 1) return { ok: false, error: 'Your salon needs at least one owner. Make someone else an owner first.' };
    must(await ctx.supabase.from('salon_members').update({ role }).eq('salon_id', ctx.salon.id).eq('user_id', userId));
    refresh();
    return { ok: true, message: `Role changed to ${ROLE_LABEL[role]}` };
  } catch (e) { return fail(e); }
}

export async function removeMember(userId: string): Promise<ActionResult> {
  try {
    const ctx = await getSalonContext();
    if (!can(ctx.role, 'manageTeamAccess')) return { ok: false, error: OWNER_ONLY };
    if (userId === ctx.user.id) return { ok: false, error: 'You can’t remove yourself. Ask another owner to do it.' };
    const cur = must(await ctx.supabase.from('salon_members').select('role').eq('salon_id', ctx.salon.id).eq('user_id', userId).single()) as { role: MemberRole };
    if (cur.role === 'owner' && (await countOwners(ctx)) <= 1) return { ok: false, error: 'Your salon needs at least one owner.' };
    must(await ctx.supabase.from('salon_members').delete().eq('salon_id', ctx.salon.id).eq('user_id', userId));
    // Keep the staff row (calendar history) but unlink the login.
    must(await ctx.supabase.from('staff').update({ user_id: null }).eq('salon_id', ctx.salon.id).eq('user_id', userId));
    refresh();
    return { ok: true, message: 'App access removed' };
  } catch (e) { return fail(e); }
}
