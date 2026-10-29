'use client';
// Packages & memberships: the salon's menu of prepaid packages ("6 Facials for ₹9,000") and membership cards
// ("Glow Card: ₹299 a year, 10% off services"). Owners and managers edit; the front desk sells from a client's profile.
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Empty, Notice, Panel, Sheet, TextArea, TextField, cx, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { savePackage, savePlan, setPackageActive, setPlanActive } from '@/actions/packages';
import { money } from '@/lib/billing';
import {
  CARD_VALIDITY, MAX_PACKAGE_ITEMS, PACKAGE_VALIDITY, packageMenuValue, packageSavingPct, pctText, perksText, sessionValues, validityText, VALIDITY_CHOICES,
} from '@/lib/packages';
import type { GstMode, MembershipPlan, Service, ServiceCategory, ServicePackage } from '@/lib/types';

export interface PackagesScreenProps {
  packages: ServicePackage[];
  plans: MembershipPlan[];
  /** Every service (archived ones too, so old packages still show their names). */
  services: Service[];
  categories: ServiceCategory[];
  /** Clients with sessions left / members today, by package / card id. */
  holders: Record<string, number>;
  members: Record<string, number>;
  gstMode: GstMode;
}

export function PackagesScreen({ packages, plans, services, categories, holders, members, gstMode }: PackagesScreenProps) {
  const [editPkg, setEditPkg] = useState<ServicePackage | 'new' | null>(null);
  const [editPlan, setEditPlan] = useState<MembershipPlan | 'new' | null>(null);
  const nameOf = (id: string) => services.find((s) => s.id === id)?.name ?? 'Removed service';
  const onSale = packages.filter((p) => p.active).length;

  return (
    <>
      <Topbar title="Packages & memberships" subtitle={`${onSale} package${onSale === 1 ? '' : 's'} · ${plans.filter((x) => x.active).length} membership card${plans.filter((x) => x.active).length === 1 ? '' : 's'} on sale`}
        actions={<>
          <Button icon="idcard" className="hide-mobile" onClick={() => setEditPlan('new')}>New card</Button>
          <Button variant="primary" icon="plus" onClick={() => setEditPkg('new')}>New package</Button>
        </>} />
      <div className="page page-narrow">
        <Panel flush title={<h2 className="row" style={{ gap: 8 }}><Icon name="box" size={18} className="pkg-title-icon" />Packages</h2>}
          actions={packages.length ? <Button size="sm" icon="plus" onClick={() => setEditPkg('new')}>Add</Button> : undefined}>
          {packages.length ? (
            <ul className="list">
              {packages.map((p) => {
                const value = packageMenuValue(p, services);
                const save = packageSavingPct(p.price, value);
                return (
                  <li key={p.id} className={cx('pm-row', !p.active && 'is-archived')}>
                    <button type="button" className="pm-main" onClick={() => setEditPkg(p)}>
                      <span className="row" style={{ gap: 8, minWidth: 0 }}>
                        <span className="strong truncate">{p.name}</span>
                        {!p.active && <Badge>Off sale</Badge>}
                      </span>
                      <span className="small muted truncate">{p.items.map((i) => `${nameOf(i.service_id)} ×${i.sessions}`).join(' · ')}</span>
                      <span className="tiny muted">
                        Valid {validityText(p.validity_days)}
                        {save > 0 && <> · <span className="success-text strong">save {save}%</span> on {money(value)}</>}
                        {holders[p.id] ? <> · {holders[p.id]} client{holders[p.id] === 1 ? '' : 's'} with sessions left</> : ''}
                      </span>
                    </button>
                    <span className="pm-price num strong">{money(p.price)}</span>
                    <Button size="sm" variant="ghost" icon="chevronRight" aria-label={`Edit ${p.name}`} className="hide-mobile" onClick={() => setEditPkg(p)} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty icon="box" title="Sell visits in advance" action={<Button variant="primary" icon="plus" onClick={() => setEditPkg('new')}>Create a package</Button>}>
              A package is a set of sessions the client pays for once, like “6 Facials for ₹9,000” or a bridal glow pack of clean-ups and facials. The desk ticks off a session on each visit’s bill.
            </Empty>
          )}
        </Panel>

        <Panel flush title={<h2 className="row" style={{ gap: 8 }}><Icon name="idcard" size={18} className="mem-title-icon" />Membership cards</h2>}
          actions={plans.length ? <Button size="sm" icon="plus" onClick={() => setEditPlan('new')}>Add</Button> : undefined}>
          {plans.length ? (
            <ul className="list">
              {plans.map((x) => (
                <li key={x.id} className={cx('pm-row', !x.active && 'is-archived')}>
                  <button type="button" className="pm-main" onClick={() => setEditPlan(x)}>
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="strong truncate">{x.name}</span>
                      {!x.active && <Badge>Off sale</Badge>}
                    </span>
                    <span className="small muted truncate">{perksText(x)}</span>
                    <span className="tiny muted">For {validityText(x.validity_days)}{members[x.id] ? ` · ${members[x.id]} member${members[x.id] === 1 ? '' : 's'} now` : ''}</span>
                  </button>
                  <span className="pm-price num strong">{money(x.fee)}</span>
                  <Button size="sm" variant="ghost" icon="chevronRight" aria-label={`Edit ${x.name}`} className="hide-mobile" onClick={() => setEditPlan(x)} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="idcard" title="Reward regulars with a card" action={<Button icon="plus" onClick={() => setEditPlan('new')}>Create a membership card</Button>}>
              Clients pay a small fee (say ₹299 a year) and get a discount on every bill. Styile applies it at the counter automatically.
            </Empty>
          )}
        </Panel>

        <Notice>
          <strong>GST:</strong> selling a package gives a <strong>package receipt, not a tax invoice</strong> — each visit’s bill shows the service at its session value, paid from the package{gstMode === 'regular' ? ', with GST on that bill' : ''}.
          A membership card’s fee is billed like a service (“Membership card”, SAC 999729){gstMode === 'regular' ? ' with GST' : ''}. Confirm the GST treatment with your CA.
        </Notice>
      </div>

      <PackageSheet pkg={editPkg} services={services} categories={categories} onClose={() => setEditPkg(null)} />
      <PlanSheet plan={editPlan} onClose={() => setEditPlan(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Package editor
// ---------------------------------------------------------------------------
interface Row { key: number; serviceId: string; sessions: number }
let rowKey = 0;

function ValidityPicker({ days, onChange, min, max, choices }: { days: string; onChange: (v: string) => void; min: number; max: number; choices: readonly { days: number; label: string }[] }) {
  const custom = !choices.some((c) => String(c.days) === days);
  return (
    <div className="field">
      <span className="label">Valid for</span>
      <div className="row-wrap" role="group" aria-label="Valid for">
        {choices.map((c) => <button key={c.days} type="button" className="chip chip-sm" aria-pressed={String(c.days) === days} onClick={() => onChange(String(c.days))}>{c.label}</button>)}
        <div className="prefix-input suffix-input pm-days">
          <input className="input input-sm num" inputMode="numeric" value={days} aria-label="Days" aria-invalid={custom && (Number(days) < min || Number(days) > max) || undefined}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
          <span className="small">days</span>
        </div>
      </div>
      <span className="hint">From the day it’s bought. {min} days to 3 years.</span>
    </div>
  );
}

function PackageSheet({ pkg, services, categories, onClose }: { pkg: ServicePackage | 'new' | null; services: Service[]; categories: ServiceCategory[]; onClose: () => void }) {
  const existing = pkg && pkg !== 'new' ? pkg : null;
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [days, setDays] = useState('180');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const live = services.filter((s) => s.active);

  useEffect(() => {
    if (!pkg) return;
    const p = pkg === 'new' ? null : pkg;
    setName(p?.name ?? ''); setPrice(p ? String(p.price) : ''); setDays(String(p?.validity_days ?? 180)); setDescription(p?.description ?? '');
    setRows(p ? p.items.map((i) => ({ key: ++rowKey, serviceId: i.service_id, sessions: i.sessions })) : [{ key: ++rowKey, serviceId: '', sessions: 6 }]);
    setError(null);
  }, [pkg]);

  const priceN = Number(price.replace(/[,\s₹]/g, '')) || 0;
  const chosen = rows.filter((r) => r.serviceId);
  const value = chosen.reduce((s, r) => s + Number(services.find((x) => x.id === r.serviceId)?.price ?? 0) * r.sessions, 0);
  const save = packageSavingPct(priceN, value);
  const perSession = useMemo(() => priceN ? sessionValues(priceN, chosen.map((r) => ({ sessions: r.sessions, menuPrice: Number(services.find((x) => x.id === r.serviceId)?.price ?? 0) }))) : [],
    [priceN, chosen, services]);
  const setRow = (key: number, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // A sensible name while it's still empty: "6 Facials".
  const suggest = () => {
    if (name.trim() || chosen.length !== 1) return;
    const s = services.find((x) => x.id === chosen[0].serviceId);
    if (s) setName(`${chosen[0].sessions} × ${s.name}`);
  };

  const submit = () => start(async () => {
    setError(null);
    const r = await savePackage({
      id: existing?.id, name, description, price: priceN, validityDays: Number(days), active: existing?.active ?? true,
      items: rows.filter((x) => x.serviceId).map((x) => ({ serviceId: x.serviceId, sessions: x.sessions })),
    });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved'); router.refresh(); onClose();
  });
  const toggle = () => startToggle(async () => {
    if (!existing) return;
    const r = await setPackageActive(existing.id, !existing.active);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved'); router.refresh(); onClose();
  });

  return (
    <Sheet open={!!pkg} onClose={onClose} title={existing ? 'Edit package' : 'New package'} width={560}
      footer={<>
        {existing && <Button variant={existing.active ? 'danger' : 'secondary'} loading={toggling} onClick={toggle} style={{ marginRight: 'auto' }}>{existing.active ? 'Take off sale' : 'Put back on sale'}</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit}>{existing ? 'Save package' : 'Add package'}</Button>
      </>}>
      <div className="stack-lg">
        {existing && !existing.active && <Notice tone="warn">Off sale: the desk can’t sell it. Clients who bought it keep their sessions.</Notice>}
        {existing && <p className="small muted">Changes apply to new sales. Clients who already bought it keep what they paid for.</p>}

        <div className="field">
          <span className="label">Services and sessions</span>
          <div className="pm-items">
            {rows.map((r, i) => {
              const svc = services.find((x) => x.id === r.serviceId);
              return (
                <div key={r.key} className="pm-item">
                  <select className="select" value={r.serviceId} aria-label={`Service ${i + 1}`} onChange={(e) => setRow(r.key, { serviceId: e.target.value })} onBlur={suggest}>
                    <option value="">Choose a service…</option>
                    {categories.map((c) => {
                      const list = live.filter((s) => s.category_id === c.id);
                      return list.length ? <optgroup key={c.id} label={c.name}>{list.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</optgroup> : null;
                    })}
                    {live.filter((s) => !s.category_id || !categories.some((c) => c.id === s.category_id)).map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}
                    {svc && !svc.active && <option value={svc.id}>{svc.name} (archived)</option>}
                  </select>
                  <div className="stepper" role="group" aria-label={`Sessions of ${svc?.name ?? `service ${i + 1}`}`}>
                    <button type="button" aria-label="One less" disabled={r.sessions <= 1} onClick={() => setRow(r.key, { sessions: r.sessions - 1 })}><Icon name="minus" size={15} /></button>
                    <span className="num" aria-live="polite">{r.sessions}</span>
                    <button type="button" aria-label="One more" disabled={r.sessions >= 100} onClick={() => setRow(r.key, { sessions: r.sessions + 1 })}><Icon name="plus" size={15} /></button>
                  </div>
                  <Button size="sm" variant="ghost" icon="trash" aria-label="Remove this service" disabled={rows.length === 1} onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} />
                </div>
              );
            })}
          </div>
          {rows.length < MAX_PACKAGE_ITEMS && <div><Button size="sm" icon="plus" onClick={() => setRows((cur) => [...cur, { key: ++rowKey, serviceId: '', sessions: 1 }])}>Add another service</Button></div>}
        </div>

        <TextField label="Package name" value={name} onChange={(e) => setName(e.target.value)} onFocus={suggest} maxLength={60} placeholder="e.g. 6 Facials, Bridal glow pack" />
        <div className="field">
          <label htmlFor="pm-price">Price</label>
          <div className="prefix-input"><span>₹</span>
            <input id="pm-price" className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={value ? String(Math.round(value * 0.85)) : 'e.g. 9000'} />
          </div>
          {value > 0 && (
            <span className="hint num">
              Menu value {money(value)}{priceN > 0 ? (save > 0 ? <> · client saves <span className="success-text strong">{money(value - priceN)} ({save}%)</span></> : priceN > value ? ' · more than the menu price' : ' · no saving') : ''}
            </span>
          )}
        </div>
        {priceN > 0 && chosen.length > 0 && (
          <div className="pkg-summary">
            <div className="tiny muted strong">On each visit’s bill</div>
            {chosen.map((r, k) => (
              <div key={r.key} className="between small"><span className="muted">{services.find((x) => x.id === r.serviceId)?.name}</span><span className="num">{money(perSession[k])} a session</span></div>
            ))}
          </div>
        )}
        <ValidityPicker days={days} onChange={setDays} min={PACKAGE_VALIDITY.min} max={PACKAGE_VALIDITY.max} choices={VALIDITY_CHOICES} />
        <TextArea label="Note for the desk (optional)" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Good for brides — start 2 months before the wedding" />
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Membership card editor
// ---------------------------------------------------------------------------
function PlanSheet({ plan, onClose }: { plan: MembershipPlan | 'new' | null; onClose: () => void }) {
  const existing = plan && plan !== 'new' ? plan : null;
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [days, setDays] = useState('365');
  const [svcPct, setSvcPct] = useState('10');
  const [prodPct, setProdPct] = useState('0');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan) return;
    const x = plan === 'new' ? null : plan;
    setName(x?.name ?? ''); setFee(x ? String(x.fee) : ''); setDays(String(x?.validity_days ?? 365));
    setSvcPct(String(x ? Number(x.service_discount_pct) : 10)); setProdPct(String(x ? Number(x.product_discount_pct) : 0));
    setDescription(x?.description ?? ''); setError(null);
  }, [plan]);

  const s = Number(svcPct) || 0, pr = Number(prodPct) || 0;
  const submit = () => start(async () => {
    setError(null);
    const r = await savePlan({ id: existing?.id, name, description, fee: Number(fee.replace(/[,\s₹]/g, '')), validityDays: Number(days), serviceDiscountPct: s, productDiscountPct: pr, active: existing?.active ?? true });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved'); router.refresh(); onClose();
  });
  const toggle = () => startToggle(async () => {
    if (!existing) return;
    const r = await setPlanActive(existing.id, !existing.active);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved'); router.refresh(); onClose();
  });

  return (
    <Sheet open={!!plan} onClose={onClose} title={existing ? 'Edit membership card' : 'New membership card'} width={500}
      footer={<>
        {existing && <Button variant={existing.active ? 'danger' : 'secondary'} loading={toggling} onClick={toggle} style={{ marginRight: 'auto' }}>{existing.active ? 'Take off sale' : 'Put back on sale'}</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit}>{existing ? 'Save card' : 'Add card'}</Button>
      </>}>
      <div className="stack-lg">
        {existing && <p className="small muted">Changes apply to cards sold from now on. Members keep the discount they bought.</p>}
        <TextField label="Card name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Glow Card" autoFocus={!existing} />
        <div className="field">
          <label htmlFor="pl-fee">Card fee</label>
          <div className="prefix-input"><span>₹</span>
            <input id="pl-fee" className="input num" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="e.g. 299" />
          </div>
          <span className="hint">Billed like a service when the card is sold.</span>
        </div>
        <ValidityPicker days={days} onChange={setDays} min={CARD_VALIDITY.min} max={CARD_VALIDITY.max} choices={[{ days: 180, label: '6 months' }, { days: 365, label: '1 year' }, { days: 730, label: '2 years' }]} />
        <div className="grid-2">
          <PctField id="pl-svc" label="Off services" value={svcPct} onChange={setSvcPct} />
          <PctField id="pl-prod" label="Off products" value={prodPct} onChange={setProdPct} />
        </div>
        {(s > 0 || pr > 0) && (
          <div className="pkg-summary small">
            {s > 0 && <div className="between"><span className="muted">A {money(1000)} service</span><span className="num">{money(Math.round(1000 * (100 - s)) / 100)} for members</span></div>}
            {pr > 0 && <div className="between"><span className="muted">A {money(500)} product</span><span className="num">{money(Math.round(500 * (100 - pr)) / 100)} for members</span></div>}
            <div className="tiny muted">Shown on the bill as “Member {pctText(s || pr)}”. Not on package sessions (already paid for).</div>
          </div>
        )}
        <TextArea label="Note for the desk (optional)" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Offer to clients on their third visit" />
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Sheet>
  );
}

function PctField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const n = Number(value);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="prefix-input suffix-input">
        <input id={id} className="input num" inputMode="decimal" value={value} aria-invalid={n < 0 || n > 50 || undefined} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
        <span>%</span>
      </div>
      <span className={n > 50 ? 'error-text' : 'hint'}>{n > 50 ? 'Up to 50%' : '0 to 50%'}</span>
    </div>
  );
}
