'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Avatar, Button, SearchInput, TextField, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { searchClients, quickCreateClient, type ClientLite } from '@/actions/appointments';
import { money } from '@/lib/billing';
import { formatPhone } from '@/lib/phone';
import type { Service, ServiceCategory, Staff } from '@/lib/types';

/** Find an existing client by name or phone, or add a new one inline. */
export function ClientPicker({ value, onChange }: { value: ClientLite | null; onChange: (c: ClientLite | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientLite[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
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
          <div className="small muted">{formatPhone(value.phone)} · {value.visit_count ? `${value.visit_count} visits` : 'New client'}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }

  if (adding) {
    return (
      <div className="panel stack" style={{ padding: 14 }}>
        <div className="between"><h3>New client</h3><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Search instead</Button></div>
        <div className="grid-2">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <TextField label="Mobile number" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} error={error} />
        </div>
        <Button variant="primary" loading={pending} onClick={() => start(async () => {
          const r = await quickCreateClient({ name, phone });
          if (!r.ok) { setError(r.error); return; }
          if (r.message) toast(r.message);
          onChange(r.data!);
        })}>Add client</Button>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <SearchInput value={query} onChange={setQuery} placeholder="Search by name or phone" />
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
        {!results.length && <li className="small muted">{query ? 'No client matches. Add them as new.' : 'Start typing to find a client.'}</li>}
      </ul>
      <Button icon="plus" onClick={() => {
        setAdding(true);
        const digits = query.replace(/\D/g, '');
        if (digits.length >= 6) setPhone(query); else setName(query);
      }}>New client</Button>
    </div>
  );
}

/** Service menu as tappable chips, grouped by category. */
export function ServicePicker({ services, categories, value, onChange }: {
  services: Service[]; categories: ServiceCategory[]; value: string[]; onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const filtered = services.filter((s) => s.active && s.name.toLowerCase().includes(q.toLowerCase()));
    const byCat = categories.map((c) => ({ id: c.id, name: c.name, items: filtered.filter((s) => s.category_id === c.id) }));
    const other = filtered.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id));
    if (other.length) byCat.push({ id: 'other', name: 'Other', items: other });
    return byCat.filter((g) => g.items.length);
  }, [services, categories, q]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const chosen = value.map((id) => services.find((s) => s.id === id)).filter(Boolean) as Service[];

  return (
    <div className="stack-sm">
      {services.length > 8 && <SearchInput value={q} onChange={setQ} placeholder="Find a service" />}
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
          {chosen.length} service{chosen.length > 1 ? 's' : ''} · {chosen.reduce((s, x) => s + x.duration_min, 0)} min · {money(chosen.reduce((s, x) => s + Number(x.price), 0))}
        </div>
      )}
    </div>
  );
}

export function StaffSelect({ staff, value, onChange, allowAny, label = 'Stylist' }: {
  staff: Staff[]; value: string; onChange: (id: string) => void; allowAny?: boolean; label?: string;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row-wrap">
        {allowAny && <button type="button" className="chip" aria-pressed={value === ''} onClick={() => onChange('')}>Anyone free</button>}
        {staff.filter((s) => s.active).map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={value === s.id} onClick={() => onChange(s.id)}>
            <span className="dot" style={{ background: s.color }} />{s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
