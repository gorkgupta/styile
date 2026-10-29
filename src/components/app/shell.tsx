'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';
import { Avatar, useToast } from '@/components/ui/ui';
import { LanguageSwitch } from '@/components/ui/lang-switch';
import { can, type Permission } from '@/lib/permissions';
import type { MemberRole } from '@/lib/types';
import { setMyLanguage, signOut, switchSalon } from '@/actions/auth';
import { salonUrl } from '@/lib/tenant';
import { useT } from '@/lib/i18n/react';
import type { Locale } from '@/lib/i18n/locales';

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
  const t = useT();
  const toast = useToast();
  const items: NavItem[] = [
    { href: '/app', label: t('nav.today'), icon: 'home', perm: 'viewCalendar', mobile: true },
    { href: '/app/calendar', label: t('nav.calendar'), icon: 'calendar', perm: 'viewCalendar', mobile: true },
    { href: '/app/queue', label: t('nav.queue'), icon: 'queue', perm: 'viewCalendar', count: props.queueCount, mobile: true },
    { href: '/app/pos', label: t('nav.pos'), icon: 'receipt', perm: 'bill', mobile: true },
    { href: '/app/invoices', label: t('nav.bills'), icon: 'wallet', perm: 'bill' },
    { href: '/app/events', label: t('nav.events'), icon: 'heart', perm: 'events' },
    { href: '/app/close', label: t('nav.close'), icon: 'lock', perm: 'closeDay' },
    { href: '/app/customers', label: t('nav.clients'), icon: 'users', perm: 'viewClients', mobile: true },
    { href: '/app/inbox', label: t('nav.whatsapp'), icon: 'chat', perm: 'inbox', count: props.inboxUnread },
  ];
  const manage: NavItem[] = [
    { href: '/app/reports', label: t('nav.reports'), icon: 'chart', perm: 'viewReports' },
    { href: '/app/expenses', label: t('nav.expenses'), icon: 'expense', perm: 'addExpense' },
    { href: '/app/services', label: t('nav.services'), icon: 'scissors', perm: 'manageMenu' },
    { href: '/app/packages', label: t('nav.packages'), icon: 'box', perm: 'manageMenu' },
    { href: '/app/staff', label: t('nav.team'), icon: 'user', perm: 'manageStaff' },
    { href: '/app/settings', label: t('nav.settings'), icon: 'settings', perm: 'settings' },
  ];
  // Saved to the user's profile, then the page renders again in the new language.
  const pickLanguage = async (l: Locale) => {
    const r = await setMyLanguage(l);
    if (!r.ok) toast(t.err(r.error), 'error');
    return r.ok;
  };
  const signOutButton = <form action={signOut}><button className="btn btn-ghost btn-sm btn-icon" aria-label={t('pt.signOut')} title={t('pt.signOut')}><Icon name="logout" size={16} /></button></form>;
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
                <select className="select input-sm" name="salon_id" defaultValue={props.salon.id} aria-label={t('shell.switchSalon')}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()} style={{ border: 0, background: 'transparent', padding: 0, height: 22, fontWeight: 600 }}>
                  {props.memberships.map((m) => <option key={m.salon_id} value={m.salon_id}>{m.name}</option>)}
                </select>
              </form>
            ) : (
              <div className="strong truncate" style={{ fontSize: 14 }}>{props.salon.name}</div>
            )}
            <div className="tiny muted">{t(`role.${props.role}`)}</div>
          </div>
        </div>
        <nav className="nav" aria-label={t('shell.main')}>{visible.map(link)}</nav>
        {visibleManage.length > 0 && (
          <nav className="nav" aria-label={t('nav.manage')}>
            <div className="nav-label">{t('nav.manage')}</div>
            {visibleManage.map(link)}
          </nav>
        )}
        <div className="sidebar-foot stack-sm">
          {props.isPlatformAdmin && <Link className="btn btn-ghost btn-sm" href="/admin"><Icon name="shield" size={16} />{t('shell.platformAdmin')}</Link>}
          <Link className="btn btn-ghost btn-sm" href={salonUrl(props.salon.slug) || `/s/${props.salon.slug}`} target="_blank"><Icon name="external" size={16} />{t('shell.bookingPage')}</Link>
          <LanguageSwitch onPick={pickLanguage} className="sidebar-lang" />
          <div className="row" style={{ padding: '8px 8px 0' }}>
            <Avatar name={props.user.name} size="sm" color="#6B3FA0" />
            <span className="small truncate grow">{props.user.name}</span>
            {signOutButton}
          </div>
        </div>
      </aside>
      <div className="main">
        {props.salon.plan_status === 'past_due' && (
          <div className="notice notice-warn" style={{ borderRadius: 0 }}>{t('shell.pastDue')}</div>
        )}
        {props.children}
        {/* Phones have no sidebar: who is signed in, their language and sign out sit under every page. */}
        <div className="mobile-account show-mobile">
          <Avatar name={props.user.name} size="sm" color="#6B3FA0" />
          <span className="small truncate grow">{props.user.name}</span>
          <LanguageSwitch onPick={pickLanguage} compact />
          {signOutButton}
        </div>
      </div>
      <nav className="bottom-nav" aria-label={t('shell.main')}>
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
  const t = useT();
  return (
    <header className="topbar">
      <div className="row grow" style={{ minWidth: 0 }}>
        {back && <Link href={back} className="btn btn-ghost btn-icon btn-sm" aria-label={t('common.back')}><Icon name="chevronLeft" /></Link>}
        <div style={{ minWidth: 0 }}>
          <h1 className="truncate">{title}</h1>
          {subtitle && <div className="small muted truncate">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
