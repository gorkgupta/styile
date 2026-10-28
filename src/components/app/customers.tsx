'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Empty, Notice, Panel, SearchInput, SelectField, Sheet, Switch, TextArea, TextField, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { saveCustomer } from '@/actions/customers';
import { money } from '@/lib/billing';
import { fmtCoins } from '@/lib/coins';
import { formatPhone } from '@/lib/phone';
import { PhoneInput } from '@/components/ui/phone-input';
import { daysBetween } from '@/lib/periods';
import { fmtDayMonthYear, localDate } from '@/lib/time';
import { useT } from '@/lib/i18n/react';
import { coinsT, relativeAgoT } from '@/lib/i18n/format';
import type { Customer } from '@/lib/types';

export type ClientRow = Pick<Customer, 'id' | 'name' | 'phone' | 'email' | 'gender' | 'birthday' | 'tags' | 'visit_count' | 'total_spent' | 'last_visit_at' | 'created_at'>
  & { coin_balance?: number };

type Filter = 'all' | 'vip' | 'new' | 'lapsed' | 'birthday';
type Sort = 'recent' | 'name' | 'spent' | 'visits';

const FILTERS: { value: Filter; label: 'inv.all' | 'cl.vip' | 'cl.newMonth' | 'cl.lapsed' | 'cl.birthdays' }[] = [
  { value: 'all', label: 'inv.all' },
  { value: 'vip', label: 'cl.vip' },
  { value: 'new', label: 'cl.newMonth' },
  { value: 'lapsed', label: 'cl.lapsed' },
  { value: 'birthday', label: 'cl.birthdays' },
];

export const isVip = (tags: string[]) => tags.some((t) => t.toLowerCase() === 'vip');

/** A client's coin balance, shown only when they have some. */
export function CoinChip({ balance }: { balance?: number | null }) {
  const t = useT();
  const n = Number(balance ?? 0);
  if (n <= 0) return null;
  return <span className="coin-chip num" title={t('cl.toSpend', { coins: coinsT(t, n) })}><Icon name="coins" size={12} />{fmtCoins(n)}<span className="sr-only"> {t('method.wallet')}</span></span>;
}

/** Client tags as badges; VIP stands out in marigold. */
export function TagBadges({ tags }: { tags: string[] }) {
  return <>{tags.map((t) => <span key={t} className={`badge ${t.toLowerCase() === 'vip' ? 'badge-marigold' : 'badge-plum'}`}>{t}</span>)}</>;
}

export interface CustomersProps {
  clients: ClientRow[];
  today: string;
  tz: string;
  /** More clients exist than were loaded; searching hits the server. */
  truncated?: boolean;
  initialQuery?: string;
}

