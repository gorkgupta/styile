import type { ReactNode } from 'react';
import { LandingPage } from '../../src/components/marketing/landing';
import { LoginForm, OnboardingForm, SignupForm } from '../../src/components/public/auth-forms';
import { ResetPasswordForm } from '../../src/components/public/reset-form';
import { BookingFlow, type BookingPageProps } from '../../src/components/public/booking-flow';
import { PortalHome, type PortalProps } from '../../src/components/portal/portal';
import { PortalLogin } from '../../src/components/portal/portal-login';
import { BillView, type CustomerBill } from '../../src/components/portal/bill-view';
import { AdminConsole, type AdminSalonRow } from '../../src/components/admin/console';
import { branch, categories, hours, invoiceItems, invoices, NOW_ISO, payments, salon, services, TODAY } from '../data';
import { previewSkills, profiledStaff } from '../stylist-data';
import { toPublicStylist } from '../../src/lib/stylists';
import { ananyaCoinHistory, ananyaCoins } from '../coins-data';
import { phoneScreens } from '../phone-screens';

const staff = profiledStaff;

const bookingProps: BookingPageProps = {
  salon: { name: salon.name, slug: salon.slug, address: branch.address, city: salon.city, phone: salon.phone, timezone: salon.timezone, brandColor: salon.brand_color, bookingWindowDays: 21 },
  base: '',
  hours: { ...hours, mon: [] }, // closed on Mondays, to show disabled days in the strip
  categories: categories.map((c) => ({ id: c.id, name: c.name })),
  services: services.map((s) => ({ id: s.id, category_id: s.category_id, name: s.name, description: s.id === 's-facial' ? 'Deep cleanse, exfoliation and hydration. Suits all skin types.' : null, duration_min: s.duration_min, price: s.price, gender: s.gender })),
  staff: staff.map(toPublicStylist),
  skills: previewSkills,
  today: TODAY,
  me: null,
};

const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - 330 * 60000).toISOString();
};
const svcLines = (...ids: string[]) => ids.map((id) => { const s = services.find((x) => x.id === id)!; return { name: s.name, price: s.price }; });
const st = (id: string) => { const s = staff.find((x) => x.id === id)!; return { id: s.id, name: s.name, color: s.color, photoUrl: s.photo_url, bookable: true }; };

const portalProps: PortalProps = {
  me: { name: 'Ananya Krishnan', phone: '919845098450' },
  nowIso: NOW_ISO,
  base: '',
  known: true,
  salon: { id: salon.id, name: salon.name, slug: salon.slug, city: salon.city, phone: salon.phone, timezone: salon.timezone, hours: { ...hours, mon: [] }, bookingWindowDays: 21, bookingEnabled: true },
  upcoming: [
    { id: 'ap-u1', salonId: salon.id, start_at: ist('2026-10-28', '17:15'), end_at: ist('2026-10-28', '18:15'), status: 'confirmed', stylist: st('st-priya'), services: svcLines('s-cut-w'), serviceIds: ['s-cut-w'], invoiceId: null },
    { id: 'ap-u2', salonId: salon.id, start_at: ist('2026-11-07', '11:00'), end_at: ist('2026-11-07', '13:00'), status: 'booked', stylist: st('st-arjun'), services: svcLines('s-blow'), serviceIds: ['s-blow'], invoiceId: null },
  ],
  past: [
    { id: 'ap-p1', salonId: salon.id, start_at: ist('2026-10-02', '14:30'), end_at: ist('2026-10-02', '16:30'), status: 'completed', stylist: st('st-meera'), services: svcLines('s-global'), serviceIds: ['s-global'], invoiceId: 'inv-1041' },
    { id: 'ap-p2', salonId: salon.id, start_at: ist('2026-09-12', '11:00'), end_at: ist('2026-09-12', '12:00'), status: 'completed', stylist: st('st-priya'), services: svcLines('s-cut-w'), serviceIds: ['s-cut-w'], invoiceId: null },
    { id: 'ap-p3', salonId: salon.id, start_at: ist('2026-08-30', '12:00'), end_at: ist('2026-08-30', '13:15'), status: 'cancelled', stylist: st('st-sana'), services: svcLines('s-facial'), serviceIds: ['s-facial'], invoiceId: null },
  ],
  bills: [
    { id: 'inv-1041', salonId: salon.id, invoice_no: 'GS-01041', created_at: ist('2026-10-02', '16:40'), total: 3800, status: 'paid' },
  ],
  coins: { balance: ananyaCoins, history: ananyaCoinHistory.map((t) => ({ ...t, reference: null })) },
};

