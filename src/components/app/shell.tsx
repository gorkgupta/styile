'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';
import { Avatar } from '@/components/ui/ui';
import { can, type Permission } from '@/lib/permissions';
import type { MemberRole } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';
import { signOut, switchSalon } from '@/actions/auth';
import { salonUrl } from '@/lib/tenant';

export interface ShellProps {
  salon: { id: string; name: string; slug: string; plan_status: string };
  user: { name: string };
  role: MemberRole;
  memberships: { salon_id: string; name: string; role: MemberRole }[];
  inboxUnread: number;
  queueCount: number;
  isPlatformAdmin: boolean;
  children: ReactNode;
}

type NavItem = { href: string; label: string; icon: IconName; perm: Permission; count?: number; mobile?: boolean };

export function AppShell(props: ShellProps) {
  const path = usePathname();
  const items: NavItem[] = [
    { href: '/app', label: 'Today', icon: 'home', perm: 'viewCalendar', mobile: true },
    { href: '/app/calendar', label: 'Calendar', icon: 'calendar', perm: 'viewCalendar', mobile: true },
    { href: '/app/queue', label: 'Walk-ins', icon: 'queue', perm: 'viewCalendar', count: props.queueCount, mobile: true },
    { href: '/app/pos', label: 'New bill', icon: 'receipt', perm: 'bill', mobile: true },
    { href: '/app/invoices', label: 'Bills', icon: 'wallet', perm: 'bill' },
    { href: '/app/events', label: 'Bridal & events', icon: 'heart', perm: 'events' },
    { href: '/app/close', label: 'Day close', icon: 'lock', perm: 'closeDay' },
    { href: '/app/customers', label: 'Clients', icon: 'users', perm: 'viewClients', mobile: true },
    { href: '/app/inbox', label: 'WhatsApp', icon: 'chat', perm: 'inbox', count: props.inboxUnread },
  ];
  const manage: NavItem[] = [
    { href: '/app/reports', label: 'Reports', icon: 'chart', perm: 'viewReports' },
    { href: '/app/expenses', label: 'Expenses', icon: 'expense', perm: 'addExpense' },
    { href: '/app/services', label: 'Services', icon: 'scissors', perm: 'manageMenu' },
    { href: '/app/packages', label: 'Packages', icon: 'box', perm: 'manageMenu' },
    { href: '/app/staff', label: 'Team', icon: 'user', perm: 'manageStaff' },
    { href: '/app/settings', label: 'Settings', icon: 'settings', perm: 'settings' },
  ];
  const visible = items.filter((i) => can(props.role, i.perm));
  const visibleManage = manage.filter((i) => can(props.role, i.perm));
  const isActive = (href: string) => (href === '/app' ? path === '/app' : path === href || path.startsWith(href + '/'));
  const link = (i: NavItem) => (
    <Link key={i.href} href={i.href} aria-current={isActive(i.href) ? 'page' : undefined}>
      <Icon name={i.icon} size={19} />
      {i.label}
      {!!i.count && <span className="count">{i.count}</span>}
    </Link>
  );
  const mobileItems = visible.filter((i) => i.mobile).slice(0, 5);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>Styile</span>
        </div>
        <div className="salon-switch">
          <Avatar name={props.salon.name} size="sm" />
          <div className="grow">
            {props.memberships.length > 1 ? (
              <form action={switchSalon}>
                <select className="select input-sm" name="salon_id" defaultValue={props.salon.id} aria-label="Switch salon"
                  onChange={(e) => e.currentTarget.form?.requestSubmit()} style={{ border: 0, background: 'transparent', padding: 0, height: 22, fontWeight: 600 }}>
                  {props.memberships.map((m) => <option key={m.salon_id} value={m.salon_id}>{m.name}</option>)}
                </select>
              </form>
            ) : (
              <div className="strong truncate" style={{ fontSize: 14 }}>{props.salon.name}</div>
            )}
            <div className="tiny muted">{ROLE_LABEL[props.role]}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">{visible.map(link)}</nav>
        {visibleManage.length > 0 && (
          <nav className="nav" aria-label="Manage">
            <div className="nav-label">Manage</div>
            {visibleManage.map(link)}
          </nav>
        )}
        <div className="sidebar-foot stack-sm">
          {props.isPlatformAdmin && <Link className="btn btn-ghost btn-sm" href="/admin"><Icon name="shield" size={16} />Platform admin</Link>}
          <Link className="btn btn-ghost btn-sm" href={salonUrl(props.salon.slug) || `/s/${props.salon.slug}`} target="_blank"><Icon name="external" size={16} />Booking page</Link>
          <div className="row" style={{ padding: '8px 8px 0' }}>
            <Avatar name={props.user.name} size="sm" color="#6B3FA0" />
            <span className="small truncate grow">{props.user.name}</span>
            <form action={signOut}><button className="btn btn-ghost btn-sm btn-icon" aria-label="Sign out" title="Sign out"><Icon name="logout" size={16} /></button></form>
          </div>
        </div>
      </aside>
      <div className="main">
        {props.salon.plan_status === 'past_due' && (
          <div className="notice notice-warn" style={{ borderRadius: 0 }}>Your subscription payment is overdue. Bookings keep working; please renew to avoid interruption.</div>
        )}
        {props.children}
      </div>
      <nav className="bottom-nav" aria-label="Main">
        {mobileItems.map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(i.href) ? 'page' : undefined}>
            <Icon name={i.icon} size={21} />{i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Sticky page header: title on the left, actions on the right. */
export function Topbar({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <header className="topbar">
      <div className="row grow" style={{ minWidth: 0 }}>
        {back && <Link href={back} className="btn btn-ghost btn-icon btn-sm" aria-label="Back"><Icon name="chevronLeft" /></Link>}
        <div style={{ minWidth: 0 }}>
          <h1 className="truncate">{title}</h1>
          {subtitle && <div className="small muted truncate">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
