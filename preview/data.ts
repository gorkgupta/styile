// Realistic sample data for the preview (a mid-size Bengaluru salon on a Tuesday morning).
import type { AppointmentFull, Customer, Hours, Invoice, InvoiceItem, Payment, Salon, Service, ServiceCategory, Staff, WaConversation, WaMessage, SalonReport, Branch } from '../src/lib/types';

export const TZ = 'Asia/Kolkata';
export const TODAY = '2026-10-27';
export const NOW_ISO = '2026-10-27T05:50:00.000Z'; // 11:20 IST
const at = (hhmm: string, date = TODAY) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60000).toISOString();
};

export const hours: Hours = {
  mon: [['10:00', '20:00']], tue: [['10:00', '20:00']], wed: [['10:00', '20:00']], thu: [['10:00', '20:00']],
  fri: [['10:00', '20:00']], sat: [['09:00', '21:00']], sun: [['09:00', '21:00']],
};

export const salon: Salon = {
  id: 'salon-1', name: 'Glow Studio', slug: 'glow-studio', legal_name: 'Glow Studio LLP', gstin: '29ABCDE1234F1Z5',
  phone: '919845012345', email: 'hello@glowstudio.in', address: '12, 100 Feet Road, Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038',
  timezone: TZ, currency: 'INR', brand_color: '#0F5257', logo_url: null, prices_include_tax: true, default_gst_rate: 18,
  invoice_prefix: 'GS', next_invoice_no: 1043, booking_enabled: true, slot_interval_min: 15, booking_lead_min: 60, booking_window_days: 30,
  plan: 'growth', plan_status: 'active', trial_ends_at: null, wa_phone_number_id: '1098765432', wa_business_account_id: '2233', wa_display_number: '+91 98450 12345',
  wa_bot_enabled: true, wa_bot_instructions: 'Free parking behind the building. Bridal trials need a ₹1,000 advance.', created_at: '2026-01-10T05:00:00Z',
};

export const branch: Branch = { id: 'br-1', salon_id: salon.id, name: 'Indiranagar', address: salon.address, phone: salon.phone, is_default: true, business_hours: hours };

export const staff: Staff[] = ([
  { id: 'st-priya', salon_id: salon.id, branch_id: 'br-1', user_id: 'u-priya', name: 'Priya Nair', phone: '919900011111', title: 'Senior stylist', color: '#7A3FB8', commission_pct: 12, working_hours: null, bookable: true, active: true, sort: 1 },
  { id: 'st-arjun', salon_id: salon.id, branch_id: 'br-1', user_id: null, name: 'Arjun Das', phone: '919900022222', title: 'Barber', color: '#0F6E73', commission_pct: 10, working_hours: { tue: [['12:00', '20:00']] }, bookable: true, active: true, sort: 2 },
  { id: 'st-meera', salon_id: salon.id, branch_id: 'br-1', user_id: 'u-meera', name: 'Meera Iyer', phone: '919900033333', title: 'Colour specialist', color: '#C2541B', commission_pct: 15, working_hours: null, bookable: true, active: true, sort: 3 },
  { id: 'st-sana', salon_id: salon.id, branch_id: 'br-1', user_id: null, name: 'Sana Sheikh', phone: '919900044444', title: 'Skin & nails', color: '#B43D6B', commission_pct: 10, working_hours: null, bookable: true, active: true, sort: 4 },
] as Omit<Staff, 'photo_url' | 'bio' | 'specialties' | 'years_experience' | 'show_on_booking'>[]).map((s) => ({ photo_url: null, bio: null, specialties: [], years_experience: null, show_on_booking: true, ...s }));

export const categories: ServiceCategory[] = [
  { id: 'c-hair', salon_id: salon.id, name: 'Hair', sort: 1 },
  { id: 'c-colour', salon_id: salon.id, name: 'Colour', sort: 2 },
  { id: 'c-skin', salon_id: salon.id, name: 'Skin', sort: 3 },
  { id: 'c-nails', salon_id: salon.id, name: 'Hands & feet', sort: 4 },
];

const svc = (id: string, cat: string, name: string, dur: number, price: number, gender: Service['gender'] = 'unisex'): Service =>
  ({ id, salon_id: salon.id, category_id: cat, name, description: null, duration_min: dur, price, gst_rate: null, gender, online_bookable: true, active: true, sort: 0 });

