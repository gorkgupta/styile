import type { ReactNode } from 'react';
import { TodayView } from '../../src/components/app/today';
import { CalendarBoard } from '../../src/components/app/calendar';
import { QueueBoard } from '../../src/components/app/queue';
import { appointments, branch, menu, NOW_ISO, salon, TODAY } from '../data';

export const screens: Record<string, { title: string; render: () => ReactNode }> = {
  '/app': {
    title: 'Today',
    render: () => (
      <TodayView salon={{ id: salon.id, name: salon.name, slug: salon.slug, waConnected: true, gstin: salon.gstin }} userName="Asha" today={TODAY}
        nowIso={NOW_ISO} appointments={appointments} revenueToday={8450} needsAttention={1} teamSize={4} menu={menu} canBill isOwner welcome={false} />
    ),
  },
  '/app/calendar': {
    title: 'Calendar',
    render: () => <CalendarBoard salonId={salon.id} date={TODAY} today={TODAY} nowIso={NOW_ISO} branchHours={branch.business_hours} appointments={appointments} menu={menu} canBill />,
  },
  '/app/queue': {
    title: 'Walk-ins',
    render: () => <QueueBoard salonId={salon.id} today={TODAY} nowIso={NOW_ISO} appointments={appointments} menu={menu} canBill />,
  },
};
