import type { MemberRole } from './types';

// What each salon role can do in the app. The database enforces the same rules with RLS;
// this only decides what to show.
const RULES = {
  viewCalendar: ['owner', 'manager', 'receptionist', 'stylist'],
  editAppointments: ['owner', 'manager', 'receptionist', 'stylist'],
  bill: ['owner', 'manager', 'receptionist'],
  voidBill: ['owner', 'manager'],
  sellCoins: ['owner', 'manager', 'receptionist'],
  giveCoinBonus: ['owner', 'manager'],   // a bonus that isn't one of the salon's coin packs
  adjustCoins: ['owner'],
  viewClients: ['owner', 'manager', 'receptionist', 'stylist'],
  deleteClients: ['owner', 'manager'],
  manageMenu: ['owner', 'manager'],
  manageStaff: ['owner', 'manager'],
  manageTeamAccess: ['owner'],
  viewReports: ['owner', 'manager'],
  inbox: ['owner', 'manager', 'receptionist'],
  settings: ['owner'],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof RULES;

export function can(role: MemberRole | null | undefined, permission: Permission): boolean {
  return !!role && (RULES[permission] as readonly MemberRole[]).includes(role);
}
