// Sample bridal and event bookings for the preview (Glow Studio, late October 2026).
import type { AdvancePayment, SalonEvent } from '../src/lib/types';
import type { EventListRow, EventPerson } from '../src/components/app/events';
import { customers, salon } from './data';

const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60000).toISOString();
};
const cu = (id: string) => { const c = customers.find((x) => x.id === id)!; return { id: c.id, name: c.name, phone: c.phone }; };

const ev = (id: string, customer: string, type: SalonEvent['event_type'], title: string, date: string, ready: string, extra: Partial<SalonEvent> = {}): SalonEvent => ({
  id, salon_id: salon.id, customer_id: customer, event_type: type, title, event_at: ist(date, ready), location: 'salon', address: null, travel_charge: 0,
  quoted_price: null, people: 1, trial_appointment_id: null, notes: null, status: 'booked', cancelled_at: null, cancel_reason: null, created_at: ist('2026-10-12', '12:00'),
  ...extra,
});
const adv = (id: string, eventId: string, customer: string, no: string, amount: number, method: AdvancePayment['method'], at: string, extra: Partial<AdvancePayment> = {}): AdvancePayment => ({
  id, salon_id: salon.id, customer_id: customer, event_id: eventId, receipt_no: no, amount, method, reference: method === 'upi' ? 'UPI 8812 3301' : null, note: null,
  received_at: at, received_by: 'u-kavya', applied_amount: 0, refunded_at: null, refund_amount: null, refund_method: null, refund_reason: null, ...extra,
});

export const divyaWedding = ev('ev-1', 'cu-5', 'bridal', 'Divya’s wedding', '2026-11-14', '07:00', {
  location: 'home', address: '14, 3rd Cross, HAL 2nd Stage, Indiranagar (near the temple)', travel_charge: 800, quoted_price: 18500, people: 3,
  trial_appointment_id: 'ap-trial', notes: 'Red and gold Kanjeevaram. Hair: low bun with jasmine. Mother prefers light make-up.',
});
export const divyaAdvances: AdvancePayment[] = [
  adv('ad-1', 'ev-1', 'cu-5', 'AR-00031', 5000, 'upi', ist('2026-10-12', '12:05')),
  adv('ad-2', 'ev-1', 'cu-5', 'AR-00036', 3000, 'cash', ist('2026-10-24', '17:40')),
];
export const divyaPeople: EventPerson[] = [
  { id: 'ep-1', name: 'Bride', start_at: ist('2026-11-14', '03:30'), end_at: ist('2026-11-14', '06:30'), status: 'booked', staff: { name: 'Sana Sheikh', color: '#B43D6B' },
    services: [{ name: 'Bridal make-up', price: 9500 }, { name: 'Bridal hair styling', price: 3500 }] },
  { id: 'ep-2', name: 'Mother', start_at: ist('2026-11-14', '05:00'), end_at: ist('2026-11-14', '06:00'), status: 'booked', staff: { name: 'Meera Iyer', color: '#C2541B' },
    services: [{ name: 'Party make-up', price: 2500 }] },
  { id: 'ep-3', name: 'Sister', start_at: ist('2026-11-14', '06:00'), end_at: ist('2026-11-14', '06:45'), status: 'booked', staff: { name: 'Meera Iyer', color: '#C2541B' },
    services: [{ name: 'Party make-up', price: 2500 }] },
];
export const divyaTrial: EventPerson = { id: 'ap-trial', name: 'Trial', start_at: ist('2026-10-27', '15:00'), end_at: ist('2026-10-27', '18:00'), status: 'booked',
  staff: { name: 'Sana Sheikh', color: '#B43D6B' }, services: [{ name: 'Bridal trial', price: 3500 }] };

export const eventRows: EventListRow[] = [
  { ...divyaWedding, customer: cu('cu-5'), advances: divyaAdvances, bill: null },
  { ...ev('ev-2', 'cu-3', 'engagement', 'Fatima’s engagement', '2026-11-02', '17:00', { quoted_price: 6500, people: 2 }), customer: cu('cu-3'), advances: [adv('ad-3', 'ev-2', 'cu-3', 'AR-00034', 2000, 'upi', ist('2026-10-20', '11:00'))], bill: null },
  { ...ev('ev-3', 'cu-7', 'party', 'Lakshmi’s 25th anniversary', '2026-10-30', '18:30', { quoted_price: 4200, people: 4 }), customer: cu('cu-7'), advances: [], bill: null },
  { ...ev('ev-4', 'cu-1', 'group', 'Ananya’s office Diwali party', '2026-11-08', '16:00', { quoted_price: 12000, people: 8, location: 'home', address: 'WeWork Galaxy, Residency Road', travel_charge: 600 }),
    customer: cu('cu-1'), advances: [adv('ad-4', 'ev-4', 'cu-1', 'AR-00035', 6000, 'card', ist('2026-10-22', '10:30'))], bill: null },
  { ...ev('ev-5', 'cu-8', 'bridal', 'Imran’s sister’s nikah', '2026-12-05', '10:00', { quoted_price: 22000, people: 5 }), customer: cu('cu-8'), advances: [adv('ad-5', 'ev-5', 'cu-8', 'AR-00037', 10000, 'upi', ist('2026-10-26', '13:00'))], bill: null },
  { ...ev('ev-6', 'cu-2', 'party', 'Rohan’s cousin’s sangeet', '2026-10-18', '17:00', { quoted_price: 5000, people: 3, status: 'done' }), customer: cu('cu-2'),
    advances: [adv('ad-6', 'ev-6', 'cu-2', 'AR-00029', 2000, 'upi', ist('2026-10-05', '12:00'), { applied_amount: 2000 })], bill: { id: 'inv-1020', invoice_no: 'GS-01020', total: 5400, paid_total: 5400 } },
  { ...ev('ev-7', 'cu-6', 'engagement', 'Vikram’s engagement', '2026-10-21', '18:00', { quoted_price: 3000, status: 'cancelled', cancel_reason: 'Date moved to February' }), customer: cu('cu-6'),
    advances: [adv('ad-7', 'ev-7', 'cu-6', 'AR-00030', 1000, 'cash', ist('2026-10-08', '12:00'))], bill: null },
];

export const eventsReport = { advances_received: 41000, advances_applied: 12500, advances_refunded: 1000, advances_outstanding: 36500, events_in_range: 9, events_upcoming: 5 };
