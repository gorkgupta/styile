'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Empty, Notice, Panel, SearchInput, SelectField, Sheet, Switch, TextArea, TextField, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { saveCustomer } from '@/actions/customers';
import { money } from '@/lib/billing';
import { coinsText, fmtCoins } from '@/lib/coins';
import { formatPhone } from '@/lib/phone';
import { daysBetween, relativeAgo } from '@/lib/periods';
import { localDate } from '@/lib/time';
import type { Customer } from '@/lib/types';

export type ClientRow = Pick<Customer, 'id' | 'name' | 'phone' | 'email' | 'gender' | 'birthday' | 'tags' | 'visit_count' | 'total_spent' | 'last_visit_at' | 'created_at'>
  & { coin_balance?: number };

type Filter = 'all' | 'vip' | 'new' | 'lapsed' | 'birthday';
type Sort = 'recent' | 'name' | 'spent' | 'visits';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'vip', label: 'VIP' },
  { value: 'new', label: 'New this month' },
  { value: 'lapsed', label: 'Not seen in 60+ days' },
  { value: 'birthday', label: 'Birthdays this month' },
];

export const isVip = (tags: string[]) => tags.some((t) => t.toLowerCase() === 'vip');

/** A client's coin balance, shown only when they have some. */
export function CoinChip({ balance }: { balance?: number | null }) {
  const n = Number(balance ?? 0);
  if (n <= 0) return null;
  return <span className="coin-chip num" title={`${coinsText(n)} to spend here`}><Icon name="coins" size={12} />{fmtCoins(n)}<span className="sr-only"> coins</span></span>;
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
  const [q, setQ] = useState(initialQuery ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [adding, setAdding] = useState(false);
  const month = today.slice(0, 7);

  // With a very large client list, search on the server once typing pauses.
  useEffect(() => {
    if (!truncated) return;
    const t = setTimeout(() => {
      if ((initialQuery ?? '') !== q.trim()) router.replace(q.trim() ? `/app/customers?q=${encodeURIComponent(q.trim())}` : '/app/customers');
    }, 400);
    return () => clearTimeout(t);
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

  const bday = (b: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${b}T00:00:00Z`));

  return (
    <>
      <Topbar title="Clients" subtitle={`${clients.length.toLocaleString('en-IN')}${truncated ? '+' : ''} client${clients.length === 1 ? '' : 's'}`}
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}><span className="hide-mobile">Add client</span></Button>} />
      <div className="page">
        <Panel flush title={
          <div className="filters grow client-filters">
            <div className="filters-search filters-search-left"><SearchInput value={q} onChange={setQ} placeholder="Name or phone" /></div>
            <div className="filters-scroll">
              <div className="row" role="group" aria-label="Quick filters">
                {FILTERS.map((f) => (
                  <button key={f.value} type="button" className="chip chip-sm nowrap" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                    {f.value === 'birthday' && <Icon name="gift" size={14} />}{f.label}<span className="chip-count num">{counts[f.value]}</span>
                  </button>
                ))}
              </div>
            </div>
            <select className="select input-sm sort-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort clients" disabled={filter === 'birthday'}>
              <option value="recent">Last visit</option>
              <option value="name">Name A–Z</option>
              <option value="spent">Total spent</option>
              <option value="visits">Most visits</option>
            </select>
          </div>
        }>
          {shown.length ? (
            <>
              <div className="table-wrap hide-mobile">
                <table className="table">
                  <thead>
                    <tr><th>Name</th><th>Phone</th><th className="right">Visits</th><th className="right">Total spent</th><th>{filter === 'birthday' ? 'Birthday' : 'Last visit'}</th></tr>
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
                        <td className="ink2 nowrap">{filter === 'birthday' && c.birthday ? <span className="row"><Icon name="gift" size={15} />{bday(c.birthday)}</span> : relativeAgo(c.last_visit_at, today, tz)}</td>
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
                        <div className="tiny muted num truncate">{formatPhone(c.phone)} · {filter === 'birthday' && c.birthday ? `Birthday ${bday(c.birthday)}` : relativeAgo(c.last_visit_at, today, tz)}</div>
                      </div>
                      <div className="right">
                        <div className="num strong small">{money(Math.round(Number(c.total_spent)))}</div>
                        <div className="tiny muted num">{c.visit_count} visit{c.visit_count === 1 ? '' : 's'}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : clients.length ? (
            <Empty icon="search" title="No clients match" action={<div className="row"><Button size="sm" onClick={() => { setQ(''); setFilter('all'); }}>Clear filters</Button><Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add client</Button></div>}>
              {q ? `Nobody called “${q}” yet.` : 'No one fits this filter right now.'}
            </Empty>
          ) : (
            <Empty icon="users" title="Add your first client" action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add client</Button>}>
              Clients are also added automatically when they book on WhatsApp or your booking page.
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
  const [pending, start] = useTransition();
  const [v, setV] = useState<ClientFormValue>(blank());
  const [tagDraft, setTagDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setV(initial ? { ...initial, phone: initial.phone ? formatPhone(initial.phone).replace(/^\+91 /, '') : '' } : blank());
      setTagDraft(''); setError(null);
    }
  }, [open, initial]);

  const set = <K extends keyof ClientFormValue>(k: K, val: ClientFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const addTag = (t: string) => { const tag = t.trim(); if (tag && !v.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) set('tags', [...v.tags, tag]); setTagDraft(''); };

  const submit = () => start(async () => {
    setError(null);
    const tags = tagDraft.trim() ? [...v.tags, tagDraft.trim()] : v.tags;
    const r = await saveCustomer({ ...v, tags, id: initial?.id ?? null });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Client saved');
    onClose();
    if (onSaved && r.data) onSaved(r.data.id); else router.refresh();
  });

  return (
    <Sheet open={open} onClose={onClose} title={initial?.id ? 'Edit client' : 'Add client'} width={500}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={submit}>{initial?.id ? 'Save client' : 'Add client'}</Button></>}>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid-2">
          <TextField label="Name" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus={!initial?.id} autoComplete="off" />
          <div className="field">
            <label htmlFor="cl-phone">Mobile number</label>
            <div className="prefix-input"><span>+91</span><input id="cl-phone" className="input num" inputMode="tel" placeholder="98765 43210" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          </div>
        </div>
        <div className="grid-2">
          <SelectField label="Gender" value={v.gender ?? ''} onChange={(e) => set('gender', (e.target.value || null) as ClientFormValue['gender'])}>
            <option value="">Not set</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
          </SelectField>
          <TextField label="Birthday" type="date" value={v.birthday ?? ''} onChange={(e) => set('birthday', e.target.value || null)} hint="For birthday offers" />
        </div>
        <TextField label="Email" type="email" placeholder="Optional" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        <div className="field">
          <label htmlFor="cl-tag">Tags</label>
          <div className="row-wrap">
            {v.tags.map((t) => (
              <button key={t} type="button" className="chip chip-sm is-on" onClick={() => set('tags', v.tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
                {t}<Icon name="x" size={13} />
              </button>
            ))}
            {SUGGESTED_TAGS.filter((t) => !v.tags.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => (
              <button key={t} type="button" className="chip chip-sm" onClick={() => addTag(t)}><Icon name="plus" size={13} />{t}</button>
            ))}
          </div>
          <input id="cl-tag" className="input input-sm" placeholder="Type a tag and press Enter" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); } }} />
        </div>
        <TextArea label="Notes" rows={3} placeholder="Colour formula, allergies, preferred stylist" value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        <Switch checked={v.marketing_opt_in} onChange={(x) => set('marketing_opt_in', x)} label={<span className="small">Send offers and birthday wishes on WhatsApp</span>} />
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function blank(): ClientFormValue {
  return { name: '', phone: '', email: null, gender: null, birthday: null, notes: null, tags: [], marketing_opt_in: true };
}
