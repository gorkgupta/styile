'use client';
// Coins on the client profile: balance, selling coins at the desk (with a coins receipt — not a tax invoice),
// owner adjustments and the coin history.
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Notice, Panel, Segmented, Sheet, Switch, TextArea, TextField, cx, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { deskMethods, METHOD_ICON, REF_PLACEHOLDER, parseAmount } from './billing-bits';
import { CoinHistoryList, type CoinRow } from './coin-history';
import { adjustCoins, getCoinHistory, loadCoins } from '@/actions/coins';
import { money } from '@/lib/billing';
import { coinsText, fmtCoins, matchesPack, packBonus, packBonusPct } from '@/lib/coins';
import { fmtDateYear } from '@/lib/periods';
import { fmtTime } from '@/lib/time';
import type { CoinPack, PayMethod } from '@/lib/types';
import { METHOD_LABEL } from '@/lib/types';

export interface CoinsPanelProps {
  customer: { id: string; name: string; balance: number };
  /** methods: the salon's payment types (Settings); coins can be bought with any of them except coins. */
  salon: { name: string; enabled: boolean; packs: CoinPack[]; waConnected: boolean; methods?: PayMethod[] };
  /** Most recent ledger rows (newest first). */
  history: CoinRow[];
  /** More rows exist than were loaded. */
  moreHistory?: boolean;
  tz: string;
  canSell: boolean;
  /** Owner/manager: may add a bonus that isn't one of the packs. */
  canBonus: boolean;
  /** Owner: manual adjustments. */
  canAdjust: boolean;
}

const SHOWN = 6;

