'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Avatar, Button, SearchInput, TextField, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { PhoneInput } from '@/components/ui/phone-input';
import { searchClients, quickCreateClient, type ClientLite } from '@/actions/appointments';
import { money } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import type { Service, ServiceCategory, Staff } from '@/lib/types';
import { useT } from '@/lib/i18n/react';
import { fmtDurationT } from '@/lib/i18n/core';

/** Find an existing client by name or phone, or add a new one inline. */
export function ClientPicker({ value, onChange }: { value: ClientLite | null; onChange: (c: ClientLite | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientLite[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = useT();
  const toast = useToast();

  useEffect(() => {
    if (value) return;
    const t = setTimeout(() => {
      searchClients(query).then((r) => r.ok && setResults(r.data ?? []));
    }, 200);
    return () => clearTimeout(t);
  }, [query, value]);

  if (value) {
    return (
      <div className="row panel" style={{ padding: '10px 12px' }}>
        <Avatar name={value.name} />
        <div className="grow">
          <div className="strong">{value.name}</div>
          <div className="small muted">{formatPhone(value.phone)} · {value.visit_count ? t('common.visits', { count: value.visit_count }) : t('cl.new')}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>{t('common.change')}</Button>
      </div>
    );
  }

  if (adding) {
    return (
      <div className="panel stack" style={{ padding: 14 }}>
        <div className="between"><h3>{t('cl.newClient')}</h3><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('cl.searchInstead')}</Button></div>
        <div className="grid-2">
          <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <PhoneInput label={t('common.mobileNumber')} value={phone} onChange={(v) => setPhone(v)} error={error} />
        </div>
        <Button variant="primary" loading={pending} onClick={() => start(async () => {
          const r = await quickCreateClient({ name, phone });
          if (!r.ok) { setError(t.err(r.error)); return; }
          if (r.message) toast(t.err(r.message));
          onChange(r.data!);
        })}>{t('cl.add')}</Button>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <SearchInput value={query} onChange={setQuery} placeholder={t('cl.searchPh')} />
      <ul className="list panel" style={{ maxHeight: 240, overflowY: 'auto' }}>
        {results.map((c) => (
          <li key={c.id} style={{ padding: 0 }}>
            <button type="button" className="row" onClick={() => onChange(c)}
              style={{ width: '100%', padding: '10px 14px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <Avatar name={c.name} size="sm" />
              <span className="grow truncate">{c.name}</span>
              <span className="small muted num">{formatPhone(c.phone)}</span>
            </button>
          </li>
        ))}
        {!results.length && <li className="small muted">{query ? t('cl.noMatchAdd') : t('cl.startTyping')}</li>}
      </ul>
      <Button icon="plus" onClick={() => {
        setAdding(true);
        const digits = query.replace(/\D/g, '');
        if (digits.length >= 6) setPhone(query); else setName(query);
      }}>{t('cl.newClient')}</Button>
    </div>
  );
}

/** Service menu as tappable chips, grouped by category. */
export function ServicePicker({ services, categories, value, onChange }: {
  services: Service[]; categories: ServiceCategory[]; value: string[]; onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const t = useT();
  const groups = useMemo(() => {
    const filtered = services.filter((s) => s.active && s.name.toLowerCase().includes(q.toLowerCase()));
    const byCat = categories.map((c) => ({ id: c.id, name: c.name, items: filtered.filter((s) => s.category_id === c.id) }));
    const other = filtered.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id));
    if (other.length) byCat.push({ id: 'other', name: t('common.other'), items: other });
    return byCat.filter((g) => g.items.length);
  }, [services, categories, q, t]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const chosen = value.map((id) => services.find((s) => s.id === id)).filter(Boolean) as Service[];

  return (
    <div className="stack-sm">
      {services.length > 8 && <SearchInput value={q} onChange={setQ} placeholder={t('appt.findService')} />}
      {groups.map((g) => (
        <div key={g.id} className="stack-sm">
          <div className="tiny muted">{g.name}</div>
          <div className="row-wrap">
            {g.items.map((s) => (
              <button key={s.id} type="button" className="chip" aria-pressed={value.includes(s.id)} onClick={() => toggle(s.id)}>
                {value.includes(s.id) && <Icon name="check" size={15} />}
                {s.name}
                <span style={{ opacity: 0.7 }} className="num">{money(s.price)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {chosen.length > 0 && (
        <div className="small ink2 num">
          {t('common.services', { count: chosen.length })} · {fmtDurationT(t, chosen.reduce((s, x) => s + x.duration_min, 0))} · {money(chosen.reduce((s, x) => s + Number(x.price), 0))}
        </div>
      )}
    </div>
  );
}

export function StaffSelect({ staff, value, onChange, allowAny, label }: {
  staff: Staff[]; value: string; onChange: (id: string) => void; allowAny?: boolean; label?: string;
}) {
  const t = useT();
  return (
    <div className="field">
      <span className="label">{label ?? t('appt.stylist')}</span>
      <div className="row-wrap">
        {allowAny && <button type="button" className="chip" aria-pressed={value === ''} onClick={() => onChange('')}>{t('appt.anyoneFree')}</button>}
        {staff.filter((s) => s.active).map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={value === s.id} onClick={() => onChange(s.id)}>
            <span className="dot" style={{ background: s.color }} />{s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
