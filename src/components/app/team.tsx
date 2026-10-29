'use client';
import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Dialog, Empty, Notice, Panel, Segmented, SelectField, Sheet, Switch, TextField, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { HoursEditor } from './hours-editor';
import { removeStaffPhoto, StylistProfileFields, type StylistProfileValue } from './stylist-profile';
import { changeMemberRole, deactivateStaff, inviteMember, removeMember, saveStaff } from '@/actions/team';
import { daysLabel, openDays, WEEK_DAYS } from '@/lib/hours';
import { formatPhone } from '@/lib/phone';
import { PhoneInput } from '@/components/ui/phone-input';
import { nextStaffColor, STAFF_COLORS } from '@/lib/staff-colors';
import type { Hours, MemberRole, Service, ServiceCategory, Staff } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';

export interface TeamMemberRow { user_id: string; role: MemberRole; staff_id: string | null; name: string | null; email: string | null }

export interface TeamProps {
  salonId: string;                     // folder for stylist photos in storage
  staff: Staff[];                      // including inactive
  skills: Record<string, string[]>;    // staff id -> service ids; missing/empty = all services
  services: Service[];                 // active services
  categories: ServiceCategory[];
  branchHours: Hours;
  members: TeamMemberRow[];
  canManageAccess: boolean;
  currentUserId: string;
}

const ROLES: MemberRole[] = ['owner', 'manager', 'receptionist', 'stylist'];
const ROLE_HELP: Record<MemberRole, string> = {
  owner: 'Everything, including settings and who has access.',
  manager: 'Everything except salon settings and team access.',
  receptionist: 'Calendar, clients, billing and the WhatsApp inbox.',
  stylist: 'Their own calendar and clients.',
};

/** Hours for a stylist: their own, else the salon's. */
const effectiveHours = (s: Staff, branch: Hours) => s.working_hours ?? branch;

export function TeamScreen(p: TeamProps) {
  const [editing, setEditing] = useState<Staff | 'new' | null>(null);
  const active = p.staff.filter((s) => s.active);
  const inactive = p.staff.filter((s) => !s.active);
  const memberByStaff = useMemo(() => new Map<string, TeamMemberRow>(p.members.filter((m) => m.staff_id).map((m) => [m.staff_id as string, m])), [p.members]);

  return (
    <>
      <Topbar title="Team" subtitle={`${active.filter((s) => s.bookable).length} on the calendar · ${p.members.length} with app access`}
        actions={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}><span className="hide-mobile">Add team member</span><span className="show-mobile">Add</span></Button>} />
      <div className="page page-narrow">
        <Panel title="Stylists & staff" flush>
          {active.length ? (
            <ul className="list">
              {active.map((s) => (
                <Fragment key={s.id}>
                  <StaffRow s={s} branchHours={p.branchHours} skills={p.skills[s.id]} totalServices={p.services.length}
                    member={memberByStaff.get(s.id)} onOpen={() => setEditing(s)} />
                </Fragment>
              ))}
            </ul>
          ) : (
            <Empty icon="users" title="Add your team" action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add team member</Button>}>
              Each stylist gets a column on the calendar, and clients can pick them when booking online or on WhatsApp.
            </Empty>
          )}
        </Panel>

        {inactive.length > 0 && (
          <Panel title={<div className="row"><h2>Former staff</h2><span className="badge">{inactive.length}</span></div>} flush>
            <ul className="list">
              {inactive.map((s) => (
                <Fragment key={s.id}><StaffRow s={s} branchHours={p.branchHours} skills={p.skills[s.id]} totalServices={p.services.length} onOpen={() => setEditing(s)} /></Fragment>
              ))}
            </ul>
          </Panel>
        )}

        <AccessPanel {...p} />
      </div>
      <StaffSheet salonId={p.salonId} editing={editing} onClose={() => setEditing(null)} team={p.staff} services={p.services} categories={p.categories}
        skills={p.skills} branchHours={p.branchHours} member={editing && editing !== 'new' ? memberByStaff.get(editing.id) : undefined} />
    </>
  );
}

