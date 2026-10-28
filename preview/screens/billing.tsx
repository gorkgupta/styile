import { useEffect, type ReactNode } from 'react';
import { ServicesScreen } from '../../src/components/app/services';
import { PosScreen } from '../../src/components/app/pos';
import { InvoicesScreen, type InvoiceListRow } from '../../src/components/app/invoices';
import { InvoiceDetail } from '../../src/components/app/invoice-detail';
import { CustomersScreen } from '../../src/components/app/customers';
import { CustomerProfile, type ProfileAppointment, type ProfileInvoice } from '../../src/components/app/customer-profile';
import { resolveRange } from '../../src/lib/periods';
import type { Customer, Invoice, InvoiceItem, PayMethod, Payment } from '../../src/lib/types';
import { appointments, categories, customers, invoices, NOW_ISO, services, staff, TODAY, TZ } from '../data';
import { ananyaCoinHistory, ananyaCoins, coinPacks } from '../coins-data';
import { SettingsScreen } from '../../src/components/app/settings';
import { ReportsScreen } from '../../src/components/app/reports';
import { BillView, type CustomerBill } from '../../src/components/portal/bill-view';
import { b2bInvoice, bosInvoice, bosSalon, gstReports, jaigaonClients, plainInvoice, plainSalon, regularSalon, taxInvoice } from '../gst-data';
import { branch } from '../data';
import type { Salon } from '../../src/lib/types';

// ---------- POS: checking out Lakshmi Menon's global colour with Meera ----------
const lakshmiAppt = appointments.find((a) => a.customer_id === 'cu-7' && a.status === 'in_service')!;
const lakshmi = customers.find((c) => c.id === 'cu-7')!;

// ---------- Bills list ----------
const METHODS: PayMethod[][] = [['upi'], ['card'], ['upi'], [], ['cash'], ['upi', 'cash'], ['card'], ['cash'], ['upi'], ['upi'], ['cash'], ['card']];
const listRows: InvoiceListRow[] = invoices.map((inv, i) => {
  const cu = customers.find((c) => c.id === inv.customer_id)!;
  const partial = i === 6;
  return {
    id: inv.id, invoice_no: inv.invoice_no, created_at: inv.created_at, total: inv.total,
    paid_total: partial ? 500 : inv.paid_total, status: partial ? 'partial' : inv.status,
    tax: inv.cgst + inv.sgst, customer: i === 2 ? null : { id: cu.id, name: cu.name, phone: cu.phone }, methods: METHODS[i],
  };
});

// ---------- Bill detail: a realistic multi-line tax invoice (5% services, 5% and 18% products) with a discount and split payment ----------
const detailItems: InvoiceItem[] = taxInvoice.items;
const detailInvoice: Invoice = taxInvoice.invoice;
const detailPayments: Payment[] = taxInvoice.payments;
const billSalon = (x: Salon) => ({
  name: x.name, legal_name: x.legal_name, gstin: x.gstin, phone: x.phone, email: x.email,
  address: x.address, city: x.city, state: x.state, pincode: x.pincode, waConnected: !!x.wa_phone_number_id,
});
const salonForBill = { ...billSalon(regularSalon), upiVpa: regularSalon.upi_vpa, upiName: regularSalon.upi_payee_name, receiptSize: 'a4' as const, payMethods: regularSalon.payment_methods };
const posSalon = (x: Salon) => ({ gstMode: x.gst_mode, pricesIncludeTax: x.prices_include_tax, serviceRate: 5, waConnected: !!x.wa_phone_number_id,
  nextInvoiceNo: `${x.invoice_prefix}-${String(x.next_invoice_no).padStart(5, '0')}`,
  payMethods: x.payment_methods, upi: x.upi_vpa ? { vpa: x.upi_vpa, name: x.upi_payee_name ?? x.name } : null, receiptSize: x.receipt_size });
