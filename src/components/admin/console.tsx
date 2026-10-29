'use client';
import { rootDomain, salonAddress, salonUrl } from '@/lib/tenant';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Dialog, Empty, Notice, Panel, SearchInput, Segmented, SelectField, Sheet, Stat, TextField, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { connectWhatsApp, disconnectWhatsApp, setSalonPlan } from '@/actions/admin';
import { money } from '@/lib/billing';
import { PLAN_LABEL, PLAN_STATUS_LABEL, PLANS, monthlyRevenue, planById } from '@/lib/plans';
import { fmtDateShort, localDate } from '@/lib/time';
import { GST_MODE_LABEL } from '@/lib/gst';
import type { GstMode, Salon } from '@/lib/types';

const TZ = 'Asia/Kolkata';

export interface AdminSalonRow {
  id: string; name: string; slug: string; city: string | null;
  plan: Salon['plan']; status: Salon['plan_status']; trialEndsAt: string | null;
  ownerEmail: string | null; ownerName: string | null;
  staffCount: number; bookings30d: number; whatsapp30d: number;
  wa: { phoneNumberId: string; businessAccountId: string; displayNumber: string } | null;
  bookingEnabled: boolean; createdAt: string;
  /** Set by the salon owner: which bill they issue (Bill / Bill of Supply / Tax Invoice). */
  gstMode: GstMode; gstin: string | null;
}

export interface AdminConsoleProps { salons: AdminSalonRow[]; nowIso: string; adminName: string; hasSalon: boolean }

type Tone = 'neutral' | 'peacock' | 'marigold' | 'success' | 'danger' | 'plum' | 'outline';
const STATUS_TONE: Record<Salon['plan_status'], Tone> = { trialing: 'marigold', active: 'success', past_due: 'danger', suspended: 'danger', cancelled: 'neutral' };
const PLAN_TONE: Record<Salon['plan'], Tone> = { trial: 'outline', starter: 'neutral', growth: 'peacock', pro: 'plum' };
const GST_TONE: Record<GstMode, Tone> = { unregistered: 'outline', composition: 'marigold', regular: 'peacock' };

type Filter = 'all' | 'trialing' | 'active' | 'attention';

function daysLeft(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86400000);
}

