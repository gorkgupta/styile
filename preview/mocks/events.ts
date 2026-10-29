// Preview stand-ins for src/actions/events.ts.
import type { AdvancePayment } from '../../src/lib/types';

export const handlers: Record<string, (...args: any[]) => any> = {
  createEvent: () => ({ ok: true, data: { id: 'ev-1', advanceId: 'ad-9' }, message: 'Event booked · advance receipt AR-00038 · receipt sent on WhatsApp' }),
  updateEventDetails: () => ({ ok: true, message: 'Event saved' }),
  cancelEvent: () => ({ ok: true, message: 'Event cancelled. Any advance is kept until you record a refund.' }),
  recordAdvance: (i: { amount: number; method: AdvancePayment['method']; reference?: string | null; customerId: string; eventId?: string | null }) => {
    const advance: AdvancePayment = {
      id: 'ad-9', salon_id: 'salon-1', customer_id: i.customerId, event_id: i.eventId ?? null, receipt_no: 'AR-00038', amount: i.amount, method: i.method,
      reference: i.reference || null, note: null, received_at: '2026-10-27T06:20:00.000Z', received_by: 'u-kavya', applied_amount: 0,
      refunded_at: null, refund_amount: null, refund_method: null, refund_reason: null,
    };
    return { ok: true, data: { advance }, message: 'Advance received · receipt AR-00038 · receipt sent on WhatsApp' };
  },
  refundAdvance: () => ({ ok: true, message: 'Refund recorded — it shows as handed back on today’s day close' }),
  resendAdvanceReceipt: () => ({ ok: true, message: 'Receipt sent on WhatsApp' }),
};