export function CustomersScreen({ clients, today, tz, truncated, initialQuery }: CustomersProps) {
  const router = useRouter();
  const t = useT();
  const [q, setQ] = useState(initialQuery ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [adding, setAdding] = useState(false);
  const month = today.slice(0, 7);

  // With a very large client list, search on the server once typing pauses.
  useEffect(() => {
    if (!truncated) return;
    const timer = setTimeout(() => {
      if ((initialQuery ?? '') !== q.trim()) router.replace(q.trim() ? `/app/customers?q=${encodeURIComponent(q.trim())}` : '/app/customers');
    }, 400);
    return () => clearTimeout(timer);
  }, [q, truncated, initialQuery, router]);

  const tests: Record<Filter, (c: ClientRow) => boolean> = useMemo(() => ({
    all: () => true,
    vip: (c) => isVip(c.tags),
    new: (c) => localDate(new Date(c.created_at), tz).slice(0, 7) === month,
    lapsed: (c) => !!c.last_visit_at && daysBetween(localDate(new Date(c.last_visit_at), tz), today) >= 60,
    birthday: (c) => !!c.birthday && c.birthday.slice(5, 7) === month.slice(5, 7),
  }), [month, today, tz]);

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f.value] = clients.filter(tests[f.value]).length;
    return out;
  }, [clients, tests]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const list = clients.filter((c) => tests[filter](c) && (!needle
      || c.name.toLowerCase().includes(needle) || (digits.length >= 3 && c.phone.includes(digits))
      || c.tags.some((t) => t.toLowerCase() === needle)));
    const by: Record<Sort, (a: ClientRow, b: ClientRow) => number> = {
      recent: (a, b) => (b.last_visit_at ?? '').localeCompare(a.last_visit_at ?? '') || b.created_at.localeCompare(a.created_at),
      name: (a, b) => a.name.localeCompare(b.name),
      spent: (a, b) => Number(b.total_spent) - Number(a.total_spent),
      visits: (a, b) => b.visit_count - a.visit_count,
    };
    // Birthdays sort by day of month — the list you'd call through.
    if (filter === 'birthday') return list.sort((a, b) => (a.birthday ?? '').slice(8).localeCompare((b.birthday ?? '').slice(8)));
    return list.sort(by[sort]);
  }, [clients, tests, filter, q, sort]);

  const bday = (b: string) => fmtDayMonthYear(Number(b.slice(0, 4)), Number(b.slice(5, 7)), Number(b.slice(8, 10)), t.locale, { year: false });

  return (
    <>
      <Topbar title={t('nav.clients')} subtitle={t('cl.count', { count: clients.length, n: `${clients.length.toLocaleString('en-IN')}${truncated ? '+' : ''}` })}
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)} aria-label={t('cl.add')}><span className="hide-mobile">{t('cl.add')}</span></Button>} />
      <div className="page">
        <Panel flush title={
          <div className="filters grow client-filters">
            <div className="filters-search filters-search-left"><SearchInput value={q} onChange={setQ} placeholder={t('cl.namePhone')} /></div>
            <div className="filters-scroll">
              <div className="row" role="group" aria-label={t('cl.quickFilters')}>
                {FILTERS.map((f) => (
                  <button key={f.value} type="button" className="chip chip-sm nowrap" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                    {f.value === 'birthday' && <Icon name="gift" size={14} />}{t(f.label)}<span className="chip-count num">{counts[f.value]}</span>
                  </button>
                ))}
              </div>
            </div>
            <select className="select input-sm sort-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('cl.sort')} disabled={filter === 'birthday'}>
              <option value="recent">{t('cl.lastVisit')}</option>
              <option value="name">{t('cl.nameAz')}</option>
              <option value="spent">{t('cl.totalSpent')}</option>
              <option value="visits">{t('cl.mostVisits')}</option>
            </select>
          </div>
        }>
          {shown.length ? (
            <>
              <div className="table-wrap hide-mobile">
                <table className="table">
                  <thead>
                    <tr><th>{t('common.name')}</th><th>{t('cl.phone')}</th><th className="right">{t('cl.visits')}</th><th className="right">{t('cl.totalSpent')}</th><th>{filter === 'birthday' ? t('cl.birthday') : t('cl.lastVisit')}</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => router.push(`/app/customers/${c.id}`)}>
                        <td>
                          <div className="row">
                            <Avatar name={c.name} size="sm" color={isVip(c.tags) ? 'var(--marigold-700)' : undefined} />
                            <Link href={`/app/customers/${c.id}`} className="strong client-link" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                            <TagBadges tags={c.tags} />
                            <CoinChip balance={c.coin_balance} />
                          </div>
                        </td>
                        <td className="num ink2 nowrap">{formatPhone(c.phone)}</td>
                        <td className="right num">{c.visit_count}</td>
                        <td className="right num strong">{money(Math.round(Number(c.total_spent)))}</td>
                        <td className="ink2 nowrap">{filter === 'birthday' && c.birthday ? <span className="row"><Icon name="gift" size={15} />{bday(c.birthday)}</span> : relativeAgoT(t, c.last_visit_at, today, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list show-mobile">
                {shown.map((c) => (
                  <li key={c.id} style={{ padding: 0 }}>
                    <Link href={`/app/customers/${c.id}`} className="list-link">
                      <Avatar name={c.name} color={isVip(c.tags) ? 'var(--marigold-700)' : undefined} />
                      <div className="grow">
                        <div className="row"><span className="strong truncate">{c.name}</span><TagBadges tags={c.tags.slice(0, 1)} /><CoinChip balance={c.coin_balance} /></div>
                        <div className="tiny muted num truncate">{formatPhone(c.phone)} · {filter === 'birthday' && c.birthday ? t('cl.birthdayOn', { date: bday(c.birthday) }) : relativeAgoT(t, c.last_visit_at, today, tz)}</div>
                      </div>
                      <div className="right">
                        <div className="num strong small">{money(Math.round(Number(c.total_spent)))}</div>
                        <div className="tiny muted num">{t('common.visits', { count: c.visit_count })}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : clients.length ? (
            <Empty icon="search" title={t('cl.noMatch')} action={<div className="row"><Button size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('inv.clearFilters')}</Button><Button size="sm" icon="plus" onClick={() => setAdding(true)}>{t('cl.add')}</Button></div>}>
              {q ? t('cl.nobodyCalled', { q }) : t('cl.noFit')}
            </Empty>
          ) : (
            <Empty icon="users" title={t('cl.first')} action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{t('cl.add')}</Button>}>
              {t('cl.firstBody')}
            </Empty>
          )}
        </Panel>
      </div>
      <ClientFormSheet open={adding} onClose={() => setAdding(false)} onSaved={(id) => router.push(`/app/customers/${id}`)} />
    </>
  );
}

export type ClientFormValue = Pick<Customer, 'name' | 'phone' | 'email' | 'gender' | 'birthday' | 'notes' | 'tags' | 'marketing_opt_in'> & { id?: string };

const SUGGESTED_TAGS = ['VIP', 'Bridal', 'Regular', 'Sensitive skin'];

/** Add or edit a client. */
export function ClientFormSheet({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: ClientFormValue | null; onSaved?: (id: string) => void }) {
  const toast = useToast();
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [v, setV] = useState<ClientFormValue>(blank());
  const [tagDraft, setTagDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setV(initial ? { ...initial, phone: initial.phone ? formatPhone(initial.phone) : '' } : blank());
      setTagDraft(''); setError(null);
    }
  }, [open, initial]);

  const set = <K extends keyof ClientFormValue>(k: K, val: ClientFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const addTag = (raw: string) => { const tag = raw.trim(); if (tag && !v.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) set('tags', [...v.tags, tag]); setTagDraft(''); };

  const submit = () => start(async () => {
    setError(null);
    const tags = tagDraft.trim() ? [...v.tags, tagDraft.trim()] : v.tags;
    const r = await saveCustomer({ ...v, tags, id: initial?.id ?? null });
    if (!r.ok) return setError(t.err(r.error));
    toast(initial?.id ? t('err.clientSaved') : t('err.clientAdded'));
    onClose();
    if (onSaved && r.data) onSaved(r.data.id); else router.refresh();
  });

  return (
    <Sheet open={open} onClose={onClose} title={initial?.id ? t('cl.edit') : t('cl.add')} width={500}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={pending} onClick={submit}>{initial?.id ? t('cl.save') : t('cl.add')}</Button></>}>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid-2">
          <TextField label={t('common.name')} value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus={!initial?.id} autoComplete="off" />
          <PhoneInput id="cl-phone" label={t('common.mobileNumber')} value={v.phone} onChange={(p) => set('phone', p)} />
        </div>
        <div className="grid-2">
          <SelectField label={t('cl.gender')} value={v.gender ?? ''} onChange={(e) => set('gender', (e.target.value || null) as ClientFormValue['gender'])}>
            <option value="">{t('cl.notSet')}</option><option value="female">{t('cl.female')}</option><option value="male">{t('cl.male')}</option><option value="other">{t('common.other')}</option>
          </SelectField>
          <TextField label={t('cl.birthday')} type="date" value={v.birthday ?? ''} onChange={(e) => set('birthday', e.target.value || null)} hint={t('cl.birthdayHint')} />
        </div>
        <TextField label={t('cl.email')} type="email" placeholder={t('cl.optional')} value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        <div className="field">
          <label htmlFor="cl-tag">{t('cl.tags')}</label>
          <div className="row-wrap">
            {v.tags.map((tag) => (
              <button key={tag} type="button" className="chip chip-sm is-on" onClick={() => set('tags', v.tags.filter((x) => x !== tag))} aria-label={t('cl.removeTag', { tag })}>
                {tag}<Icon name="x" size={13} />
              </button>
            ))}
            {SUGGESTED_TAGS.filter((tag) => !v.tags.some((x) => x.toLowerCase() === tag.toLowerCase())).map((tag) => (
              <button key={tag} type="button" className="chip chip-sm" onClick={() => addTag(tag)}><Icon name="plus" size={13} />{tag}</button>
            ))}
          </div>
          <input id="cl-tag" className="input input-sm" placeholder={t('cl.tagPh')} value={tagDraft} onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); } }} />
        </div>
        <TextArea label={t('common.notes')} rows={3} placeholder={t('cl.notesPh')} value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        <Switch checked={v.marketing_opt_in} onChange={(x) => set('marketing_opt_in', x)} label={<span className="small">{t('cl.optIn')}</span>} />
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function blank(): ClientFormValue {
  return { name: '', phone: '', email: null, gender: null, birthday: null, notes: null, tags: [], marketing_opt_in: true };
}