export const services: Service[] = [
  svc('s-cut-w', 'c-hair', 'Haircut & style', 60, 900, 'female'),
  svc('s-cut-m', 'c-hair', 'Men’s haircut', 30, 450, 'male'),
  svc('s-beard', 'c-hair', 'Beard trim', 20, 250, 'male'),
  svc('s-blow', 'c-hair', 'Wash & blow-dry', 30, 500),
  svc('s-keratin', 'c-hair', 'Keratin treatment', 180, 6500),
  svc('s-global', 'c-colour', 'Global colour', 120, 3800),
  svc('s-root', 'c-colour', 'Root touch-up', 60, 1600),
  svc('s-balayage', 'c-colour', 'Balayage', 180, 7500),
  svc('s-cleanup', 'c-skin', 'Clean-up', 45, 900),
  svc('s-facial', 'c-skin', 'Hydra facial', 75, 2800),
  svc('s-mani', 'c-nails', 'Manicure', 40, 700),
  svc('s-pedi', 'c-nails', 'Pedicure', 50, 900),
];

const cust = (id: string, name: string, phone: string, visits: number, spent: number, last: string | null, extra: Partial<Customer> = {}): Customer => ({
  id, salon_id: salon.id, name, phone, email: null, gender: null, birthday: null, notes: null, tags: [], user_id: null,
  marketing_opt_in: true, visit_count: visits, total_spent: spent, last_visit_at: last, created_at: '2026-03-01T05:00:00Z', ...extra,
});

export const customers: Customer[] = [
  cust('cu-1', 'Ananya Krishnan', '919845098450', 14, 38200, '2026-10-02T09:00:00Z', { gender: 'female', notes: 'Prefers Meera. Sensitive scalp — ammonia-free colour only.', tags: ['VIP'], birthday: '1992-11-04', email: 'ananya.k@gmail.com' }),
  cust('cu-2', 'Rohan Mehta', '919811112222', 6, 4100, '2026-10-12T12:00:00Z', { gender: 'male' }),
  cust('cu-3', 'Fatima Begum', '919900887766', 3, 7400, '2026-09-28T08:00:00Z', { gender: 'female' }),
  cust('cu-4', 'Karthik Rao', '919741234567', 1, 450, '2026-10-20T11:00:00Z', { gender: 'male' }),
  cust('cu-5', 'Divya Shetty', '919886543210', 9, 21600, '2026-10-15T10:00:00Z', { gender: 'female', tags: ['Bridal 2026'] }),
  cust('cu-6', 'Vikram Singh', '919620011223', 0, 0, null, { gender: 'male' }),
  cust('cu-7', 'Lakshmi Menon', '919448812345', 22, 61800, '2026-10-19T06:00:00Z', { gender: 'female', tags: ['VIP'] }),
  cust('cu-8', 'Imran Qureshi', '919535566778', 4, 2300, '2026-08-30T12:00:00Z', { gender: 'male' }),
];

const c = (id: string) => customers.find((x) => x.id === id)!;
const lite = (id: string) => { const x = c(id); return { id: x.id, name: x.name, phone: x.phone, visit_count: x.visit_count, notes: x.notes }; };
const lines = (...ids: string[]) => ids.map((id) => { const s = services.find((x) => x.id === id)!; return { service_id: s.id, name: s.name, price: s.price, duration_min: s.duration_min }; });

let n = 0;
const appt = (cid: string, staffId: string | null, start: string, end: string, status: AppointmentFull['status'], source: AppointmentFull['source'], svcIds: string[], extra: Partial<AppointmentFull> = {}): AppointmentFull => ({
  id: `ap-${++n}`, salon_id: salon.id, branch_id: 'br-1', customer_id: cid, staff_id: staffId, start_at: at(start), end_at: at(end),
  status, source, token_no: null, notes: null, cancelled_reason: null, invoice_id: null, created_at: at('08:00'),
  customer: lite(cid), services: lines(...svcIds), ...extra,
});

