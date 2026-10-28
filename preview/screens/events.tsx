import type { ReactNode } from 'react';
import { EventDetail, EventsScreen } from '../../src/components/app/events';
import { AdvanceReceiptView } from '../../src/components/portal/advance-receipt';
import { PosScreen } from '../../src/components/app/pos';
import { PortalHome } from '../../src/components/portal/portal';
import { CalendarBoard } from '../../src/components/app/calendar';
import { ReportsScreen } from '../../src/components/app/reports';
import { DayCloseScreen } from '../../src/components/app/dayclose';
import { appointments, branch, categories, customers, menu, NOW_ISO, salon, services, staff, TODAY, TZ } from '../data';
import { regularSalon } from '../gst-data';
import { divyaAdvances, divyaPeople, divyaTrial, divyaWedding, eventRows, eventsReport } from '../events-data';
import { Click } from './packages';
import { portalProps } from './public';
import { report as manageReport } from './manage';
import { daySummary, dayStaff, recentDays, todaysExpenses } from '../dayclose-data';
import type { AppointmentFull } from '../../src/lib/types';

const divya = customers.find((c) => c.id === 'cu-5')!;
const POLICY = 'Bridal advances are refundable up to 7 days before the event. After that, they can be moved to a new date once.';
const receiptSalon = { name: salon.name, gstMode: 'regular' as const, gstin: salon.gstin, address: `${salon.address}, ${salon.city}`, phone: salon.phone, policy: POLICY };
const detail = (over: Partial<Parameters<typeof EventDetail>[0]> = {}) => (
  <EventDetail event={divyaWedding} customer={{ id: divya.id, name: divya.name, phone: divya.phone }} people={divyaPeople} trial={divyaTrial}
    advances={divyaAdvances} bill={null} salon={{ ...receiptSalon, methods: regularSalon.payment_methods, waConnected: true }}
    today={TODAY} tz={TZ} canEdit canRefund canBill {...over} />
);
const newEvent = { menu, today: TODAY, methods: regularSalon.payment_methods, waConnected: true };
const list = () => <EventsScreen events={eventRows} today={TODAY} tz={TZ} canCreate newEvent={newEvent} />;

const svc = (name: string) => services.find((s) => s.name === name);
const posSalon = { gstMode: 'regular' as const, pricesIncludeTax: true, serviceRate: 5, waConnected: true, nextInvoiceNo: 'GS-01043',
  payMethods: regularSalon.payment_methods, upi: { vpa: 'glowstudio@okicici', name: 'Glow Studio' }, receiptSize: '80' as const, today: TODAY, timezone: TZ };

