import { ananyaCoinHistory } from '../coins-data';
// Preview stand-ins for src/actions/billing.ts and src/actions/customers.ts.
export const handlers: Record<string, (...args: any[]) => any> = {
  createInvoice: (i: { sendOnWhatsApp?: boolean; customerId: string | null }) => ({
    ok: true, data: { id: 'inv-1043', invoiceNo: 'GS-01043' },
    message: `Bill GS-01043 saved${i.sendOnWhatsApp && i.customerId ? ' and sent on WhatsApp' : ''}`,
  }),
  addPayment: () => ({ ok: true, message: 'Payment recorded' }),
  voidInvoice: () => ({ ok: true, message: 'Bill cancelled' }),
  resendInvoice: () => ({ ok: true, message: 'Bill sent on WhatsApp' }),
  saveCustomer: (i: { id?: string | null }) => ({ ok: true, data: { id: i.id || 'cu-1' }, message: i.id ? 'Client saved' : 'Client added' }),
  saveCustomerNotes: () => ({ ok: true, message: 'Notes saved' }),
  // coins
  loadCoins: (i: { pay: number; coins?: number | null; sendOnWhatsApp?: boolean }) => {
    const coins = i.coins ?? i.pay;
    return { ok: true, data: { balance: 1250 + coins, coinsAdded: coins, bonus: coins - i.pay, sentOnWhatsApp: i.sendOnWhatsApp !== false }, message: `${coins} coins added` };
  },
  adjustCoins: (_id: string, coins: number) => ({ ok: true, data: { balance: 1250 + coins }, message: `${coins > 0 ? 'Added' : 'Removed'} ${Math.abs(coins)} coins` }),
  getCoinHistory: () => ({ ok: true, data: { balance: 1250, rows: ananyaCoinHistory } }),
  deleteCustomer: () => ({ ok: false, error: 'This client has 6 appointments and 4 bills, so they can’t be deleted — their history is needed for your records and GST. You can edit their details instead.' }),
};
