// Preview stand-ins for src/actions/packages.ts.
import { ananyaCards, ananyaPackages, menuPackages } from '../packages-data';
import { normalizeClientPackage, packageState } from '../../src/lib/packages';
import type { ClientPackage } from '../../src/lib/types';
import { services, TODAY } from '../data';

export const handlers: Record<string, (...args: any[]) => any> = {
  savePackage: (i: { id?: string | null }) => ({ ok: true, data: { id: i.id || 'pk-new' }, message: i.id ? 'Package saved' : 'Package added' }),
  setPackageActive: (_id: string, active: boolean) => ({ ok: true, message: active ? 'Package is on sale again' : 'Package taken off sale. Clients keep the sessions they bought.' }),
  savePlan: (i: { id?: string | null }) => ({ ok: true, data: { id: i.id || 'pl-new' }, message: i.id ? 'Card saved' : 'Membership card added' }),
  setPlanActive: () => ({ ok: true, message: 'Saved' }),
  sellPackage: (i: { packageId: string; method: ClientPackage['method']; reference?: string | null; sendOnWhatsApp?: boolean }) => {
    const m = menuPackages.find((x) => x.id === i.packageId)!;
    const pkg: ClientPackage = normalizeClientPackage({
      id: 'cp-new', salon_id: m.salon_id, customer_id: 'cu-1', package_id: m.id, name: m.name, price: m.price, validity_days: m.validity_days,
      purchased_at: new Date('2026-10-27T06:12:00Z').toISOString(), expires_on: '2027-04-25', status: 'active', receipt_no: 'PK-00063', amount_paid: m.price,
      method: i.method, reference: i.reference || null, note: null, cancelled_at: null, cancel_reason: null, refund_amount: null, refund_method: null,
      items: m.items.map((x, k) => ({ id: `n${k}`, service_id: x.service_id, name: services.find((s) => s.id === x.service_id)!.name, sessions_total: x.sessions, sessions_used: 0, unit_value: 0, sort: k })),
    });
    return { ok: true, data: { package: pkg, sentOnWhatsApp: i.sendOnWhatsApp !== false }, message: `${m.name} sold · receipt PK-00063` };
  },
  cancelPackage: () => ({ ok: true, message: 'Package cancelled' }),
  sellMembership: () => ({ ok: true, data: { invoiceId: 'inv-1043', invoiceNo: 'GS-01043', membership: { ...ananyaCards[0], id: 'cm-new', starts_on: '2027-03-12', ends_on: '2028-03-10' } }, message: 'Glow Card sold · bill GS-01043' }),
  getClientBenefits: (id: string) => ({
    ok: true,
    data: id === 'cu-1'
      ? { packages: ananyaPackages.filter((p) => packageState(p, TODAY) === 'active'), membership: ananyaCards[0] }
      : { packages: [], membership: null },
  }),
};