export function CoinsPanel({ customer, salon, history, moreHistory, tz, canSell, canBonus, canAdjust }: CoinsPanelProps) {
  const [selling, setSelling] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [rows, setRows] = useState<CoinRow[]>(history);
  const [all, setAll] = useState(false);
  const [loadingAll, startAll] = useTransition();
  const toast = useToast();
  useEffect(() => { setRows(history); }, [history]);

  const balance = customer.balance;
  const first = customer.name.split(' ')[0];
  const shown = all ? rows : rows.slice(0, SHOWN);
  const hidden = rows.length - shown.length;

  const showAll = () => startAll(async () => {
    if (moreHistory && !all) {
      const r = await getCoinHistory(customer.id);
      if (!r.ok) return toast(r.error, 'error');
      setRows(r.data!.rows);
    }
    setAll(true);
  });

  return (
    <>
      <Panel flush title={<h2 className="row" style={{ gap: 8 }}><Icon name="coins" size={18} className="coin-title-icon" />Coins</h2>}
        actions={canAdjust && (rows.length > 0 || balance > 0) ? <Button size="sm" variant="ghost" icon="edit" onClick={() => setAdjusting(true)}>Adjust</Button> : undefined}>
        <div className="coin-hero">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="coin-hero-value num">{fmtCoins(balance)}<span> coin{balance === 1 ? '' : 's'}</span></div>
            <div className="small muted">{balance > 0 ? `${first} can use ${money(balance)} on bills here` : salon.enabled ? 'No coins yet' : 'Coin sales are turned off in Settings'}</div>
          </div>
          {canSell && salon.enabled && <Button variant="primary" icon="plus" onClick={() => setSelling(true)}>Sell coins</Button>}
        </div>
        {rows.length ? (
          <>
            <CoinHistoryList rows={shown} tz={tz} billHref={(id) => `/app/invoices/${id}`} />
            {(hidden > 0 || (moreHistory && !all)) && (
              <div className="panel-foot coin-more">
                <Button size="sm" variant="ghost" loading={loadingAll} onClick={showAll}>Show all coin history</Button>
              </div>
            )}
          </>
        ) : salon.enabled && canSell ? (
          <p className="panel-body small muted">
            Sell a coin pack and {first} pays for future visits from the balance
            {salon.packs.length ? ` — e.g. pay ${money(salon.packs[Math.min(1, salon.packs.length - 1)].pay)}, get ${coinsText(salon.packs[Math.min(1, salon.packs.length - 1)].coins)}.` : '.'}
          </p>
        ) : null}
      </Panel>

      {canSell && (
        <SellCoinsSheet open={selling} onClose={() => setSelling(false)} customer={customer} salon={salon} canBonus={canBonus} tz={tz} />
      )}
      {canAdjust && <AdjustCoinsDialog open={adjusting} onClose={() => setAdjusting(false)} customer={customer} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sell coins
// ---------------------------------------------------------------------------
const loadMethods = (enabled?: PayMethod[]) => deskMethods(enabled).filter((m) => m !== 'wallet' && m !== 'other');
interface Receipt { pay: number; coins: number; bonus: number; balance: number; method: PayMethod; reference: string; at: string; sent: boolean }

export function SellCoinsSheet({ open, onClose, customer, salon, canBonus, tz }: {
  open: boolean; onClose: () => void; customer: CoinsPanelProps['customer']; salon: CoinsPanelProps['salon']; canBonus: boolean; tz: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const packs = useMemo(() => [...salon.packs].sort((a, b) => a.pay - b.pay), [salon.packs]);
  const [pick, setPick] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState('');
  const [extra, setExtra] = useState('');
  const [method, setMethod] = useState<PayMethod>('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [sendWa, setSendWa] = useState(salon.waConnected);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    if (!open) return;
    setPick(packs.length ? Math.min(1, packs.length - 1) : 'custom');
    setCustom(''); setExtra(''); setMethod('upi'); setReference(''); setNote(''); setError(null); setReceipt(null);
    setSendWa(salon.waConnected);
  }, [open, packs.length, salon.waConnected]);

  const pack = pick === 'custom' ? null : packs[pick] ?? null;
  const pay = pack ? pack.pay : Math.round(parseAmount(custom));
  const extraCoins = canBonus ? Math.round(parseAmount(extra)) : 0;
  const coins = (pack ? pack.coins : pay) + extraCoins;
  const bonus = coins - pay;
  const after = customer.balance + coins;
  const first = customer.name.split(' ')[0];

  const submit = () => start(async () => {
    setError(null);
    if (!pay) return setError(pick === 'custom' ? 'Enter the amount the client is paying.' : 'Pick a coin pack.');
    if (bonus > pay) return setError('The bonus can’t be more than the amount paid.');
    const r = await loadCoins({ customerId: customer.id, pay, coins, method, reference: method === 'cash' ? null : reference, note, sendOnWhatsApp: sendWa && salon.waConnected });
    if (!r.ok) return setError(r.error);
    setReceipt({ pay, coins: r.data!.coinsAdded, bonus: r.data!.bonus, balance: r.data!.balance, method, reference: method === 'cash' ? '' : reference.trim(), at: new Date().toISOString(), sent: r.data!.sentOnWhatsApp });
    router.refresh();
  });

  if (receipt) {
    return (
      <Sheet open={open} onClose={onClose} title="Coins receipt" width={480}
        footer={<><Button icon="printer" onClick={() => window.print()}>Print</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
        <div className="stack-lg coin-receipt">
          <div className="coin-receipt-head">
            <span className="coin-receipt-icon"><Icon name="check" size={22} /></span>
            <div>
              <div className="strong">{coinsText(receipt.coins)} added for {customer.name}</div>
              <div className="small muted">{receipt.sent ? `Receipt sent to ${first} on WhatsApp` : 'Saved in their coin history'}</div>
            </div>
          </div>
          <dl className="coin-receipt-lines">
            <div><dt>Salon</dt><dd>{salon.name}</dd></div>
            <div><dt>Client</dt><dd>{customer.name}</dd></div>
            <div><dt>Date</dt><dd className="num">{fmtDateYear(receipt.at, tz)}, {fmtTime(receipt.at, tz)}</dd></div>
            <div><dt>Amount received</dt><dd className="num strong">{money(receipt.pay)}</dd></div>
            <div><dt>Paid by</dt><dd>{METHOD_LABEL[receipt.method]}{receipt.reference ? <span className="muted"> · {receipt.reference}</span> : null}</dd></div>
            <div><dt>Coins added</dt><dd className="num strong">{fmtCoins(receipt.coins)}{receipt.bonus > 0 ? <span className="muted"> (incl. {fmtCoins(receipt.bonus)} bonus)</span> : null}</dd></div>
            <div className="coin-receipt-total"><dt>New balance</dt><dd className="num">{coinsText(receipt.balance)}</dd></div>
          </dl>
          <p className="tiny muted">Not a tax invoice. Prepaid coins for use at {salon.name} only (1 coin = ₹1). GST is charged on the bill when the coins are used.</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} width={520}
      title={<div><h2>Sell coins</h2><div className="small muted">to {customer.name} · balance {coinsText(customer.balance)}</div></div>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} disabled={!pay} onClick={submit}>{pay ? `Receive ${money(pay)}` : 'Receive payment'}</Button></>}>
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="field">
          <span className="label">Coin pack</span>
          <div className="coin-packs" role="group" aria-label="Coin pack">
            {packs.map((p, i) => (
              <button key={p.pay} type="button" className={cx('coin-pack', pick === i && 'is-on')} aria-pressed={pick === i} onClick={() => setPick(i)}>
                <span className="coin-pack-pay num">Pay {money(p.pay)}</span>
                <span className="coin-pack-get num"><Icon name="arrowRight" size={14} />{coinsText(p.coins)}</span>
                {packBonus(p) > 0 && <span className="coin-pack-bonus num">+{fmtCoins(packBonus(p))} bonus · {packBonusPct(p)}%</span>}
              </button>
            ))}
            <button type="button" className={cx('coin-pack', 'coin-pack-custom', pick === 'custom' && 'is-on')} aria-pressed={pick === 'custom'} onClick={() => setPick('custom')}>
              <span className="coin-pack-pay">Custom amount</span>
              <span className="coin-pack-get">No bonus · 1 coin = ₹1</span>
            </button>
          </div>
        </div>

        {pick === 'custom' && (
          <div className="field">
            <label htmlFor="coin-amt">Amount received</label>
            <div className="prefix-input"><span>₹</span>
              <input id="coin-amt" className="input num" inputMode="numeric" placeholder="e.g. 1500" value={custom} autoFocus
                onChange={(e) => setCustom(e.target.value.replace(/[^\d,]/g, ''))} />
            </div>
          </div>
        )}
        {canBonus && (
          <div className="field">
            <label htmlFor="coin-extra">Extra bonus coins <span className="muted">(owner/manager)</span></label>
            <input id="coin-extra" className="input num" inputMode="numeric" placeholder="0" value={extra}
              onChange={(e) => setExtra(e.target.value.replace(/[^\d,]/g, ''))} />
            <span className="hint">On top of {pack ? 'the pack' : 'the amount'}. Front desk can only sell packs or amounts without a bonus.</span>
          </div>
        )}

        <div className="field">
          <span className="label">Paid by</span>
          <div className="row-wrap" role="group" aria-label="Paid by">
            {loadMethods(salon.methods).map((m) => (
              <button key={m} type="button" className="chip chip-sm" aria-pressed={method === m} onClick={() => setMethod(m)}>
                <Icon name={METHOD_ICON[m]} size={14} />{METHOD_LABEL[m]}
              </button>
            ))}
          </div>
          {method !== 'cash' && (
            <input className="input" placeholder={REF_PLACEHOLDER[method]} value={reference} maxLength={120}
              onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />
          )}
        </div>
        <TextField label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Diwali offer" hint={`${first} can see this in their coin history.`} />

        <div className="coin-summary" aria-live="polite">
          <div><span className="muted">Client pays</span><strong className="num">{pay ? money(pay) : '—'}</strong></div>
          <div><span className="muted">Coins added</span><strong className="num">{pay ? fmtCoins(coins) : '—'}{bonus > 0 && <span className="coin-summary-bonus"> incl. {fmtCoins(bonus)} bonus</span>}</strong></div>
          <div><span className="muted">New balance</span><strong className="num">{pay ? coinsText(after) : coinsText(customer.balance)}</strong></div>
        </div>
        {bonus > 0 && !matchesPack(packs, pay, coins) && !canBonus && <Notice tone="warn">Only an owner or manager can give a custom bonus.</Notice>}

        <Switch checked={sendWa && salon.waConnected} disabled={!salon.waConnected} onChange={setSendWa}
          label={<span className="small">Send coins receipt on WhatsApp{!salon.waConnected && <span className="muted"> · connect WhatsApp in Settings</span>}</span>} />
        <p className="tiny muted">This is a coins receipt, not a tax invoice: GST is charged on the bill when coins are used. Confirm the GST treatment with your CA.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Owner adjustment
// ---------------------------------------------------------------------------
export function AdjustCoinsDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: CoinsPanelProps['customer'] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [dir, setDir] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setDir('add'); setAmount(''); setNote(''); setError(null); } }, [open]);

  const n = parseAmount(amount);
  const after = customer.balance + (dir === 'add' ? n : -n);
  const save = () => start(async () => {
    setError(null);
    if (!n) return setError('Enter the coins to add or remove.');
    if (after < 0) return setError(`${customer.name.split(' ')[0]} has only ${coinsText(customer.balance)}.`);
    if (!note.trim()) return setError('Add a note saying why — it stays in the coin history.');
    const r = await adjustCoins(customer.id, dir === 'add' ? n : -n, note);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Balance adjusted'); onClose(); router.refresh();
  });

  return (
    <Dialog open={open} onClose={onClose} title="Adjust coins"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={save}>{n ? `${dir === 'add' ? 'Add' : 'Remove'} ${coinsText(n)}` : 'Save adjustment'}</Button></>}>
      <p className="small ink2">For corrections and goodwill coins. {customer.name} has <strong className="num">{coinsText(customer.balance)}</strong>.</p>
      <Segmented label="Add or remove" value={dir} onChange={setDir} options={[{ value: 'add', label: 'Add coins' }, { value: 'remove', label: 'Remove coins' }]} />
      <div className="field">
        <label htmlFor="adj-amt">Coins</label>
        <input id="adj-amt" className="input num" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        {n > 0 && <span className={after < 0 ? 'error-text' : 'hint num'}>{after < 0 ? `Only ${coinsText(customer.balance)} to remove` : `New balance: ${coinsText(after)}`}</span>}
      </div>
      <TextArea label="Reason" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Sold the wrong pack on 12 Oct" hint="Required. The client can see this in their coin history." />
      {error && <Notice tone="error">{error}</Notice>}
    </Dialog>
  );
}
