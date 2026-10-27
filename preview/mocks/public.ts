import { computeSlots } from '../../src/lib/availability';
import { appointments, hours, NOW_ISO, salon, services, staff, TZ } from '../data';

// Simulated public booking: real slot engine over the sample day, and a booking that always succeeds.
export const handlers: Record<string, (...args: any[]) => any> = {
  getPublicSlots: (_slug: string, serviceIds: string[], date: string, staffId: string | null) => ({
    ok: true,
    data: computeSlots({
      date, tz: TZ, now: new Date(NOW_ISO), intervalMin: salon.slot_interval_min, leadMin: salon.booking_lead_min,
      durationMin: serviceIds.reduce((s, id) => s + (services.find((x) => x.id === id)?.duration_min ?? 0), 0),
      branchHours: hours,
      staff: staff.filter((s) => !staffId || s.id === staffId).map((s) => ({ id: s.id, hours: s.working_hours })),
      busy: appointments.filter((a) => a.staff_id && !['waiting', 'cancelled', 'no_show'].includes(a.status))
        .map((a) => ({ staffId: a.staff_id!, start: new Date(a.start_at), end: new Date(a.end_at) })),
    }),
  }),
  getMySlots: (_id: string, date: string) => handlers.getPublicSlots('glow-studio', ['s-cut-w'], date, 'st-priya'),
  rescheduleMyBooking: () => ({ ok: true, data: { when: 'Thu, 29 Oct, 4:00 PM', stylist: 'Priya Nair' }, message: 'Booking moved' }),
  claimMyProfiles: () => ({ ok: true, data: { linked: 2 } }),
  bookOnline: (i: { start: string; staffId: string | null; serviceIds: string[] }) => {
    const minutes = i.serviceIds.reduce((s, id) => s + (services.find((x) => x.id === id)?.duration_min ?? 0), 0);
    const st = staff.find((s) => s.id === i.staffId) ?? staff[0];
    const start = new Date(i.start);
    const when = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(start);
    return { ok: true, data: { appointmentId: 'ap-new', when: when.replace(' am', ' AM').replace(' pm', ' PM'), stylist: st.name, start: start.toISOString(), end: new Date(start.getTime() + minutes * 60000).toISOString() } };
  },
};