const inv = invoices[0];
const customerBill: CustomerBill = {
  salon: { name: salon.name, legalName: salon.legal_name, gstin: salon.gstin, address: salon.address, city: salon.city, state: salon.state, pincode: salon.pincode, phone: salon.phone, slug: salon.slug, timezone: salon.timezone },
  // Regular GST, after 22 Sep 2025: services at 5%.
  invoice: { ...inv, total: 1350, subtotal: 1450, discount_total: 100, taxable_total: 1285.71, cgst: 32.15, sgst: 32.14, paid_total: 1350,
    bill_type: 'tax_invoice', seller_gstin: salon.gstin, place_of_supply: 'Karnataka (29)', client_gstin: null, client_address: null },
  customer: { name: 'Rohan Mehta', phone: '919811112222' },
  items: [
    ...invoiceItems.map((i) => ({ id: i.id, name: i.name, kind: i.kind, code: '999721', qty: i.qty, unit_price: i.unit_price, discount: i.discount, gst_rate: 5, taxable: 428.57, tax: 21.43, line_total: i.line_total, stylist: 'Priya Nair' })),
    { id: 'ii-2', name: 'Hair spa', kind: 'service' as const, code: '999721', qty: 1, unit_price: 1000, discount: 100, gst_rate: 5, taxable: 857.14, tax: 42.86, line_total: 900, stylist: 'Priya Nair' },
  ],
  payments: [...payments.map((x) => ({ method: x.method, amount: x.amount })), { method: 'wallet', amount: 900 }],
};

