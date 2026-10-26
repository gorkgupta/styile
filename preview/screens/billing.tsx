import type { ReactNode } from 'react';
import { PosScreen } from '../../src/components/app/pos';
import { InvoicesScreen, type InvoiceListRow } from '../../src/components/app/invoices';
import { InvoiceDetail } from '../../src/components/app/invoice-detail';
import { CustomersScreen } from '../../src/components/app/customers';
import { CustomerProfile, type ProfileAppointment, type ProfileInvoice } from '../../src/components/app/customer-profile';
import { resolveRange } from '../../src/lib/periods';
import type { Customer, Invoice, InvoiceItem, PayMethod, Payment } from '../../src/lib/types';
import { appointments, categories, customers, invoices, NOW_ISO, salon, services, staff, TODAY, TZ } from '../data';

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

// ---------- Bill detail: a realistic multi-line bill with a discount and split payment ----------
const detailItems: InvoiceItem[] = [
  { id: 'd1', invoice_id: 'inv-1041', kind: 'service', service_id: 's-global', staff_id: 'st-meera', name: 'Global colour', qty: 1, unit_price: 3800, discount: 380, gst_rate: 18, taxable: 2898.31, tax: 521.69, line_total: 3420 },
  { id: 'd2', invoice_id: 'inv-1041', kind: 'service', service_id: 's-blow', staff_id: 'st-priya', name: 'Wash & blow-dry', qty: 1, unit_price: 500, discount: 0, gst_rate: 18, taxable: 423.73, tax: 76.27, line_total: 500 },
  { id: 'd3', invoice_id: 'inv-1041', kind: 'product', service_id: null, staff_id: null, name: 'Colour-protect shampoo 250 ml', qty: 2, unit_price: 649, discount: 0, gst_rate: 18, taxable: 1100, tax: 198, line_total: 1298 },
];
const detailInvoice: Invoice = {
  ...invoices[1], id: 'inv-1041', invoice_no: 'GS-01041', customer_id: 'cu-7', subtotal: 5598, discount_total: 380,
  taxable_total: 4422.04, cgst: 397.98, sgst: 397.98, igst: 0, round_off: 0, total: 5218, paid_total: 5218, status: 'paid',
  notes: null, void_reason: null, created_at: '2026-10-27T06:42:00.000Z',
};
const detailPayments: Payment[] = [
  { id: 'dp1', invoice_id: 'inv-1041', method: 'upi', amount: 4000, reference: 'UPI 6273 1842', created_at: '2026-10-27T06:43:00.000Z' },
  { id: 'dp2', invoice_id: 'inv-1041', method: 'cash', amount: 1218, reference: null, created_at: '2026-10-27T06:43:00.000Z' },
];
const salonForBill = {
  name: salon.name, legal_name: salon.legal_name, gstin: salon.gstin, phone: salon.phone, email: salon.email,
  address: salon.address, city: salon.city, state: salon.state, pincode: salon.pincode, waConnected: true,
};
const staffNames = Object.fromEntries(staff.map((s) => [s.id, s.name]));

// ---------- Clients ----------
const clientList: Customer[] = [
  ...customers.map((c, i) => ({ ...c, created_at: i === 5 ? '2026-10-24T05:00:00Z' : i === 3 ? '2026-10-20T05:00:00Z' : c.created_at })),
  { ...customers[0], id: 'cu-9', name: 'Meenakshi Sundaram', phone: '919176543210', tags: ['VIP'], visit_count: 31, total_spent: 84300, last_visit_at: '2026-07-14T06:00:00Z', birthday: '1985-10-30', notes: null, email: null },
  { ...customers[1], id: 'cu-10', name: 'Aditya Kulkarni', phone: '919822334455', tags: [], visit_count: 2, total_spent: 1300, last_visit_at: '2026-06-02T06:00:00Z', birthday: '1996-10-11', created_at: '2026-05-20T05:00:00Z' },
];

const ananya = clientList[0];
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

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/app/pos': {
    title: 'New bill',
    render: () => (
      <PosScreen
        salon={{ pricesIncludeTax: salon.prices_include_tax, defaultGstRate: salon.default_gst_rate, waConnected: true, nextInvoiceNo: 'GS-01043' }}
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
      <CustomerProfile customer={ananya} appointments={profileAppts} invoices={profileBills}
        staff={staff.map((s) => ({ id: s.id, name: s.name, color: s.color }))} today={TODAY} nowIso={NOW_ISO} tz={TZ} canDelete canBill />
    ),
  },
};