const eventAppts: AppointmentFull[] = [
  ...appointments.map((a, i) => (i === 8 ? { ...a, guest_name: 'Trial', notes: 'Trial for Divya’s wedding' } : a)),
  { ...appointments[4], id: 'ap-ev-1', staff_id: 'st-sana', status: 'booked', source: 'staff',
    start_at: '2026-10-27T10:30:00.000Z', end_at: '2026-10-27T11:45:00.000Z', event_id: 'ev-1', guest_name: 'Bride',
    services: [{ service_id: null, name: 'Mehendi (bridal)', price: 4000, duration_min: 75 }] },
  { ...appointments[4], id: 'ap-ev-2', staff_id: 'st-priya', status: 'booked', source: 'staff',
    start_at: '2026-10-27T11:00:00.000Z', end_at: '2026-10-27T11:45:00.000Z', event_id: 'ev-1', guest_name: 'Sister',
    services: [{ service_id: null, name: 'Mehendi (hands)', price: 1500, duration_min: 45 }] },
];

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/app/events': { title: 'Bridal & events', render: list },
  '/app/events/new': { title: 'New event (sheet)', render: () => <Click steps={['.topbar .btn-primary']}>{list()}</Click> },
  '/app/events/[id]': { title: 'Event — Divya’s wedding (trial, 3 people, home visit, advances)', render: () => detail() },
  '/app/events/advance': { title: 'Event — take an advance', render: () => <Click steps={['.btn::Take advance']}>{detail()}</Click> },
  '/app/events/receipt': { title: 'Event — advance receipt', render: () => <Click steps={['.adv-actions .link-btn::Receipt']}>{detail()}</Click> },
  '/app/events/refund': { title: 'Event — refund an advance (owner)', render: () => <Click steps={['.adv-actions .link-btn::Refund']}>{detail()}</Click> },
  '/app/events/cancelled': {
    title: 'Event — cancelled, advance kept',
    render: () => detail({ event: { ...divyaWedding, status: 'cancelled', cancel_reason: 'Wedding postponed to February' }, people: divyaPeople.map((p) => ({ ...p, status: 'cancelled' })) }),
  },
  '/app/pos/event': {
    title: 'New bill — event checkout with advances',
    render: () => (
      <PosScreen salon={posSalon} services={services} categories={categories} staff={staff}
        prefill={{
          appointmentId: null, eventId: 'ev-1',
          customer: { id: divya.id, name: divya.name, phone: divya.phone, visit_count: divya.visit_count, last_visit_at: divya.last_visit_at },
          context: 'Checkout · Divya’s wedding · 3 people',
          lines: [
            { serviceId: svc('Hydra facial')?.id ?? null, name: 'Bridal make-up · Bride', price: 9500, staffId: 'st-sana', gstRate: null },
            { serviceId: null, name: 'Bridal hair styling · Bride', price: 3500, staffId: 'st-sana', gstRate: null },
            { serviceId: null, name: 'Party make-up · Mother', price: 2500, staffId: 'st-meera', gstRate: null },
            { serviceId: null, name: 'Party make-up · Sister', price: 2500, staffId: 'st-meera', gstRate: null },
            { serviceId: null, name: 'Home visit travel', price: 800, staffId: null, gstRate: null },
          ],
          benefits: { packages: [], membership: null, advance: { left: 8000, receipts: ['AR-00031', 'AR-00036'] } },
        }} />
    ),
  },
  '/app/calendar/events': {
    title: 'Calendar — an event booking and a trial',
    render: () => <CalendarBoard salonId={salon.id} date={TODAY} today={TODAY} nowIso={NOW_ISO} branchHours={branch.business_hours} appointments={eventAppts} menu={menu} canBill
      newEvent={{ methods: regularSalon.payment_methods, waConnected: true }} />,
  },
  '/me/events': {
    title: 'Client portal — event and advance receipts',
    render: () => <PortalHome {...portalProps} me={{ name: divya.name, phone: divya.phone }} today={TODAY} events={[{ event: divyaWedding, advances: divyaAdvances }]} />,
  },
  '/me/receipts/[id]': {
    title: 'Client — advance receipt',
    render: () => <AdvanceReceiptView advance={divyaAdvances[0]} salon={{ ...receiptSalon, timezone: TZ }} customer={{ name: divya.name, phone: divya.phone }} event={divyaWedding} phone={divya.phone} base="" />,
  },
  '/app/reports/events': {
    title: 'Reports — bridal & events',
    render: () => <ReportsScreen report={{ ...manageReport, ...eventsReport, by_method: { ...manageReport.by_method, advance: 12500 } }} range={{ key: 'month', from: '2026-10-01', to: TODAY }} today={TODAY} salonName={salon.name} gstMode="regular" previous={null} />,
  },
  '/app/close/advances': {
    title: 'Day close — advances taken and used',
    render: () => {
      const t = daySummary.totals;
      const s = { ...daySummary,
        totals: { ...t, received: t.received + 13000, collected: t.collected + 13000, cash_in: t.cash_in + 3000, expected_cash: t.expected_cash + 3000,
          advances_received: 13000, advances_received_count: 3, advance_refunds: 0, advance_used: 2000 },
        by_method: { ...daySummary.by_method,
          cash: { ...daySummary.by_method.cash, advances: 3000, net: daySummary.by_method.cash.net + 3000 },
          upi: { ...daySummary.by_method.upi, advances: 10000, net: daySummary.by_method.upi.net + 10000 },
          advance: { bills: 2000, coins: 0, packages: 0, advances: 0, refunds: 0, net: 2000 } } };
      return <DayCloseScreen salonName={salon.name} date={TODAY} today={TODAY} tz={TZ} summary={s} close={null} liveExpected={null}
        expenses={todaysExpenses} staff={dayStaff} recent={recentDays} canReopen canAddExpense canManageExpenses />;
    },
  },
};