const withPay = (x: Salon, paper?: Salon['receipt_size']) => ({ ...billSalon(x), upiVpa: x.upi_vpa, upiName: x.upi_payee_name, receiptSize: paper ?? 'a4', payMethods: x.payment_methods });
const customerBillOf = (x: Salon, b: typeof taxInvoice, customer: { name: string; phone: string } | null): CustomerBill => ({
  salon: { name: x.name, legalName: x.legal_name, gstin: x.gstin, address: x.address, city: x.city, state: x.state, pincode: x.pincode, phone: x.phone, slug: x.slug, timezone: x.timezone,
    upiVpa: x.upi_vpa, upiName: x.upi_payee_name },
  invoice: b.invoice, customer,
  items: b.items.map((i) => ({ ...i, stylist: i.staff_id ? staff.find((s) => s.id === i.staff_id)?.name ?? null : null })),
  payments: b.payments.map((p) => ({ method: p.method, amount: p.amount })),
});
const staffNames = Object.fromEntries(staff.map((s) => [s.id, s.name]));

// ---------- Clients ----------
const COIN_BALANCES: Record<string, number> = { 'cu-1': ananyaCoins, 'cu-5': 4380, 'cu-7': 11500, 'cu-3': 600 };
const clientList: Customer[] = [
  ...customers.map((c, i) => ({ ...c, coin_balance: COIN_BALANCES[c.id] ?? 0, created_at: i === 5 ? '2026-10-24T05:00:00Z' : i === 3 ? '2026-10-20T05:00:00Z' : c.created_at })),
  { ...customers[0], id: 'cu-9', name: 'Meenakshi Sundaram', phone: '919176543210', tags: ['VIP'], visit_count: 31, total_spent: 84300, last_visit_at: '2026-07-14T06:00:00Z', birthday: '1985-10-30', notes: null, email: null },
  { ...customers[1], id: 'cu-10', name: 'Aditya Kulkarni', phone: '919822334455', tags: [], visit_count: 2, total_spent: 1300, last_visit_at: '2026-06-02T06:00:00Z', birthday: '1996-10-11', created_at: '2026-05-20T05:00:00Z' },
];

const ananya = clientList[0];
const coinsFor = (role: 'owner' | 'receptionist') => ({
  salon: { name: regularSalon.name, enabled: true, packs: coinPacks, waConnected: true },
  history: ananyaCoinHistory, canSell: true, canBonus: role === 'owner', canAdjust: role === 'owner',
});
// Bill paid partly with coins
const coinPayments: Payment[] = [
  { id: 'cp1', invoice_id: 'inv-1041', method: 'wallet', amount: 3218, reference: null, created_at: '2026-10-27T06:43:00.000Z' },
  { id: 'cp2', invoice_id: 'inv-1041', method: 'upi', amount: 2000, reference: 'UPI 7731 0042', created_at: '2026-10-27T06:43:00.000Z' },
];
const profileAppts: ProfileAppointment[] = [
  { id: 'pa1', start_at: appointments[3].start_at, status: 'checked_in', source: 'whatsapp', staff_id: 'st-priya', invoice_id: null, services: [{ name: 'Haircut & style', price: 900 }] },
  { id: 'pa2', start_at: '2026-11-08T05:30:00.000Z', status: 'confirmed', source: 'online', staff_id: 'st-meera', invoice_id: null, services: [{ name: 'Root touch-up', price: 1600 }] },
  { id: 'pa3', start_at: '2026-10-02T09:00:00.000Z', status: 'completed', source: 'whatsapp', staff_id: 'st-meera', invoice_id: 'inv-1041', services: [{ name: 'Global colour', price: 3800 }, { name: 'Wash & blow-dry', price: 500 }] },
  { id: 'pa4', start_at: '2026-09-06T08:30:00.000Z', status: 'completed', source: 'staff', staff_id: 'st-meera', invoice_id: 'inv-1036', services: [{ name: 'Hydra facial', price: 2800 }] },
  { id: 'pa5', start_at: '2026-08-15T07:00:00.000Z', status: 'no_show', source: 'phone', staff_id: 'st-sana', invoice_id: null, services: [{ name: 'Manicure', price: 700 }] },
  { id: 'pa6', start_at: '2026-07-19T06:00:00.000Z', status: 'completed', source: 'whatsapp', staff_id: 'st-meera', invoice_id: 'inv-1020', services: [{ name: 'Balayage', price: 7500 }] },
];
const profileBills: ProfileInvoice[] = [
  { id: 'inv-1041', invoice_no: 'GS-01041', created_at: '2026-10-02T09:40:00.000Z', total: 5218, paid_total: 5218, status: 'paid' },
  { id: 'inv-1036', invoice_no: 'GS-01036', created_at: '2026-09-06T09:45:00.000Z', total: 2800, paid_total: 1800, status: 'partial' },
  { id: 'inv-1029', invoice_no: 'GS-01029', created_at: '2026-08-20T10:10:00.000Z', total: 900, paid_total: 0, status: 'void' },
  { id: 'inv-1020', invoice_no: 'GS-01020', created_at: '2026-07-19T09:30:00.000Z', total: 7500, paid_total: 7500, status: 'paid' },
];

