'use client';
// The client's copy of an advance receipt (linked from WhatsApp). Not a tax invoice.
import Link from 'next/link';
import { Button } from '@/components/ui/ui';
import { PortalHeader } from './portal';
import { AdvanceReceipt, type ReceiptSalon } from '@/components/app/events';
import type { AdvancePayment, SalonEvent } from '@/lib/types';

export interface AdvanceReceiptViewProps {
  advance: AdvancePayment;
  salon: ReceiptSalon & { timezone: string };
  customer: { name: string; phone: string };
  event: Pick<SalonEvent, 'title' | 'event_at' | 'event_type'> | null;
  phone?: string;
  base: string;
}

export function AdvanceReceiptView({ advance, salon, customer, event, phone, base }: AdvanceReceiptViewProps) {
  return (
    <div className="pt">
      <div className="no-print"><PortalHeader phone={phone} base={base} salonName={salon.name} /></div>
      <main className="pt-wrap pt-main">
        <div className="between no-print">
          <Link href={`${base}/me`} className="small">← Your bookings</Link>
          <Button size="sm" icon="printer" onClick={() => window.print()}>Print or save</Button>
        </div>
        <div className="panel pt-receipt">
          <AdvanceReceipt advance={advance} salon={salon} customer={customer} event={event} tz={salon.timezone} />
        </div>
      </main>
    </div>
  );
}
