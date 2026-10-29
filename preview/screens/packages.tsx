import { useEffect, type ReactNode } from 'react';
import { PackagesScreen } from '../../src/components/app/packages';
import { CustomerProfile, type ProfileAppointment } from '../../src/components/app/customer-profile';
import { PosScreen } from '../../src/components/app/pos';
import { PortalHome } from '../../src/components/portal/portal';
import { ReportsScreen } from '../../src/components/app/reports';
import { DayCloseScreen } from '../../src/components/app/dayclose';
import { InvoiceDetail } from '../../src/components/app/invoice-detail';
import { appointments, categories, customers, NOW_ISO, salon, services, staff, TODAY, TZ } from '../data';
import { ananyaCoins, coinPacks } from '../coins-data';
import { regularSalon, sampleBill } from '../gst-data';
import { ananyaCards, ananyaPackages, menuPackages, packageHolders, packageMenu, packagesReport, planMembers, plans } from '../packages-data';
import { portalProps } from './public';
import { report as manageReport } from './manage';
import { daySummary, dayStaff, recentDays, todaysExpenses } from '../dayclose-data';
import { packageState } from '../../src/lib/packages';

/** Clicks the given selectors in order once rendered (to open a sheet or press a chip). */
export function Click({ steps, children }: { steps: string[]; children: ReactNode }) {
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const sel of steps) {
        await new Promise((r) => setTimeout(r, 450));
        if (!alive) return;
        const [css, text] = sel.split('::');
        const el = [...document.querySelectorAll<HTMLElement>(css)].find((e) => !text || e.textContent?.includes(text));
        el?.click();
      }
    })();
    return () => { alive = false; };
  }, [steps]);
  return <>{children}</>;
}

const ananya = { ...customers[0], coin_balance: ananyaCoins };
const profileAppts: ProfileAppointment[] = [
  { id: 'pa1', start_at: appointments[3].start_at, status: 'checked_in', source: 'whatsapp', staff_id: 'st-priya', invoice_id: null, services: [{ name: 'Haircut & style', price: 900 }] },
  { id: 'pa3', start_at: '2026-10-02T09:00:00.000Z', status: 'completed', source: 'whatsapp', staff_id: 'st-meera', invoice_id: 'inv-1041', services: [{ name: 'Hydra facial', price: 2800 }] },
];
const benefits = (role: 'owner' | 'receptionist', over: Partial<{ packages: typeof ananyaPackages; memberships: typeof ananyaCards }> = {}) => ({
  salon: { name: salon.name, methods: regularSalon.payment_methods, waConnected: true, gstMode: 'regular' as const },
  today: TODAY, packages: ananyaPackages, memberships: ananyaCards, menu: packageMenu, plans,
  canSell: true, canCancel: role === 'owner', canManage: role === 'owner', ...over,
});
const coins = { salon: { name: salon.name, enabled: true, packs: coinPacks, waConnected: true }, history: [], canSell: true, canBonus: true, canAdjust: true };
const profile = (role: 'owner' | 'receptionist', over: Parameters<typeof benefits>[1] = {}, c = ananya) => (
  <CustomerProfile customer={c} appointments={profileAppts} invoices={[]} coins={coins} benefits={benefits(role, over)}
    staff={staff.map((s) => ({ id: s.id, name: s.name, color: s.color }))} today={TODAY} nowIso={NOW_ISO} tz={TZ} canDelete={role === 'owner'} canBill />
);

const posSalon = { gstMode: 'regular' as const, pricesIncludeTax: true, serviceRate: 5, waConnected: true, nextInvoiceNo: 'GS-01043',
  payMethods: regularSalon.payment_methods, upi: { vpa: 'glowstudio@okicici', name: 'Glow Studio' }, receiptSize: '80' as const, today: TODAY, timezone: TZ };
const ananyaAppt = appointments.find((x) => x.customer_id === 'cu-1')!;
const pos = () => (
  <PosScreen salon={posSalon} services={services} categories={categories} staff={staff}
    prefill={{
      appointmentId: ananyaAppt.id,
      customer: { id: ananya.id, name: ananya.name, phone: ananya.phone, visit_count: ananya.visit_count, last_visit_at: ananya.last_visit_at, coin_balance: ananyaCoins },
      context: `Checkout · ${ananya.name} · 11:30 AM with Priya Nair`,
      lines: [
        { serviceId: 's-cut-w', name: 'Haircut & style', price: 900, staffId: 'st-priya', gstRate: null },
        { serviceId: 's-facial', name: 'Hydra facial', price: 2800, staffId: 'st-sana', gstRate: null },
      ],
      benefits: { packages: ananyaPackages.filter((p) => packageState(p, TODAY) === 'active'), membership: ananyaCards[0] },
    }} />
);

// The bill after checkout: haircut at member price, facial from the package.
const memberBill = sampleBill(regularSalon, 'GS-01043', '2026-10-27T06:40:00.000Z', 'cu-1', [
  { id: 'l1', kind: 'service', name: 'Haircut & style', qty: 1, unitPrice: 900, memberPct: 10, code: '999721', staff_id: 'st-priya', service_id: 's-cut-w' },
  { id: 'l2', kind: 'service', name: 'Hydra facial', qty: 1, unitPrice: 2333, fromPackage: true, code: '999722', staff_id: 'st-sana', service_id: 's-facial' },
], [{ method: 'package', amount: 2333, reference: 'PK-00041 · 6 Hydra facials' }, { method: 'upi', amount: 810, reference: 'UPI 7731 0042' }]);
memberBill.items = memberBill.items.map((i) => (i.name === 'Hydra facial' ? { ...i, discount_note: 'Package' } : { ...i, member_discount: 90, discount_note: 'Member 10%' }));