/** Opens the n-th service's edit sheet once rendered. */
function OpenService({ index, children }: { index: number; children: ReactNode }) {
  useEffect(() => { document.querySelectorAll<HTMLButtonElement>('.svc-main')[index]?.click(); }, [index]);
  return <>{children}</>;
}

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/app/services/edit-gst': {
    title: 'Services — edit (SAC and GST)',
    render: () => <OpenService index={7}><ServicesScreen services={services.map((x) => ({ ...x, sac_code: x.category_id === 'c-skin' ? '999722' : '999721' }))} categories={categories} serviceRate={5} gstMode="regular" pricesIncludeTax /></OpenService>,
  },
  '/app/pos': {
    title: 'New bill',
    render: () => (
      <PosScreen
        salon={posSalon(regularSalon)}
        services={services} categories={categories} staff={staff}
        prefill={{
          appointmentId: lakshmiAppt.id,
          customer: { id: lakshmi.id, name: lakshmi.name, phone: lakshmi.phone, visit_count: lakshmi.visit_count, last_visit_at: lakshmi.last_visit_at },
          context: `Checkout · ${lakshmi.name} · 10:00 AM with Meera Iyer`,
          lines: lakshmiAppt.services.map((s) => ({ serviceId: s.service_id, name: s.name, price: s.price, staffId: lakshmiAppt.staff_id, gstRate: null })),
        }}
      />
    ),
  },
  '/app/pos/plain': {
    title: 'New bill (Jaigaon parlour, not GST registered)',
    render: () => (
      <PosScreen salon={posSalon(plainSalon)} services={services} categories={categories} staff={staff}
        prefill={{ appointmentId: null, customer: { id: 'cu-j2', name: 'Rinku Sharma', phone: '919733055502', visit_count: 6, last_visit_at: null }, lines: [
          { serviceId: 's-cut-w', name: 'Haircut (ladies)', price: 250, staffId: null, gstRate: null },
          { serviceId: 's-facial', name: 'Fruit facial', price: 600, staffId: null, gstRate: null },
        ] }} />
    ),
  },
  '/app/invoices/x1': {
    title: 'Tax invoice (regular GST: 5% services, 5% + 18% products)',
    render: () => (
      <InvoiceDetail invoice={taxInvoice.invoice} items={taxInvoice.items} payments={taxInvoice.payments}
        customer={{ id: lakshmi.id, name: lakshmi.name, phone: lakshmi.phone, email: 'lakshmi.menon@gmail.com' }}
        salon={salonForBill} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/app/invoices/b2b': {
    title: 'Tax invoice to a business client (client GSTIN)',
    render: () => (
      <InvoiceDetail invoice={b2bInvoice.invoice} items={b2bInvoice.items} payments={b2bInvoice.payments}
        customer={{ id: 'cu-9', name: 'Meenakshi Sundaram', phone: '919176543210', email: null }}
        salon={salonForBill} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/app/invoices/bos': {
    title: 'Bill of supply (composition scheme)',
    render: () => (
      <InvoiceDetail invoice={bosInvoice.invoice} items={bosInvoice.items} payments={bosInvoice.payments}
        customer={jaigaonClients['cu-j1']} salon={withPay(bosSalon)} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/app/invoices/plain': {
    title: 'Plain bill (not GST registered, part paid)',
    render: () => (
      <InvoiceDetail invoice={plainInvoice.invoice} items={plainInvoice.items} payments={plainInvoice.payments}
        customer={jaigaonClients['cu-j2']} salon={withPay(plainSalon)} staffNames={staffNames} tz={TZ} canVoid={false} />
    ),
  },
  '/app/invoices/x1/receipt80': {
    title: 'Receipt 80 mm (tax invoice, paid)',
    render: () => (
      <InvoiceDetail invoice={taxInvoice.invoice} items={taxInvoice.items} payments={taxInvoice.payments}
        customer={{ id: lakshmi.id, name: lakshmi.name, phone: lakshmi.phone, email: null }}
        salon={withPay(regularSalon, '80')} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/app/invoices/due/receipt80': {
    title: 'Receipt 80 mm (tax invoice, balance due → UPI QR)',
    render: () => (
      <InvoiceDetail invoice={{ ...taxInvoice.invoice, status: 'partial', paid_total: 5000 }} items={taxInvoice.items} payments={taxInvoice.payments.slice(0, 1)}
        customer={{ id: lakshmi.id, name: lakshmi.name, phone: lakshmi.phone, email: null }}
        salon={withPay(regularSalon, '80')} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/app/invoices/plain/receipt58': {
    title: 'Receipt 58 mm (plain bill, Nu cash, balance due → UPI QR)',
    render: () => (
      <InvoiceDetail invoice={plainInvoice.invoice} items={plainInvoice.items} payments={plainInvoice.payments}
        customer={jaigaonClients['cu-j2']} salon={withPay(plainSalon, '58')} staffNames={staffNames} tz={TZ} canVoid={false} />
    ),
  },
  '/app/invoices/bos/receipt58': {
    title: 'Receipt 58 mm (bill of supply)',
    render: () => (
      <InvoiceDetail invoice={bosInvoice.invoice} items={bosInvoice.items} payments={bosInvoice.payments}
        customer={jaigaonClients['cu-j1']} salon={withPay(bosSalon, '58')} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/me/bills/x1': { title: 'Client bill (tax invoice)', render: () => <BillView bill={customerBillOf(regularSalon, taxInvoice, { name: lakshmi.name, phone: lakshmi.phone })} phone={lakshmi.phone} base="" /> },
  '/me/bills/bos': { title: 'Client bill (bill of supply)', render: () => <BillView bill={customerBillOf(bosSalon, bosInvoice, { name: 'Sonam Lhamo', phone: '919733055501' })} phone="919733055501" base="" /> },
  '/me/bills/plain': { title: 'Client bill (plain bill, balance due)', render: () => <BillView bill={customerBillOf(plainSalon, plainInvoice, { name: 'Rinku Sharma', phone: '919733055502' })} phone="919733055502" base="" /> },
  '/app/settings/gst-plain': {
    title: 'Settings — Billing & GST (not registered)',
    render: () => <SettingsScreen salon={plainSalon} hours={branch.business_hours} supportEmail="support@styile.com" />,
  },
  '/app/settings/gst-bos': {
    title: 'Settings — Billing & GST (composition)',
    render: () => <SettingsScreen salon={bosSalon} hours={branch.business_hours} supportEmail="support@styile.com" />,
  },
  '/app/reports/plain': {
    title: 'Reports (not registered: ₹20 lakh meter)',
    render: () => <ReportsScreen report={gstReports.unregistered} previous={null} range={{ key: 'month', from: '2026-10-01', to: TODAY }} today={TODAY} salonName={plainSalon.name} gstMode="unregistered" />,
  },
  '/app/reports/bos': {
    title: 'Reports (composition tax estimate)',
    render: () => <ReportsScreen report={gstReports.composition} previous={null} range={{ key: 'month', from: '2026-10-01', to: TODAY }} today={TODAY} salonName={bosSalon.name} gstMode="composition" />,
  },
  '/app/invoices': {
    title: 'Bills',
    render: () => <InvoicesScreen rows={listRows} range={resolveRange('week', TODAY)} today={TODAY} tz={TZ} />,
  },
  '/app/invoices/[id]': {
    title: 'Bill detail',
    render: () => (
      <InvoiceDetail invoice={detailInvoice} items={detailItems} payments={detailPayments}
        customer={{ id: lakshmi.id, name: lakshmi.name, phone: lakshmi.phone, email: 'lakshmi.menon@gmail.com' }}
        salon={salonForBill} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/app/invoices/void': {
    title: 'Bill detail (cancelled, part paid)',
    render: () => (
      <InvoiceDetail invoice={{ ...detailInvoice, status: 'void', paid_total: 4000, void_reason: 'Billed twice by mistake' }} items={detailItems} payments={detailPayments.slice(0, 1)}
        customer={{ id: lakshmi.id, name: lakshmi.name, phone: lakshmi.phone, email: null }}
        salon={salonForBill} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
  '/app/invoices/due': {
    title: 'Bill detail (part paid)',
    render: () => (
      <InvoiceDetail invoice={{ ...detailInvoice, status: 'partial', paid_total: 4000 }} items={detailItems} payments={detailPayments.slice(0, 1)}
        customer={null} salon={salonForBill} staffNames={staffNames} tz={TZ} canVoid={false} />
    ),
  },
  '/app/customers': {
    title: 'Clients',
    render: () => <CustomersScreen clients={clientList} today={TODAY} tz={TZ} />,
  },
  '/app/customers/[id]': {
    title: 'Client profile',
    render: () => (
      <CustomerProfile customer={ananya} appointments={profileAppts} invoices={profileBills} coins={coinsFor('owner')}
        staff={staff.map((s) => ({ id: s.id, name: s.name, color: s.color }))} today={TODAY} nowIso={NOW_ISO} tz={TZ} canDelete canBill />
    ),
  },
  '/app/customers/coins-desk': {
    title: 'Client profile (front desk, new to coins)',
    render: () => (
      <CustomerProfile customer={{ ...clientList[1], coin_balance: 0 }} appointments={profileAppts.slice(0, 2)} invoices={[]}
        coins={{ ...coinsFor('receptionist'), history: [] }}
        staff={staff.map((s) => ({ id: s.id, name: s.name, color: s.color }))} today={TODAY} nowIso={NOW_ISO} tz={TZ} canDelete={false} canBill />
    ),
  },
  '/app/pos/coins': {
    title: 'New bill (client with coins)',
    render: () => {
      const a = appointments.find((x) => x.customer_id === 'cu-1')!;
      return (
        <PosScreen
          salon={posSalon(regularSalon)}
          services={services} categories={categories} staff={staff}
          prefill={{
            appointmentId: a.id,
            customer: { id: ananya.id, name: ananya.name, phone: ananya.phone, visit_count: ananya.visit_count, last_visit_at: ananya.last_visit_at, coin_balance: ananyaCoins },
            context: `Checkout · ${ananya.name} · 11:30 AM with Priya Nair`,
            lines: [...a.services, services.find((x) => x.id === 's-blow')!].map((s) => ({ serviceId: 'service_id' in s ? s.service_id : s.id, name: s.name, price: s.price, staffId: a.staff_id, gstRate: null })),
          }}
        />
      );
    },
  },
  '/app/invoices/coins': {
    title: 'Bill detail (paid partly with coins)',
    render: () => (
      <InvoiceDetail invoice={detailInvoice} items={detailItems} payments={coinPayments}
        customer={{ id: ananya.id, name: ananya.name, phone: ananya.phone, email: ananya.email, coin_balance: ananyaCoins }}
        salon={salonForBill} staffNames={staffNames} tz={TZ} canVoid />
    ),
  },
};
