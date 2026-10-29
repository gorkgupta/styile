import { customers, services, appointments, TZ } from '../data';
import { computeSlots } from '../../src/lib/availability';
import { hours, NOW_ISO } from '../data';
import { invalidPhoneMessage, normalizePhone } from '../../src/lib/phone';

export const handlers: Record<string, (...args: any[]) => any> = {
  searchClients: (q: string) => ({ ok: true, data: customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q.replace(/\D/g, ''))).slice(0, 8) }),
  quickCreateClient: (i: { name: string; phone: string }) => {
    const phone = normalizePhone(i.phone);
    if (!phone) return { ok: false, error: invalidPhoneMessage(i.phone) };
    return { ok: true, data: { id: 'new', name: i.name, phone, visit_count: 0, last_visit_at: null } };
  },
  findSlots: (i: { serviceIds: string[]; date: string; staffId?: string }) => ({
    ok: true,
    data: computeSlots({
      date: i.date, tz: TZ, now: new Date(NOW_ISO), intervalMin: 15, leadMin: 0,
      durationMin: i.serviceIds.reduce((s, id) => s + (services.find((x) => x.id === id)?.duration_min ?? 0), 0),
      branchHours: hours, staff: [{ id: i.staffId || 'st-priya', hours: null }],
      busy: appointments.filter((a) => a.staff_id && a.status !== 'waiting').map((a) => ({ staffId: a.staff_id!, start: new Date(a.start_at), end: new Date(a.end_at) })),
    }),
  }),
  addWalkIn: () => ({ ok: true, data: { token: 9 }, message: 'Token 9 added to the queue' }),
  createAppointment: () => ({ ok: true, data: { id: 'x' }, message: 'Appointment booked' }),
};