export const appointments: AppointmentFull[] = [
  appt('cu-7', 'st-meera', '10:00', '12:00', 'in_service', 'whatsapp', ['s-global'], { notes: 'Shade 5.3 + 20 vol, same as August' }),
  appt('cu-2', 'st-priya', '10:15', '10:45', 'completed', 'staff', ['s-cut-m'], { invoice_id: 'inv-1042' }),
  appt('cu-3', 'st-sana', '10:30', '11:45', 'in_service', 'online', ['s-facial']),
  appt('cu-1', 'st-priya', '11:30', '12:30', 'checked_in', 'whatsapp', ['s-cut-w']),
  appt('cu-5', 'st-sana', '12:00', '13:30', 'confirmed', 'phone', ['s-mani', 's-pedi']),
  appt('cu-8', 'st-arjun', '12:30', '13:20', 'booked', 'whatsapp', ['s-cut-m', 's-beard']),
  appt('cu-4', 'st-arjun', '14:00', '14:30', 'booked', 'online', ['s-cut-m']),
  appt('cu-6', 'st-priya', '14:30', '15:30', 'booked', 'whatsapp', ['s-blow']),
  appt('cu-5', 'st-meera', '15:00', '18:00', 'booked', 'staff', ['s-balayage'], { notes: 'Bridal trial — confirm advance received' }),
  appt('cu-3', 'st-priya', '17:00', '18:00', 'cancelled', 'whatsapp', ['s-cut-w'], { cancelled_reason: 'Customer cancelled on WhatsApp' }),
  appt('cu-2', 'st-arjun', '18:15', '18:45', 'booked', 'staff', ['s-cut-m']),
  appt('cu-4', 'st-meera', '12:15', '12:45', 'booked', 'staff', ['s-blow']),
  // walk-ins
  appt('cu-6', null, '11:02', '11:32', 'waiting', 'walk_in', ['s-cut-m'], { token_no: 7 }),
  appt('cu-8', 'st-arjun', '11:10', '11:30', 'waiting', 'walk_in', ['s-beard'], { token_no: 8 }),
];

export const menu = { services, categories, staff, tz: TZ, intervalMin: 15 };

export const invoices: Invoice[] = Array.from({ length: 12 }, (_, i) => {
  const total = [450, 3800, 2800, 900, 1600, 7500, 1150, 700, 6500, 2350, 500, 1600][i];
  const taxable = Math.round((total * 100) / 118 * 100) / 100;
  const tax = Math.round((total - taxable) * 100) / 100;
  return {
    id: `inv-${1042 - i}`, salon_id: salon.id, invoice_no: `GS-0${1042 - i}`, customer_id: customers[i % customers.length].id, appointment_id: null,
    prices_include_tax: true, subtotal: total, discount_total: i === 5 ? 500 : 0, taxable_total: taxable, cgst: Math.round(tax / 2 * 100) / 100,
    sgst: Math.round((tax - Math.round(tax / 2 * 100) / 100) * 100) / 100, igst: 0, round_off: 0, total, paid_total: i === 3 ? 0 : total,
    status: i === 3 ? 'unpaid' : i === 9 ? 'void' : 'paid', notes: null, void_reason: i === 9 ? 'Billed twice by mistake' : null,
    created_at: new Date(new Date(NOW_ISO).getTime() - i * 5.5 * 3600000).toISOString(),
  };
});

export const invoiceItems: InvoiceItem[] = [
  { id: 'ii-1', invoice_id: 'inv-1042', kind: 'service', service_id: 's-cut-m', staff_id: 'st-priya', name: 'Men’s haircut', qty: 1, unit_price: 450, discount: 0, gst_rate: 18, taxable: 381.36, tax: 68.64, line_total: 450 },
];
export const payments: Payment[] = [{ id: 'p-1', invoice_id: 'inv-1042', method: 'upi', amount: 450, reference: 'UPI 6273', created_at: NOW_ISO }];

export const conversations: (WaConversation & { customer_name: string | null; last_body: string | null })[] = [
  { id: 'cv-1', salon_id: salon.id, customer_id: 'cu-8', wa_id: '919535566778', profile_name: 'Imran', bot_paused: false, needs_attention: false, state: {}, last_inbound_at: at('09:12'), last_message_at: at('09:13'), unread_count: 0, customer_name: 'Imran Qureshi', last_body: 'Booked ✅ Haircut + beard trim with Arjun, today 12:30 PM.' },
  { id: 'cv-2', salon_id: salon.id, customer_id: 'cu-5', wa_id: '919886543210', profile_name: 'Divya', bot_paused: true, needs_attention: true, state: {}, last_inbound_at: at('10:58'), last_message_at: at('10:58'), unread_count: 2, customer_name: 'Divya Shetty', last_body: 'Can I pay the bridal advance by card at the salon?' },
  { id: 'cv-3', salon_id: salon.id, customer_id: 'cu-6', wa_id: '919620011223', profile_name: 'Vikram', bot_paused: false, needs_attention: false, state: {}, last_inbound_at: at('08:40'), last_message_at: at('08:41'), unread_count: 0, customer_name: 'Vikram Singh', last_body: 'You’re booked for a wash & blow-dry with Priya at 2:30 PM today.' },
  { id: 'cv-4', salon_id: salon.id, customer_id: null, wa_id: '919731100220', profile_name: 'Neha', bot_paused: false, needs_attention: false, state: {}, last_inbound_at: at('07:55', '2026-10-26'), last_message_at: at('07:56', '2026-10-26'), unread_count: 0, customer_name: null, last_body: 'Our keratin treatment is ₹6,500 and takes about 3 hours.' },
];

