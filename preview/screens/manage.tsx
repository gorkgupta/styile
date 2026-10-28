import { useEffect, type ReactNode } from 'react';
import { ServicesScreen } from '../../src/components/app/services';
import { InboxScreen } from '../../src/components/app/inbox';
import { ReportsScreen } from '../../src/components/app/reports';
import { SettingsScreen } from '../../src/components/app/settings';
import { TeamScreen } from '../../src/components/app/team';
import { branch, categories, conversations, messages, NOW_ISO, report as baseReport, services, TODAY, TZ } from '../data';
import { portraitOf, previewSkills, profiledStaff as staff } from '../stylist-data';
import { coinReport, salonWithCoins } from '../coins-data';

const salon = { ...salonWithCoins, gst_mode: 'regular' as const };
const report = { ...baseReport, ...coinReport, by_method: { ...baseReport.by_method, wallet: 48760 } };

// A couple of extra rows so the screens show archived / online-off / uncategorised states.
const menuServices = [
  ...services.map((s) => (s.id === 's-balayage' ? { ...s, online_bookable: false, description: 'Consultation first. Includes toner and blow-dry.' } : s)),
  { ...services[0], id: 's-old', name: 'Hair spa (old menu)', price: 1200, duration_min: 45, active: false, category_id: 'c-hair' },
  { ...services[0], id: 's-bridal', name: 'Bridal trial', price: 3500, duration_min: 120, category_id: null, online_bookable: false, gst_rate: 5 },
];

const teamStaff = [
  ...staff,
  { ...staff[0], id: 'st-kiran', name: 'Kiran Rao', title: 'Trainee stylist', color: '#2F6DB5', show_on_booking: false, user_id: null, phone: null, years_experience: 1, specialties: [], bio: null,
    photo_url: portraitOf({ bg1: '#DCE8F7', bg2: '#B7CDEB', skin: '#A86F4F', neck: '#935E42', hair: '#1E1612', top: '#2F6DB5' }) },
  { ...staff[1], id: 'st-ravi', name: 'Ravi Kumar', title: 'Junior stylist', color: '#2F6DB5', active: false, user_id: null, phone: null },
  { ...staff[0], id: 'st-desk', name: 'Asha Rao', title: 'Owner', color: '#9A6B00', bookable: false, photo_url: null, bio: null, specialties: [], user_id: 'u-asha', commission_pct: 0, phone: null },
];
const members = [
  { user_id: 'u-asha', role: 'owner' as const, staff_id: 'st-desk', name: 'Asha Rao', email: 'asha@glowstudio.in' },
  { user_id: 'u-kavya', role: 'receptionist' as const, staff_id: null, name: 'Kavya S', email: 'frontdesk@glowstudio.in' },
  { user_id: 'u-meera', role: 'manager' as const, staff_id: 'st-meera', name: 'Meera Iyer', email: 'meera.iyer@gmail.com' },
  { user_id: 'u-priya', role: 'stylist' as const, staff_id: 'st-priya', name: 'Priya Nair', email: 'priya.n@gmail.com' },
];

const inboxConvs = conversations.map((c) => ({ ...c, last_author: c.id === 'cv-2' ? ('customer' as const) : ('bot' as const) }));
const inboxMessages = [
  ...messages,
  { id: 'm8', conversation_id: 'cv-2', direction: 'out' as const, author: 'system' as const, kind: 'note', body: 'Assistant handed this chat to the team: payment question', payload: null, status: null, created_at: '2026-10-27T05:28:30.000Z' },
].sort((a, b) => a.created_at.localeCompare(b.created_at));
const inbox = (selectedId: string | null) => (
  <InboxScreen salonId={salon.id} tz={TZ} nowIso={NOW_ISO} waConnected botEnabled conversations={inboxConvs} selectedId={selectedId}
    messages={inboxMessages.filter((m) => m.conversation_id === selectedId)} />
);

const team = () => (
  <TeamScreen salonId={salon.id} staff={teamStaff} services={services} categories={categories} branchHours={branch.business_hours} members={members}
    skills={previewSkills} canManageAccess currentUserId="u-asha" />
);

/** Preview only: opens one team member's sheet so it can be screenshotted. */
function OpenRow({ index, children }: { index: number; children: ReactNode }) {
  useEffect(() => { document.querySelectorAll<HTMLButtonElement>('.staff-row')[index]?.click(); }, [index]);
  return <>{children}</>;
}

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/app/services': {
    title: 'Services',
    render: () => <ServicesScreen services={menuServices} categories={categories} serviceRate={5} gstMode="regular" pricesIncludeTax={salon.prices_include_tax} />,
  },
  '/app/staff': { title: 'Team', render: () => team() },
  '/app/staff/edit': { title: 'Team — edit a stylist’s booking page profile', render: () => <OpenRow index={2}>{team()}</OpenRow> },
  '/app/settings': {
    title: 'Settings',
    render: () => <SettingsScreen salon={salon} hours={branch.business_hours} supportEmail="support@styile.com" />,
  },
  '/app/settings/not-connected': {
    title: 'Settings (WhatsApp not connected, trial)',
    render: () => (
      <SettingsScreen salon={{ ...salon, wa_phone_number_id: null, wa_display_number: null, plan: 'trial', plan_status: 'trialing', trial_ends_at: '2026-11-07T18:29:00Z', gstin: null, gst_mode: 'unregistered' }}
        hours={branch.business_hours} supportEmail="support@styile.com" />
    ),
  },
  '/app/reports': {
    title: 'Reports',
    render: () => (
      <ReportsScreen report={report} range={{ key: 'month', from: '2026-10-01', to: TODAY }} today={TODAY} salonName={salon.name} gstMode="regular"
        previous={{ ...report, revenue: 341200, bills: 389, avg_bill: 877, new_clients: 71 }} />
    ),
  },
  '/app/reports/week': {
    title: 'Reports (last 7 days)',
    render: () => (
      <ReportsScreen range={{ key: '7d', from: '2026-10-21', to: TODAY }} today={TODAY} salonName={salon.name} gstMode="regular" previous={null}
        report={{ ...report, revenue: 98400, collected: 98400, bills: 104, by_day: report.by_day.slice(20) }} />
    ),
  },
  '/app/inbox': { title: 'WhatsApp inbox', render: () => inbox(new URLSearchParams(location.hash.split('?')[1] ?? '').get('c') ?? 'cv-2') },
  '/app/inbox/list': { title: 'WhatsApp inbox (no chat open)', render: () => inbox(null) },
};