const packageSummary = {
  ...daySummary,
  totals: { ...daySummary.totals, received: daySummary.totals.received + 20500, collected: daySummary.totals.collected + 20500, cash_in: daySummary.totals.cash_in + 6500,
    expected_cash: daySummary.totals.expected_cash + 6500, packages_sold: 20500, packages_sold_count: 2, package_refunds: 0, package_used: 7166 },
  by_method: {
    ...daySummary.by_method,
    cash: { ...daySummary.by_method.cash, packages: 6500, net: daySummary.by_method.cash.net + 6500 },
    upi: { ...daySummary.by_method.upi, packages: 14000, net: daySummary.by_method.upi.net + 14000 },
    package: { bills: 7166, coins: 0, packages: 0, refunds: 0, net: 7166 },
  },
};

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/app/packages': {
    title: 'Packages & memberships',
    render: () => <PackagesScreen packages={menuPackages} plans={plans} services={services} categories={categories} holders={packageHolders} members={planMembers} gstMode="regular" />,
  },
  '/app/packages/empty': {
    title: 'Packages & memberships (none yet)',
    render: () => <PackagesScreen packages={[]} plans={[]} services={services} categories={categories} holders={{}} members={{}} gstMode="unregistered" />,
  },
  '/app/packages/edit': {
    title: 'Packages — edit a mixed package',
    render: () => <Click steps={['.pm-main::Bridal glow pack']}><PackagesScreen packages={menuPackages} plans={plans} services={services} categories={categories} holders={packageHolders} members={planMembers} gstMode="regular" /></Click>,
  },
  '/app/packages/card': {
    title: 'Packages — edit a membership card',
    render: () => <Click steps={['.pm-main::Glow Card']}><PackagesScreen packages={menuPackages} plans={plans} services={services} categories={categories} holders={packageHolders} members={planMembers} gstMode="regular" /></Click>,
  },
  '/app/customers/packages': { title: 'Client profile — packages and membership (owner)', render: () => profile('owner') },
  '/app/customers/packages-new': {
    title: 'Client profile — no package or card yet (front desk)',
    render: () => profile('receptionist', { packages: [], memberships: [] }, { ...customers[1], coin_balance: 0 }),
  },
  '/app/customers/packages-sell': {
    title: 'Sell a package (sheet)',
    render: () => <Click steps={['.cpk-panel .btn::Sell package']}>{profile('receptionist')}</Click>,
  },
  '/app/customers/packages-receipt': {
    title: 'Package receipt after selling',
    render: () => <Click steps={['.cpk-panel .btn::Sell package', '.sheet-foot .btn-primary']}>{profile('receptionist')}</Click>,
  },
  '/app/customers/membership-sell': {
    title: 'Renew a membership card (sheet)',
    render: () => <Click steps={['.mem-panel .btn::Renew']}>{profile('receptionist')}</Click>,
  },
  '/app/customers/package-cancel': {
    title: 'Cancel a package (owner)',
    render: () => <Click steps={['.cpk .link-btn::Cancel package']}>{profile('owner')}</Click>,
  },
  '/app/pos/packages': { title: 'New bill — member with a package', render: pos },
  '/app/pos/packages-used': { title: 'New bill — facial taken from the package', render: () => <Click steps={['.pkg-chip']}>{pos()}</Click> },
  '/app/invoices/member': {
    title: 'Bill — member price and a package session',
    render: () => (
      <InvoiceDetail invoice={memberBill.invoice} items={memberBill.items} payments={memberBill.payments}
        customer={{ id: ananya.id, name: ananya.name, phone: ananya.phone, email: null }}
        salon={{ name: regularSalon.name, legal_name: regularSalon.legal_name, gstin: regularSalon.gstin, phone: regularSalon.phone, email: regularSalon.email,
          address: regularSalon.address, city: regularSalon.city, state: regularSalon.state, pincode: regularSalon.pincode, waConnected: true,
          upiVpa: regularSalon.upi_vpa, upiName: regularSalon.upi_payee_name, receiptSize: 'a4', payMethods: regularSalon.payment_methods }}
        staffNames={Object.fromEntries(staff.map((s) => [s.id, s.name]))} tz={TZ} canVoid />
    ),
  },
  '/me/packages': {
    title: 'Client portal — packages and membership',
    render: () => <PortalHome {...portalProps} packages={ananyaPackages.filter((p) => packageState(p, TODAY) === 'active')} membership={ananyaCards[0]} today={TODAY} />,
  },
  '/app/reports/packages': {
    title: 'Reports — packages and memberships',
    render: () => <ReportsScreen report={{ ...manageReport, ...packagesReport, by_method: { ...manageReport.by_method, package: 61250 } }} range={{ key: 'month', from: '2026-10-01', to: TODAY }} today={TODAY} salonName={salon.name} gstMode="regular" previous={null} />,
  },
  '/app/close/packages': {
    title: 'Day close — packages sold and used',
    render: () => <DayCloseScreen salonName={salon.name} date={TODAY} today={TODAY} tz={TZ} summary={packageSummary} close={null} liveExpected={null}
      expenses={todaysExpenses} staff={dayStaff} recent={recentDays} canReopen canAddExpense canManageExpenses />,
  },
};
