import { TeamScreen, type TeamMemberRow } from '@/components/app/team';
import { requirePermission } from '@/lib/context';
import { can } from '@/lib/permissions';
import { getMenu, getTeam } from '@/lib/queries';
import type { MemberRole } from '@/lib/types';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const ctx = await requirePermission('manageStaff');
  const [staff, menu, skills, members] = await Promise.all([
    getTeam(ctx.supabase, ctx.salon.id, true),
    getMenu(ctx.supabase, ctx.salon.id),
    ctx.supabase.from('staff_services').select('staff_id, service_id').eq('salon_id', ctx.salon.id),
    ctx.supabase.from('salon_members').select('user_id, role, staff_id').eq('salon_id', ctx.salon.id),
  ]);

  // Names and emails of people with app access (profiles are readable by members of the same salon).
  const memberRows = (members.data ?? []) as { user_id: string; role: MemberRole; staff_id: string | null }[];
  const profiles = memberRows.length
    ? (await ctx.supabase.from('profiles').select('id, full_name, email').in('id', memberRows.map((m) => m.user_id))).data ?? []
    : [];
  const byId = new Map<string, { full_name: string | null; email: string | null }>(
    (profiles as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p]),
  );
  const team: TeamMemberRow[] = memberRows.map((m) => ({
    user_id: m.user_id, role: m.role, staff_id: m.staff_id,
    name: byId.get(m.user_id)?.full_name ?? null, email: byId.get(m.user_id)?.email ?? null,
  }));

  const skillMap: Record<string, string[]> = {};
  for (const r of (skills.data ?? []) as { staff_id: string; service_id: string }[]) (skillMap[r.staff_id] ??= []).push(r.service_id);

  return (
    <TeamScreen
      salonId={ctx.salon.id}
      staff={staff}
      skills={skillMap}
      services={menu.services}
      categories={menu.categories}
      branchHours={ctx.branch.business_hours}
      members={team}
      canManageAccess={can(ctx.role, 'manageTeamAccess')}
      currentUserId={ctx.user.id}
    />
  );
}