function StaffRow({ s, branchHours, skills, totalServices, member, onOpen }: {
  s: Staff; branchHours: Hours; skills?: string[]; totalServices: number; member?: TeamMemberRow; onOpen: () => void;
}) {
  const days = openDays(effectiveHours(s, branchHours));
  const svcCount = skills?.length ? skills.length : totalServices;
  return (
    <li style={{ padding: 0 }}>
      <button type="button" className="staff-row" onClick={onOpen}>
        <Avatar name={s.name} color={s.active ? s.color : 'var(--faint)'} photo={s.active ? s.photo_url : null} />
        <div className="staff-name">
          <div className="row" style={{ gap: 6, minWidth: 0 }}>
            <span className="strong truncate">{s.name}</span>
            {!s.bookable && s.active && <Badge>Not bookable</Badge>}
            {s.bookable && s.active && s.show_on_booking === false && <Badge tone="marigold">Desk only</Badge>}
          </div>
          <div className="small muted truncate">{[s.title, formatPhone(s.phone)].filter(Boolean).join(' · ') || 'No title'}</div>
        </div>
        <div className="staff-meta">
          <span className="staff-days" aria-label={`Works ${daysLabel(days)}`}>
            {WEEK_DAYS.map((d) => <span key={d} className={days.includes(d) ? 'on' : undefined} aria-hidden>{d[0].toUpperCase()}</span>)}
          </span>
          <span className="small ink2 nowrap">{skills?.length ? `${svcCount} services` : 'All services'}</span>
          <span className="small ink2 nowrap num">{Number(s.commission_pct)}% commission</span>
          {member ? <Badge tone="peacock"><Icon name="user" size={13} />{ROLE_LABEL[member.role]}</Badge> : <span />}
        </div>
        <Icon name="chevronRight" size={18} className="muted hide-mobile" />
      </button>
    </li>
  );
}