export const messages: WaMessage[] = [
  { id: 'm1', conversation_id: 'cv-1', direction: 'in', author: 'customer', kind: 'text', body: 'Hi, can I get a haircut and beard trim today around 12?', payload: null, status: null, created_at: at('09:11') },
  { id: 'm2', conversation_id: 'cv-1', direction: 'out', author: 'bot', kind: 'interactive', body: 'Arjun is free at 12:30 PM today for a men’s haircut + beard trim (50 min, ₹700). Shall I book it?', payload: { buttons: ['Yes, book it', 'Other times'] }, status: 'read', created_at: at('09:11') },
  { id: 'm3', conversation_id: 'cv-1', direction: 'in', author: 'customer', kind: 'button', body: 'Yes, book it', payload: null, status: null, created_at: at('09:12') },
  { id: 'm4', conversation_id: 'cv-1', direction: 'out', author: 'bot', kind: 'text', body: 'Booked ✅ Haircut + beard trim with Arjun, today 12:30 PM. Reply here if you need to change it.', payload: null, status: 'read', created_at: at('09:13') },
  { id: 'm5', conversation_id: 'cv-2', direction: 'in', author: 'customer', kind: 'text', body: 'Hi! My balayage trial is today at 3. Do I need to pay the advance before?', payload: null, status: null, created_at: at('10:55') },
  { id: 'm6', conversation_id: 'cv-2', direction: 'out', author: 'bot', kind: 'text', body: 'Bridal trials need a ₹1,000 advance. I’ve asked the team to confirm how you can pay — someone will reply here shortly.', payload: null, status: 'delivered', created_at: at('10:56') },
  { id: 'm7', conversation_id: 'cv-2', direction: 'in', author: 'customer', kind: 'text', body: 'Can I pay the bridal advance by card at the salon?', payload: null, status: null, created_at: at('10:58') },
];

export const report: SalonReport = {
  revenue: 386450, collected: 379200, tax: 58950, bills: 412, avg_bill: 938, new_clients: 64,
  appointments: { completed: 398, cancelled: 31, no_show: 12, booked: 46, confirmed: 9 },
  by_source: { whatsapp: 171, online: 64, walk_in: 102, staff: 98, phone: 41 },
  by_day: Array.from({ length: 27 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, revenue: Math.round(9000 + 6000 * Math.sin(i / 2.2) ** 2 + (i % 7 >= 5 ? 9000 : 0) + i * 120), bills: 10 + (i % 7 >= 5 ? 9 : 4) })),
  by_staff: [
    { staff_id: 'st-meera', name: 'Meera Iyer', color: '#C2541B', revenue: 128400, services: 96, commission: 19260 },
    { staff_id: 'st-priya', name: 'Priya Nair', color: '#7A3FB8', revenue: 101250, services: 164, commission: 12150 },
    { staff_id: 'st-sana', name: 'Sana Sheikh', color: '#B43D6B', revenue: 68900, services: 88, commission: 6890 },
    { staff_id: 'st-arjun', name: 'Arjun Das', color: '#0F6E73', revenue: 41100, services: 121, commission: 4110 },
  ],
  by_service: [
    { name: 'Global colour', revenue: 87400, count: 23 }, { name: 'Balayage', revenue: 67500, count: 9 },
    { name: 'Haircut & style', revenue: 55800, count: 62 }, { name: 'Hydra facial', revenue: 44800, count: 16 },
    { name: 'Keratin treatment', revenue: 39000, count: 6 }, { name: 'Men’s haircut', revenue: 36450, count: 81 },
  ],
  by_method: { upi: 214300, card: 98400, cash: 66500 },
};

export const shellProps = {
  salon: { id: salon.id, name: salon.name, slug: salon.slug, plan_status: salon.plan_status },
  user: { name: 'Asha Rao' },
  role: 'owner' as const,
  memberships: [{ salon_id: salon.id, name: salon.name, role: 'owner' as const }],
  inboxUnread: 2,
  queueCount: 2,
  isPlatformAdmin: true,
};
