'use client';
// A client's coin ledger as a list. Shared by the staff client profile and the client's own portal.
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icons';
import { money } from '@/lib/billing';
import { fmtCoins } from '@/lib/coins';
import { fmtDateYear } from '@/lib/periods';
import { fmtTime } from '@/lib/time';
import type { CoinKind, PayMethod } from '@/lib/types';
import { useT } from '@/lib/i18n/react';

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
  const t = useT();
  return (
    <ul className="list coin-tx-list">
      {rows.map((r) => {
        const plus = r.coins > 0;
        const bill = r.invoice_id && r.invoice_no
          ? (billHref ? <Link href={billHref(r.invoice_id)} className="num nowrap">{t('common.billNo', { no: r.invoice_no })}</Link> : <span className="num nowrap">{t('common.billNo', { no: r.invoice_no })}</span>)
          : null;
        const detail = r.kind === 'load'
          ? <span className="num">{t('coins.paidBy', { money: money(r.amount_paid ?? r.coins), method: t(`method.${r.method ?? 'cash'}`) })}{showReference && r.reference ? ` · ${r.reference}` : ''}</span>
          : r.kind === 'spend' || r.kind === 'refund' ? bill
          : null;
        return (
          <li key={r.id} className="coin-tx">
            <span className={`coin-tx-icon is-${plus ? 'in' : 'out'}`} aria-hidden><Icon name={KIND_ICON[r.kind]} size={15} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="strong small">{t(`coinKind.${r.kind}`)}</div>
              <div className="tiny muted coin-tx-meta">
                <span className="num nowrap">{fmtDateYear(r.created_at, tz, t.locale)}, {fmtTime(r.created_at, tz)}</span>
                {detail && <> · {detail}</>}
              </div>
              {r.note && r.kind !== 'bonus' && !(r.kind === 'refund' && bill) && <div className="tiny ink2 coin-tx-note">“{r.note}”</div>}
            </div>
            <div className="right nowrap">
              <div className={`num strong ${plus ? 'success-text' : ''}`}>{signedCoins(r.coins)}</div>
              <div className="tiny muted num">{t('coins.bal', { n: fmtCoins(r.balance_after) })}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