const daysFromNow = (n: number) => new Date(new Date(NOW_ISO).getTime() + n * 86400000).toISOString();
const adminRow = (name: string, slug: string, city: string, plan: AdminSalonRow['plan'], status: AdminSalonRow['status'], extra: Partial<AdminSalonRow> = {}): AdminSalonRow => ({
  id: `sal-${slug}`, name, slug, city, plan, status, trialEndsAt: null, ownerEmail: `${slug.split('-')[0]}@gmail.com`, ownerName: null,
  staffCount: 4, bookings30d: 120, whatsapp30d: 40, wa: null, bookingEnabled: true, createdAt: daysFromNow(-120), gstMode: 'regular', gstin: '29AABCK1234L1Z2', ...extra,
});
const adminSalons: AdminSalonRow[] = [
  adminRow('Glow Studio', 'glow-studio', 'Bengaluru', 'growth', 'active', { ownerEmail: 'asha@glowstudio.in', ownerName: 'Asha Rao', staffCount: 6, bookings30d: 482, whatsapp30d: 171, wa: { phoneNumberId: '1098765432', businessAccountId: '2233445566', displayNumber: '+91 98450 12345' }, createdAt: daysFromNow(-290) }),
  adminRow('Kutting Edge Unisex', 'kutting-edge', 'Bengaluru', 'starter', 'active', { staffCount: 3, bookings30d: 164, whatsapp30d: 22 }),
  adminRow('Saffron Salon Banjara Hills', 'saffron-banjara', 'Hyderabad', 'pro', 'active', { staffCount: 18, bookings30d: 1260, whatsapp30d: 610, ownerName: 'Ravi Kumar', wa: { phoneNumberId: '1033445566', businessAccountId: '9988776655', displayNumber: '+91 90000 44321' } }),
  adminRow('Tashi Beauty Parlour', 'tashi-beauty', 'Jaigaon', 'starter', 'active', { staffCount: 2, bookings30d: 96, whatsapp30d: 41, gstMode: 'unregistered', gstin: null }),
  adminRow('Dooars Unisex Salon', 'dooars-salon', 'Jaigaon', 'trial', 'trialing', { trialEndsAt: daysFromNow(9), staffCount: 4, bookings30d: 58, whatsapp30d: 12, gstMode: 'composition', gstin: '19AKQPT4821M1Z6', createdAt: daysFromNow(-5) }),
  adminRow('Mirror Mirror', 'mirror-mirror', 'Pune', 'trial', 'trialing', { trialEndsAt: daysFromNow(2), staffCount: 2, bookings30d: 18, whatsapp30d: 0, createdAt: daysFromNow(-12) }),
  adminRow('The Barber Room', 'barber-room', 'Mumbai', 'trial', 'trialing', { trialEndsAt: daysFromNow(6), staffCount: 5, bookings30d: 74, whatsapp30d: 31, createdAt: daysFromNow(-8), wa: { phoneNumberId: '1077889900', businessAccountId: '5544332211', displayNumber: '+91 98200 11223' } }),
  adminRow('Lotus Salon & Spa', 'lotus-salon', 'Kochi', 'trial', 'trialing', { trialEndsAt: daysFromNow(11), staffCount: 1, bookings30d: 3, whatsapp30d: 0, createdAt: daysFromNow(-3), gstMode: 'unregistered', gstin: null }),
  adminRow('Bombay Hair Co.', 'bombay-hair', 'Mumbai', 'growth', 'past_due', { staffCount: 8, bookings30d: 301, whatsapp30d: 95 }),
  adminRow('Shringar Beauty Parlour', 'shringar', 'Jaipur', 'starter', 'suspended', { staffCount: 2, bookings30d: 0, whatsapp30d: 0 }),
  adminRow('Chennai Cuts', 'chennai-cuts', 'Chennai', 'starter', 'cancelled', { staffCount: 2, bookings30d: 0, whatsapp30d: 0, createdAt: daysFromNow(-400) }),
];

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/': { title: 'Landing page', render: () => <LandingPage /> },
  '/login': { title: 'Staff log in', render: () => <LoginForm salonName={salon.name} /> },
  '/signup': { title: 'Sign up', render: () => <SignupForm /> },
  '/onboarding': { title: 'Onboarding', render: () => <OnboardingForm ownerName="Asha Rao" appHost="styile.com" /> },
  '/reset': { title: 'Reset password', render: () => <ResetPasswordForm /> },
  '/me': { title: 'Client portal', render: () => <PortalHome {...portalProps} /> },
  '/me/login': { title: 'Client log in', render: () => <PortalLogin base="" salonName={salon.name} /> },
  ...phoneScreens(bookingProps), // Bhutan (+975) client: booking OTP step and front-desk quick add
  '/me/bills/[id]': { title: 'Client bill', render: () => <BillView bill={customerBill} phone="919811112222" base="" /> },
  '/admin': { title: 'Platform admin', render: () => <AdminConsole salons={adminSalons} nowIso={NOW_ISO} adminName="Styile team" hasSalon /> },
  '/s/[slug]': { title: 'Public booking page', render: () => <BookingFlow {...bookingProps} /> },
  '/s/[slug]/stylist': {
    title: 'Public booking page — choose a stylist (returning client, usual stylist)',
    render: () => <BookingFlow {...bookingProps} me={{ phone: '919845098450', name: 'Ananya Krishnan' }} usualStylistId="st-meera" initial={{ serviceIds: ['s-blow'], staffId: null, step: 2 }} />,
  },
  '/s/[slug]/stylist-new': {
    title: 'Public booking page — choose a stylist (new client, colour)',
    render: () => <BookingFlow {...bookingProps} initial={{ serviceIds: ['s-global'], staffId: null, step: 2 }} />,
  },
  '/s/[slug]/again': {
    title: 'Public booking page — “Book again with Meera” link',
    render: () => <BookingFlow {...bookingProps} me={{ phone: '919845098450', name: 'Ananya Krishnan' }} initial={{ serviceIds: ['s-global'], staffId: 'st-meera', step: 3 }} />,
  },
  '/s/[slug]/with': {
    title: 'Public booking page — link to a stylist (“Book with Arjun”)',
    render: () => <BookingFlow {...bookingProps} initial={{ serviceIds: [], staffId: 'st-arjun', step: 1 }} />,
  },
};
