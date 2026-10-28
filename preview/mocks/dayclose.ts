// Preview stand-ins for src/actions/dayclose.ts and src/actions/expenses.ts.
export const handlers: Record<string, (...args: any[]) => any> = {
  closeDay: (i: { countedCash: number }) => {
    const diff = Math.round((i.countedCash - 10380) * 100) / 100;
    return { ok: true, data: { id: 'dc-new', difference: diff, differenceNu: 0 }, message: `27 Oct closed · ${diff === 0 ? 'cash matches' : `₹${Math.abs(diff)} ${diff > 0 ? 'excess' : 'short'}`}` };
  },
  reopenDay: () => ({ ok: true, message: 'Tue, 27 Oct reopened — close it again when you’re done' }),
  saveExpense: (i: { id?: string | null; amount: number; category: string }) => ({ ok: true, data: { id: i.id || 'ex-new' }, message: i.id ? 'Expense updated' : `₹${i.amount} ${i.category.toLowerCase()} added` }),
  deleteExpense: () => ({ ok: true, message: 'Expense deleted' }),
};