export function AdminConsole(p: AdminConsoleProps) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const now = new Date(p.nowIso).getTime();

  const kpi = useMemo(() => {
    const by = (s: Salon['plan_status']) => p.salons.filter((x) => x.status === s).length;
    const endingSoon = p.salons.filter((s) => {
      if (s.status !== 'trialing') return false;
      const d = daysLeft(s.trialEndsAt, now);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    const mrr = p.salons.reduce((sum, s) => sum + monthlyRevenue({ plan: s.plan, plan_status: s.status }), 0);
    const wa = p.salons.filter((s) => s.wa).length;
    return { trialing: by('trialing'), active: by('active'), pastDue: by('past_due'), suspended: by('suspended'), cancelled: by('cancelled'), endingSoon, mrr, wa };
  }, [p.salons, now]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return p.salons.filter((s) => {
      if (filter === 'trialing' && s.status !== 'trialing') return false;
      if (filter === 'active' && s.status !== 'active') return false;
      if (filter === 'attention' && !['past_due', 'suspended'].includes(s.status)) {
        const d = daysLeft(s.trialEndsAt, now);
        if (!(s.status === 'trialing' && d !== null && d <= 7)) return false;
      }
      if (!needle) return true;
      return [s.name, s.slug, s.city, s.ownerEmail, s.ownerName].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [p.salons, q, filter, now]);

  const open = p.salons.find((s) => s.id === openId) ?? null;

  return (
    <div className="adm">
      <header className="adm-head">
        <div className="adm-wrap between">
          <div className="row" style={{ gap: 10 }}>
            <span className="brand-mark">S</span>
            <span className="strong" style={{ fontSize: 17 }}>Styile</span>
            <span className="hide-mobile"><Badge tone="plum">Platform admin</Badge></span>
          </div>
          <div className="row">
            <span className="small muted hide-mobile">{p.adminName}</span>
            {p.hasSalon && <Link href="/app" className="btn btn-secondary btn-sm"><Icon name="chevronLeft" size={16} />Salon app</Link>}
          </div>
        </div>
      </header>

      <main className="adm-wrap adm-main">
        <div>
          <h1>Salons</h1>
          <p className="muted small">{p.salons.length} salon{p.salons.length === 1 ? '' : 's'} on Styile. Plans, trials and WhatsApp numbers are managed here.</p>
        </div>

        <div className="stats">
          <Stat label="Paying salons" value={kpi.active} sub={`${kpi.trialing} on trial · ${kpi.pastDue} payment due`} />
          <Stat label="Trials ending in 7 days" value={kpi.endingSoon} sub={kpi.endingSoon ? 'Follow up before they lapse' : 'Nothing due this week'} />
          <Stat label="Estimated MRR" value={money(kpi.mrr)} sub="Active plans, before GST" />
          <Stat label="WhatsApp connected" value={kpi.wa} sub={`of ${p.salons.length} salons`} />
        </div>

        <Panel flush title={
          <div className="adm-toolbar">
            <div className="adm-search"><SearchInput value={q} onChange={setQ} placeholder="Search name, link, city or owner email" /></div>
            <Segmented label="Filter salons" value={filter} onChange={setFilter} options={[
              { value: 'all', label: 'All' }, { value: 'trialing', label: 'Trials' }, { value: 'active', label: 'Paying' }, { value: 'attention', label: 'Needs attention' },
            ]} />
          </div>
        }>
          {rows.length ? (
            <div className="table-wrap">
              <table className="table adm-table">
                <thead>
                  <tr>
                    <th>Salon</th><th>Owner</th><th>Plan</th><th>GST</th><th className="right">Staff</th><th className="right">Bookings (30 days)</th><th>WhatsApp</th><th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const d = daysLeft(s.trialEndsAt, now);
                    const share = s.bookings30d ? Math.round((s.whatsapp30d / s.bookings30d) * 100) : 0;
                    return (
                      <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)} tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(s.id); }}>
                        <td>
                          <div className="strong">{s.name}</div>
                          <div className="tiny muted">{salonAddress(s.slug)}{s.city ? ` · ${s.city}` : ''}</div>
                        </td>
                        <td>
                          <div className="small truncate" style={{ maxWidth: 220 }}>{s.ownerEmail ?? '—'}</div>
                          {s.ownerName && <div className="tiny muted">{s.ownerName}</div>}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <Badge tone={PLAN_TONE[s.plan]}>{PLAN_LABEL[s.plan]}</Badge>
                            <Badge tone={STATUS_TONE[s.status]}>{PLAN_STATUS_LABEL[s.status]}</Badge>
                          </div>
                          {s.status === 'trialing' && d !== null && (
                            <div className={d <= 3 ? 'tiny strong' : 'tiny muted'} style={d <= 3 ? { color: 'var(--danger)' } : undefined}>
                              {d < 0 ? 'Trial ended' : d === 0 ? 'Ends today' : `${d} day${d === 1 ? '' : 's'} left`}
                            </div>
                          )}
                        </td>
                        <td><Badge tone={GST_TONE[s.gstMode]}>{GST_MODE_LABEL[s.gstMode]}</Badge></td>
                        <td className="right num">{s.staffCount}</td>
                        <td className="right">
                          <div className="num strong">{s.bookings30d}</div>
                          <div className="adm-share" title={`${share}% booked on WhatsApp`}>
                            <span className="bar"><span style={{ width: `${share}%`, background: 'var(--success)' }} /></span>
                            <span className="tiny muted num">{share}% WA</span>
                          </div>
                        </td>
                        <td>{s.wa ? <span className="row small" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--success)' }} />{s.wa.displayNumber}</span> : <span className="small muted">Not connected</span>}</td>
                        <td className="small muted nowrap">{fmtDateShort(localDate(new Date(s.createdAt), TZ))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="store" title={q ? 'No salon matches' : 'No salons here'}>{q ? 'Try a salon name, its booking link, city or the owner’s email.' : 'Change the filter to see other salons.'}</Empty>
          )}
        </Panel>
      </main>

      <SalonSheet salon={open} nowIso={p.nowIso} onClose={() => setOpenId(null)} />
    </div>
  );
}

function SalonSheet({ salon, nowIso, onClose }: { salon: AdminSalonRow | null; nowIso: string; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [plan, setPlan] = useState<Salon['plan']>('trial');
  const [status, setStatus] = useState<Salon['plan_status']>('trialing');
  const [trialEnd, setTrialEnd] = useState('');
  const [planError, setPlanError] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [wa, setWa] = useState({ phoneNumberId: '', businessAccountId: '', displayNumber: '', accessToken: '' });
  const [waError, setWaError] = useState<string | null>(null);
  const [savingWa, setSavingWa] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    if (!salon) return;
    setPlan(salon.plan); setStatus(salon.status);
    setTrialEnd(salon.trialEndsAt ? localDate(new Date(salon.trialEndsAt), TZ) : '');
    setWa({ phoneNumberId: salon.wa?.phoneNumberId ?? '', businessAccountId: salon.wa?.businessAccountId ?? '', displayNumber: salon.wa?.displayNumber ?? '', accessToken: '' });
    setPlanError(null); setWaError(null);
  }, [salon]);

  if (!salon) return null;
  const price = planById(plan)?.priceMonthly;

  async function savePlan() {
    if (!salon) return;
    setSavingPlan(true); setPlanError(null);
    const r = await setSalonPlan(salon.id, plan, status, trialEnd || null);
    setSavingPlan(false);
    if (!r.ok) { setPlanError(r.error); return; }
    toast(r.message ?? 'Plan updated');
    router.refresh();
  }

  async function saveWa() {
    if (!salon) return;
    setSavingWa(true); setWaError(null);
    const r = await connectWhatsApp(salon.id, wa);
    setSavingWa(false);
    if (!r.ok) { setWaError(r.error); return; }
    toast(r.message ?? 'WhatsApp connected');
    setWa((x) => ({ ...x, accessToken: '' }));
    router.refresh();
  }

  const today = localDate(new Date(nowIso), TZ);

  return (
    <>
      <Sheet open={!!salon} onClose={onClose} width={560} title={
        <div style={{ minWidth: 0 }}>
          <h2 className="truncate">{salon.name}</h2>
          <div className="small muted truncate">{salonAddress(salon.slug)}{salon.ownerEmail ? ` · ${salon.ownerEmail}` : ''}</div>
        </div>
      }>
        <div className="stack-lg">
          <div className="adm-facts">
            <div><span className="tiny muted">Staff</span><span className="strong num">{salon.staffCount}</span></div>
            <div><span className="tiny muted">Bookings, 30 days</span><span className="strong num">{salon.bookings30d}</span></div>
            <div><span className="tiny muted">From WhatsApp</span><span className="strong num">{salon.whatsapp30d}</span></div>
            <div><span className="tiny muted">Joined</span><span className="strong">{fmtDateShort(localDate(new Date(salon.createdAt), TZ))}</span></div>
          </div>
          <p className="small ink2">
            <span className="muted">GST: </span><span className="strong">{GST_MODE_LABEL[salon.gstMode]}</span>
            {salon.gstMode !== 'unregistered' && salon.gstin ? <> · <span className="mono">{salon.gstin}</span></> : null}
            <span className="muted"> · set by the salon owner in Settings</span>
          </p>
          <div className="row-wrap">
            <a className="btn btn-secondary btn-sm" href={rootDomain() ? salonUrl(salon.slug) : `/s/${salon.slug}`} target="_blank" rel="noreferrer"><Icon name="external" size={16} />Open salon site</a>
            {!salon.bookingEnabled && <Badge tone="marigold">Online booking switched off by salon</Badge>}
          </div>

          <section className="stack">
            <h3>Subscription</h3>
            <div className="grid-2">
              <SelectField label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as Salon['plan'])}
                hint={price ? `${money(price)} a month + GST` : 'Free while trialling'}>
                <option value="trial">Free trial</option>
                {PLANS.map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.priceMonthly)}</option>)}
              </SelectField>
              <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as Salon['plan_status'])}
                hint={status === 'suspended' ? 'Staff can’t use the app; booking page is hidden.' : status === 'past_due' ? 'Shows a renew banner in the app.' : undefined}>
                {(Object.keys(PLAN_STATUS_LABEL) as Salon['plan_status'][]).map((k) => <option key={k} value={k}>{PLAN_STATUS_LABEL[k]}</option>)}
              </SelectField>
            </div>
            <div className="grid-2">
              <TextField label="Trial ends on" type="date" value={trialEnd} min={today} onChange={(e) => setTrialEnd(e.target.value)} hint="End of this day, India time. Leave empty for none." />
              <div className="field">
                <span className="label">Quick extend</span>
                <div className="row-wrap">
                  {[7, 14, 30].map((n) => (
                    <Button key={n} size="sm" onClick={() => {
                      const base = trialEnd && trialEnd > today ? trialEnd : today;
                      const [y, m, d] = base.split('-').map(Number);
                      const t = new Date(Date.UTC(y, m - 1, d + n));
                      setTrialEnd(t.toISOString().slice(0, 10));
                      if (plan === 'trial') setStatus('trialing');
                    }}>+{n} days</Button>
                  ))}
                </div>
              </div>
            </div>
            {planError && <Notice tone="error">{planError}</Notice>}
            <div><Button variant="primary" loading={savingPlan} onClick={savePlan}>Save plan</Button></div>
          </section>

          <hr className="divider" />

          <section className="stack">
            <div className="between">
              <h3>WhatsApp number</h3>
              {salon.wa ? <Badge tone="success" dot="var(--success)">Connected</Badge> : <Badge>Not connected</Badge>}
            </div>
            <p className="small muted">
              Add the salon’s number to Styile’s WhatsApp Business app in Meta first, then paste its IDs here. Messages to that number reach this salon’s assistant and inbox.
            </p>
            <TextField label="Phone number ID" value={wa.phoneNumberId} inputMode="numeric" onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value.trim() })}
              hint="Meta Business Manager › WhatsApp Manager › Phone numbers › select the number. Or developers.facebook.com › your app › WhatsApp › API setup, under the “From” number." />
            <TextField label="WhatsApp Business Account ID (WABA ID)" value={wa.businessAccountId} inputMode="numeric" onChange={(e) => setWa({ ...wa, businessAccountId: e.target.value.trim() })}
              hint="Shown at the top of WhatsApp Manager › Overview, and on the same API setup page. Business settings › Accounts › WhatsApp accounts also lists it." />
            <TextField label="Number clients see" value={wa.displayNumber} placeholder="+91 98450 12345" onChange={(e) => setWa({ ...wa, displayNumber: e.target.value })}
              hint="Shown to the salon in Settings and on their booking page." />
            <TextField label="Access token (optional)" type="password" autoComplete="off" value={wa.accessToken} onChange={(e) => setWa({ ...wa, accessToken: e.target.value })}
              placeholder={salon.wa ? 'Leave empty to keep using the platform token' : 'Leave empty to use the platform token'}
              hint="Only for a salon using its own Meta app: a permanent system-user token with whatsapp_business_messaging. Stored server-side only (salon_secrets) and never shown again." />
            {waError && <Notice tone="error">{waError}</Notice>}
            <div className="row-wrap">
              <Button variant="primary" icon="whatsapp" loading={savingWa} onClick={saveWa}>{salon.wa ? 'Update connection' : 'Connect WhatsApp'}</Button>
              {salon.wa && <Button variant="danger" onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>}
            </div>
          </section>
        </div>
      </Sheet>
      <Dialog open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Disconnect WhatsApp?"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>Keep connected</Button>
          <Button variant="danger" onClick={async () => {
            const r = await disconnectWhatsApp(salon.id);
            setConfirmDisconnect(false);
            if (!r.ok) { toast(r.error, 'error'); return; }
            toast(r.message ?? 'WhatsApp disconnected');
            router.refresh();
          }}>Disconnect</Button>
        </>}>
        <p className="muted">{salon.name} will stop receiving WhatsApp messages and the assistant will stop replying. Confirmations and reminders won’t be sent. You can reconnect any time.</p>
      </Dialog>
    </>
  );
}