function StaffSheet({ salonId, editing, onClose, team, services, categories, skills, branchHours, member }: {
  salonId: string; editing: Staff | 'new' | null; onClose: () => void; team: Staff[]; services: Service[]; categories: ServiceCategory[];
  skills: Record<string, string[]>; branchHours: Hours; member?: TeamMemberRow;
}) {
  const existing = editing && editing !== 'new' ? editing : null;
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [color, setColor] = useState<string>(STAFF_COLORS[0].hex);
  const [commission, setCommission] = useState('0');
  const [bookable, setBookable] = useState(true);
  const [ownHours, setOwnHours] = useState(false);
  const [hours, setHours] = useState<Hours>(branchHours);
  const [allServices, setAllServices] = useState(true);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<StylistProfileValue>({ photoUrl: null, bio: '', specialties: [], years: '', showOnBooking: true });
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, start] = useTransition();
  const [toggling, startToggle] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!editing) return;
    const s = editing === 'new' ? null : editing;
    setName(s?.name ?? '');
    setTitle(s?.title ?? '');
    setPhone(s?.phone ? formatPhone(s.phone) : '');
    setColor(s?.color?.toUpperCase() ?? nextStaffColor(team.filter((t) => t.active).map((t) => t.color)));
    setCommission(String(Number(s?.commission_pct ?? 0)));
    setBookable(s?.bookable ?? true);
    setOwnHours(!!s?.working_hours);
    setHours(s?.working_hours ?? branchHours);
    const own = s ? skills[s.id] ?? [] : [];
    setAllServices(!own.length);
    setServiceIds(own);
    setProfile({
      photoUrl: s?.photo_url ?? null, bio: s?.bio ?? '', specialties: s?.specialties ?? [],
      years: s?.years_experience == null ? '' : String(s.years_experience), showOnBooking: s?.show_on_booking ?? true,
    });
    setError(null);
  }, [editing, team, skills, branchHours]);

  const grouped = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    const g = categories.map((c) => ({ id: c.id, name: c.name, items: services.filter((s) => s.category_id === c.id) }));
    const loose = services.filter((s) => !s.category_id || !known.has(s.category_id));
    if (loose.length) g.push({ id: 'none', name: 'Other', items: loose });
    return g.filter((x) => x.items.length);
  }, [services, categories]);

  const toggleService = (id: string) => setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleGroup = (ids: string[], on: boolean) => setServiceIds((cur) => (on ? [...new Set([...cur, ...ids])] : cur.filter((x) => !ids.includes(x))));

  const submit = () => start(async () => {
    setError(null);
    if (!allServices && !serviceIds.length) return setError('Pick the services they do, or choose “All services”.');
    const r = await saveStaff({
      id: existing?.id, name, title, phone, color, commissionPct: Number(commission || 0), bookable, active: existing?.active ?? true,
      workingHours: ownHours ? hours : null, serviceIds: allServices ? [] : serviceIds,
      photoUrl: profile.photoUrl, bio: profile.bio, specialties: profile.specialties,
      yearsExperience: profile.years === '' ? null : Number(profile.years), showOnBooking: profile.showOnBooking,
    });
    if (!r.ok) return setError(r.error);
    if (existing?.photo_url && existing.photo_url !== profile.photoUrl) void removeStaffPhoto(existing.photo_url);
    toast(r.message ?? 'Saved');
    router.refresh();
    onClose();
  });

  const setActive = (active: boolean) => startToggle(async () => {
    if (!existing) return;
    const r = await deactivateStaff(existing.id, active);
    setConfirmOff(false);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved');
    router.refresh();
    onClose();
  });

  return (
    <>
      <Sheet open={!!editing} onClose={onClose} width={560}
        title={existing ? <div className="row" style={{ minWidth: 0 }}><Avatar name={existing.name} color={color} photo={profile.photoUrl} size="sm" /><h2 className="truncate">{existing.name}</h2></div> : 'Add team member'}
        footer={<>
          {existing && (existing.active
            ? <Button variant="danger" onClick={() => setConfirmOff(true)} style={{ marginRight: 'auto' }}><span className="hide-mobile">Remove from team</span><span className="show-mobile">Remove</span></Button>
            : <Button loading={toggling} onClick={() => setActive(true)} style={{ marginRight: 'auto' }}>Bring back</Button>)}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>{existing ? 'Save changes' : 'Add to team'}</Button>
        </>}>
        <div className="stack-lg">
          {existing && !existing.active && <Notice tone="warn">{existing.name} is no longer on the calendar. Their past appointments and sales are kept.</Notice>}
          <section className="stack">
            <div className="grid-2">
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!existing} maxLength={60} placeholder="e.g. Priya Nair" />
              <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Senior stylist" />
            </div>
            <div className="grid-2">
              <PhoneInput id="staff-phone" label="Mobile number" value={phone} onChange={(v) => setPhone(v)} />
              <div className="field">
                <label htmlFor="staff-comm">Commission</label>
                <div className="suffix-input">
                  <input id="staff-comm" className="input num" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
                  <span>%</span>
                </div>
                <span className="hint">Of service sales before GST</span>
              </div>
            </div>
            <div className="field">
              <span className="label">Calendar colour</span>
              <div className="swatches" role="radiogroup" aria-label="Calendar colour">
                {STAFF_COLORS.map((c) => (
                  <button key={c.hex} type="button" role="radio" aria-checked={color === c.hex} aria-label={c.name} title={c.name}
                    className="swatch" style={{ background: c.hex }} onClick={() => setColor(c.hex)}>
                    {color === c.hex && <Icon name="check" size={16} strokeWidth={2.6} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row" style={{ borderTop: 0, paddingTop: 4 }}>
              <div className="grow">
                <div className="strong">Takes appointments</div>
                <div className="small muted">Shows a column on the calendar and can be booked online and on WhatsApp.</div>
              </div>
              <Switch checked={bookable} onChange={setBookable} label={<span className="sr-only">Takes appointments</span>} />
            </div>
          </section>

          <section className="stack">
            <div>
              <h3>Booking page profile</h3>
              <p className="small muted">What clients see when they choose a stylist online.</p>
            </div>
            <StylistProfileFields value={profile} onChange={setProfile} name={name} color={color} salonId={salonId}
              staffId={existing?.id ?? null} bookable={bookable} />
          </section>

          <section className="stack">
            <div className="between">
              <h3>Working hours</h3>
              <Segmented label="Working hours" value={ownHours ? 'own' : 'salon'} onChange={(v) => { setOwnHours(v === 'own'); if (v === 'own' && !existing?.working_hours) setHours(branchHours); }}
                options={[{ value: 'salon', label: 'Salon hours' }, { value: 'own', label: 'Custom' }]} />
            </div>
            {ownHours
              ? <HoursEditor value={hours} onChange={setHours} idPrefix="staff-hours" closedLabel="Day off" />
              : <p className="small muted">Works whenever the salon is open ({daysLabel(openDays(branchHours))}). Choose Custom for days off or shorter shifts.</p>}
          </section>

          <section className="stack">
            <div className="between">
              <h3>Services they do</h3>
              <Segmented label="Services" value={allServices ? 'all' : 'some'} onChange={(v) => setAllServices(v === 'all')}
                options={[{ value: 'all', label: 'All services' }, { value: 'some', label: 'Choose' }]} />
            </div>
            {allServices ? (
              <p className="small muted">Can be booked for any service on your menu, including ones you add later.</p>
            ) : (
              <div className="stack">
                <p className="small muted">{serviceIds.length} of {services.length} selected. Clients will only be offered these with {name.split(' ')[0] || 'them'}.</p>
                {grouped.map((g) => {
                  const ids = g.items.map((s) => s.id);
                  const allOn = ids.every((id) => serviceIds.includes(id));
                  return (
                    <fieldset key={g.id} className="check-group">
                      <legend className="between" style={{ width: '100%' }}>
                        <span className="tiny muted strong">{g.name}</span>
                        <button type="button" className="link-btn tiny" onClick={() => toggleGroup(ids, !allOn)}>{allOn ? 'Clear' : 'Select all'}</button>
                      </legend>
                      <div className="check-grid">
                        {g.items.map((s) => (
                          <label key={s.id} className="check">
                            <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                            <span className="truncate">{s.name}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            )}
          </section>

          {existing && member && (
            <p className="small muted row"><Icon name="user" size={15} />Signs in to Styile as {ROLE_LABEL[member.role]}{member.email ? ` (${member.email})` : ''}.</p>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Sheet>
      <Dialog open={confirmOff} onClose={() => setConfirmOff(false)} title={`Remove ${existing?.name ?? ''} from the team?`}
        footer={<><Button variant="ghost" onClick={() => setConfirmOff(false)}>Keep</Button><Button variant="danger" loading={toggling} onClick={() => setActive(false)}>Remove</Button></>}>
        <p className="ink2">They’ll disappear from the calendar and online booking. Past appointments, bills and commission reports keep their name. You can bring them back any time.</p>
        {member && <p className="small muted">Their app login stays until you remove it under App access.</p>}
      </Dialog>
    </>
  );
}

function AccessPanel({ members, staff, canManageAccess, currentUserId }: TeamProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('stylist');
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inviting, startInvite] = useTransition();
  const [busy, startBusy] = useTransition();
  const [removing, setRemoving] = useState<TeamMemberRow | null>(null);
  const toast = useToast();
  const router = useRouter();
  const unlinked = staff.filter((s) => s.active && !s.user_id);
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.name;
  const sorted = [...members].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? ''));

  const invite = () => startInvite(async () => {
    setError(null);
    const r = await inviteMember({ email, role, staffId: staffId || null });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Invite sent');
    setEmail(''); setStaffId('');
    router.refresh();
  });

  const change = (m: TeamMemberRow, next: MemberRole) => startBusy(async () => {
    const r = await changeMemberRole(m.user_id, next);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Role changed');
    router.refresh();
  });

  return (
    <Panel title="App access" flush actions={!canManageAccess ? <Badge>Owner only</Badge> : undefined}>
      <div className="panel-body stack" style={{ paddingBottom: 6 }}>
        <p className="small muted">Who can sign in to Styile for this salon, and what they can see. Stylists don’t need a login to be booked.</p>
        <dl className="role-help">
          {ROLES.map((r) => <div key={r}><dt>{ROLE_LABEL[r]}</dt><dd>{ROLE_HELP[r]}</dd></div>)}
        </dl>
      </div>
      <ul className="list">
        {sorted.map((m) => {
          const label = m.name || m.email || 'Invited user';
          const isMe = m.user_id === currentUserId;
          return (
            <li key={m.user_id} className="member-row">
              <Avatar name={label} size="sm" color={staff.find((s) => s.id === m.staff_id)?.color ?? '#6B3FA0'} />
              <div className="grow">
                <div className="strong truncate">{label}{isMe && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</div>
                <div className="small muted truncate">{[m.name ? m.email : null, m.staff_id ? `Calendar: ${staffName(m.staff_id) ?? '—'}` : null].filter(Boolean).join(' · ') || ROLE_HELP[m.role]}</div>
              </div>
              {canManageAccess && !isMe ? (
                <div className="row">
                  <label className="sr-only" htmlFor={`role-${m.user_id}`}>Role for {label}</label>
                  <select id={`role-${m.user_id}`} className="select input-sm member-role" value={m.role} disabled={busy} onChange={(e) => change(m, e.target.value as MemberRole)}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove access for ${label}`} title="Remove access" onClick={() => setRemoving(m)} />
                </div>
              ) : <Badge tone={m.role === 'owner' ? 'plum' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>}
            </li>
          );
        })}
      </ul>
      {canManageAccess && (
        <div className="panel-foot invite">
          <h3>Invite someone</h3>
          <form className="invite-form" onSubmit={(e) => { e.preventDefault(); invite(); }}>
            <TextField label="Email" type="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </SelectField>
            <SelectField label="Their calendar column" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">None</option>
              {unlinked.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <Button type="submit" variant="primary" icon="send" loading={inviting} className="invite-submit">Send invite</Button>
          </form>
          <p className="hint">{ROLE_HELP[role]} They’ll get an email with a link to set up their login.</p>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Remove app access?"
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => startBusy(async () => {
            if (!removing) return;
            const r = await removeMember(removing.user_id);
            setRemoving(null);
            if (!r.ok) return toast(r.error, 'error');
            toast(r.message ?? 'Access removed');
            router.refresh();
          })}>Remove access</Button></>}>
        <p className="ink2">{removing?.name || removing?.email} won’t be able to sign in to this salon any more. Their calendar column and history stay.</p>
      </Dialog>
    </Panel>
  );
}
