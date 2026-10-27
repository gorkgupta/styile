import { computeSlots, qualifiedStaff } from '../../src/lib/availability';
import { earliestByStylist } from '../../src/lib/stylists';
import { addDays, dayKeyOf } from '../../src/lib/time';
import { appointments, hours, NOW_ISO, salon, services, staff, TODAY, TZ } from '../data';
import { previewSkills } from '../stylist-data';

const busy = () => appointments.filter((a) => a.staff_id && !['waiting', 'cancelled', 'no_show'].includes(a.status))
  .map((a) => ({ staffId: a.staff_id!, start: new Date(a.start_at), end: new Date(a.end_at) }));

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
  // Same scan as the real action: one run per open day over the stylists who do every chosen service, up to 7 days.
  getStylistNextFree: (_slug: string, serviceIds: string[]) => {
    const skills = new Map(Object.entries(previewSkills).map(([k, v]) => [k, new Set(v)]));
    const team = qualifiedStaff(staff, skills, serviceIds);
    const durationMin = serviceIds.reduce((s, id) => s + (services.find((x) => x.id === id)?.duration_min ?? 0), 0);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(TODAY, i);
      if (!hours[dayKeyOf(date)]?.length) continue;
      days.push({ date, slots: computeSlots({ date, tz: TZ, now: new Date(NOW_ISO), intervalMin: salon.slot_interval_min, leadMin: salon.booking_lead_min,
        durationMin, branchHours: hours, staff: team.map((s) => ({ id: s.id, hours: s.working_hours })), busy: busy() }) });
    }
    return { ok: true, data: earliestByStylist(days, team.map((s) => s.id)) };
  },
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
