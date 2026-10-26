// Pure availability engine: which start times are free for a set of services on a given day.
// Used by the online booking page, the WhatsApp bot and the front desk "find a slot" helper.
// The database exclusion constraint is the final guard against double booking; this decides what to offer.

import type { Hours } from './types';
import { dayKeyOf, hhmmToMinutes, minutesToHhmm, zonedToUtc } from './time';

export interface BusyBlock { staffId: string; start: Date; end: Date }

export interface StaffCandidate { id: string; hours: Hours | null }

export interface AvailabilityInput {
  date: string;              // salon-local YYYY-MM-DD
  tz: string;
  now: Date;
  intervalMin: number;       // slot grid, e.g. 15
  leadMin: number;           // earliest booking = now + lead
  durationMin: number;       // total length of the services
  branchHours: Hours;
  staff: StaffCandidate[];   // only staff who can do every requested service
  busy: BusyBlock[];
}

export interface Slot {
  time: string;              // "14:30" salon-local
  start: string;             // ISO UTC
  end: string;
  staffIds: string[];        // free stylists, least busy first
}

type Window = [number, number]; // minutes from local midnight

function windowsFor(hours: Hours | null | undefined, date: string): Window[] {
  const day = hours?.[dayKeyOf(date)];
  if (!day) return [];
  return day
    .map(([a, b]) => [hhmmToMinutes(a), hhmmToMinutes(b)] as Window)
    .filter(([a, b]) => b > a);
}

function intersect(a: Window[], b: Window[]): Window[] {
  const out: Window[] = [];
  for (const [a1, a2] of a) for (const [b1, b2] of b) {
    const s = Math.max(a1, b1), e = Math.min(a2, b2);
    if (e > s) out.push([s, e]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** Hours a stylist actually works that day: branch hours, narrowed by their own hours when set. */
export function staffWindows(staffHours: Hours | null, branchHours: Hours, date: string): Window[] {
  const branch = windowsFor(branchHours, date);
  return staffHours ? intersect(branch, windowsFor(staffHours, date)) : branch;
}

export function computeSlots(input: AvailabilityInput): Slot[] {
  const { date, tz, now, intervalMin, leadMin, durationMin, branchHours, staff, busy } = input;
  if (durationMin <= 0 || !staff.length) return [];
  const earliest = now.getTime() + leadMin * 60000;
  const dayStart = zonedToUtc(date, '00:00', tz).getTime();
  const toInstant = (min: number) => dayStart + min * 60000; // fine away from DST jumps; India has none

  const busyByStaff = new Map<string, BusyBlock[]>();
  for (const b of busy) {
    const list = busyByStaff.get(b.staffId) ?? [];
    list.push(b);
    busyByStaff.set(b.staffId, list);
  }
  const load = (id: string) => (busyByStaff.get(id) ?? []).reduce((s, b) => s + (b.end.getTime() - b.start.getTime()), 0);

  const slots = new Map<number, string[]>();
  for (const s of staff) {
    const blocks = busyByStaff.get(s.id) ?? [];
    for (const [ws, we] of staffWindows(s.hours, branchHours, date)) {
      for (let t = Math.ceil(ws / intervalMin) * intervalMin; t + durationMin <= we; t += intervalMin) {
        const start = toInstant(t), end = toInstant(t + durationMin);
        if (start < earliest) continue;
        if (blocks.some((b) => b.start.getTime() < end && b.end.getTime() > start)) continue;
        const list = slots.get(t) ?? [];
        list.push(s.id);
        slots.set(t, list);
      }
    }
  }

  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, ids]) => ({
      time: minutesToHhmm(t),
      start: new Date(toInstant(t)).toISOString(),
      end: new Date(toInstant(t + durationMin)).toISOString(),
      staffIds: ids.sort((a, b) => load(a) - load(b)),
    }));
}

/**
 * Staff who can perform all requested services. A stylist with no service list can do everything.
 * `skills` maps staff id -> service ids they are limited to.
 */
export function qualifiedStaff<T extends { id: string; bookable: boolean; active: boolean }>(
  staff: T[], skills: Map<string, Set<string>>, serviceIds: string[],
): T[] {
  return staff.filter((s) => {
    if (!s.active || !s.bookable) return false;
    const set = skills.get(s.id);
    return !set || set.size === 0 || serviceIds.every((id) => set.has(id));
  });
}

/** Group slots into morning / afternoon / evening for compact pickers. */
export function groupSlots(slots: Slot[]): { label: string; slots: Slot[] }[] {
  const groups = [
    { label: 'Morning', slots: [] as Slot[] },
    { label: 'Afternoon', slots: [] as Slot[] },
    { label: 'Evening', slots: [] as Slot[] },
  ];
  for (const s of slots) {
    const m = hhmmToMinutes(s.time);
    groups[m < 12 * 60 ? 0 : m < 17 * 60 ? 1 : 2].slots.push(s);
  }
  return groups.filter((g) => g.slots.length);
}

/** Snap a requested time to the nearest offered slot (used by the WhatsApp bot when someone asks for "around 5"). */
export function nearestSlots(slots: Slot[], hhmm: string, count = 3): Slot[] {
  const target = hhmmToMinutes(hhmm);
  return [...slots]
    .sort((a, b) => Math.abs(hhmmToMinutes(a.time) - target) - Math.abs(hhmmToMinutes(b.time) - target))
    .slice(0, count)
    .sort((a, b) => hhmmToMinutes(a.time) - hhmmToMinutes(b.time));
}
