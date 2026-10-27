'use client';
// A client's coin ledger as a list. Shared by the staff client profile and the client's own portal.
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icons';
import { money } from '@/lib/billing';
import { fmtCoins } from '@/lib/coins';
import { fmtDateYear } from '@/lib/periods';
import { fmtTime } from '@/lib/time';
import type { CoinKind, PayMethod } from '@/lib/types';
import { COIN_KIND_LABEL, METHOD_LABEL } from '@/lib/types';

export interface CoinRow {
  id: string; kind: CoinKind; coins: number; balance_after: number; amount_paid: number | null; method: PayMethod | null;
  reference: string | null; invoice_id: string | null; invoice_no: string | null; note: string | null; created_at: string;
}

const KIND_ICON: Record<CoinKind, IconName> = { load: 'plus', bonus: 'gift', spend: 'receipt', refund: 'receipt', adjust: 'edit' };

/** "+5,500" / "−400" */
export function signedCoins(n: number) {
  return `${n > 0 ? '+' : '−'}${fmtCoins(Math.abs(n))}`;
}

export function CoinHistoryList({ rows, tz, billHref, showReference = true }: {
  rows: CoinRow[]; tz: string;
  /** Link to the bill for spends and refunds, e.g. "/app/invoices/<id>"; omit for no links. */
  billHref?: (invoiceId: string) => string;
  showReference?: boolean;
}) {
  return (
    <ul className="list coin-tx-list">
      {rows.map((t) => {
        const plus = t.coins > 0;
        const bill = t.invoice_id && t.invoice_no
          ? (billHref ? <Link href={billHref(t.invoice_id)} className="num nowrap">Bill {t.invoice_no}</Link> : <span className="num nowrap">Bill {t.invoice_no}</span>)
          : null;
        const detail = t.kind === 'load'
          ? <span className="num">{money(t.amount_paid ?? t.coins)} by {t.method ? METHOD_LABEL[t.method] : 'cash'}{showReference && t.reference ? ` · ${t.reference}` : ''}</span>
          : t.kind === 'spend' || t.kind === 'refund' ? bill
          : null;
        return (
          <li key={t.id} className="coin-tx">
            <span className={`coin-tx-icon is-${plus ? 'in' : 'out'}`} aria-hidden><Icon name={KIND_ICON[t.kind]} size={15} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="strong small">{COIN_KIND_LABEL[t.kind]}</div>
              <div className="tiny muted coin-tx-meta">
                <span className="num nowrap">{fmtDateYear(t.created_at, tz)}, {fmtTime(t.created_at, tz)}</span>
                {detail && <> · {detail}</>}
              </div>
              {t.note && t.kind !== 'bonus' && !(t.kind === 'refund' && bill) && <div className="tiny ink2 coin-tx-note">“{t.note}”</div>}
            </div>
            <div className="right nowrap">
              <div className={`num strong ${plus ? 'success-text' : ''}`}>{signedCoins(t.coins)}</div>
              <div className="tiny muted num">Bal {fmtCoins(t.balance_after)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
