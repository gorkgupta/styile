'use client';
// A UPI QR that pays the salon's own UPI ID. Styile never touches the money: the client's app pays the salon and the
// front desk records the payment as usual.
import { useMemo } from 'react';
import { money } from '@/lib/billing';
import { qrSvgPath } from '@/lib/qr';
import { upiPayUrl } from '@/lib/upi';
import { cx } from './ui';
import { useT } from '@/lib/i18n/react';

export interface UpiQrProps {
  vpa: string;
  name: string;
  amount: number;
  /** Shown in the payer's app, e.g. "Bill GS-01043". */
  note?: string;
  /** Rendered width in px (screen) — print styles may override. */
  size?: number;
  caption?: 'full' | 'short' | 'none';
  /** Add an "open UPI app" button for phones (client view). */
  appLink?: boolean;
  className?: string;
}

export function UpiQr({ vpa, name, amount, note, size = 168, caption = 'full', appLink, className }: UpiQrProps) {
  const t = useT();
  const url = useMemo(() => upiPayUrl({ vpa, name, amount, note }), [vpa, name, amount, note]);
  const qr = useMemo(() => qrSvgPath(url, 2), [url]);
  return (
    <figure className={cx('upi-qr', className)}>
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width={size} height={size} role="img" shapeRendering="crispEdges"
        aria-label={t('upi.aria', { money: money(amount), name })}>
        <rect className="upi-qr-bg" width={qr.size} height={qr.size} />
        <path className="upi-qr-fg" d={qr.path} />
      </svg>
      {caption !== 'none' && (
        <figcaption>
          <span className="strong num">{t('upi.scan', { money: money(amount) })}</span>
          {caption === 'full' && <span className="tiny muted">{t('upi.anyApp', { name })} · <span className="mono">{vpa}</span></span>}
        </figcaption>
      )}
      {appLink && <a className="btn btn-secondary btn-sm upi-qr-app show-mobile" href={url}>{t('upi.payInApp', { money: money(amount) })}</a>}
    </figure>
  );
}
