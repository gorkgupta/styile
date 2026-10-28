'use client';
// Add / edit an expense. Used by the Expenses page and the Day close page.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Notice, Segmented, SelectField, Sheet, TextField, useToast } from '@/components/ui/ui';
import { deleteExpense, saveExpense } from '@/actions/expenses';
import { parseAmount } from './billing-bits';
import { EXPENSE_CATEGORIES, PAID_FROM, PAID_FROM_HINT, PAID_FROM_LABEL, type ExpenseCategory, type ExpenseRow, type PaidFrom } from '@/lib/dayclose';
import { fmtDateShort } from '@/lib/time';

export type { ExpenseRow };

export interface ExpenseSheetProps {
  open: boolean;
  onClose: () => void;
  /** Editing this expense; null/undefined = adding a new one. */
  expense?: ExpenseRow | null;
  defaultDate: string;
  today: string;
  /** Earliest date allowed (the front desk can only add today's and yesterday's). */
  minDate?: string;
  staff: { id: string; name: string }[];
  canDelete?: boolean;
}

export function ExpenseSheet({ open, onClose, expense, defaultDate, today, minDate, staff, canDelete }: ExpenseSheetProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [paidFrom, setPaidFrom] = useState<PaidFrom>('cash');
  const [date, setDate] = useState(defaultDate);
  const [staffId, setStaffId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(expense ? String(expense.amount) : '');
    setCategory(expense?.category ?? null);
    setPaidFrom(expense?.paid_from ?? 'cash');
    setDate(expense?.spent_on ?? defaultDate);
    setStaffId(expense?.staff_id ?? '');
    setNote(expense?.note ?? '');
    setError(null);
    setConfirmDelete(false);
  }, [open, expense, defaultDate]);

  const value = parseAmount(amount);
  const advance = category === 'Staff advance';
  const save = () => start(async () => {
    setError(null);
    if (!value) return setError('Enter the amount spent.');
    if (!category) return setError('Pick a category.');
    if (advance && !staffId) return setError('Choose who got the advance.');
    const r = await saveExpense({ id: expense?.id ?? null, spentOn: date, category, amount: value, paidFrom, note, staffId: advance ? staffId : null });
    if (!r.ok) return setError(r.error);
    toast(r.message ?? 'Saved');
    onClose();
    router.refresh();
  });
  const remove = () => start(async () => {
    if (!expense) return;
    const r = await deleteExpense(expense.id);
    if (!r.ok) { setConfirmDelete(false); return setError(r.error); }
    toast(r.message ?? 'Deleted');
    onClose();
    router.refresh();
  });

  return (
    <Sheet open={open} onClose={onClose} title={expense ? 'Edit expense' : 'Add expense'} width={460}
      footer={confirmDelete ? (
        <>
          <span className="grow small strong danger-text">Delete this expense?</span>
          <Button onClick={() => setConfirmDelete(false)} disabled={pending}>Keep it</Button>
          <Button variant="danger" onClick={remove} loading={pending}>Delete</Button>
        </>
      ) : (
        <>
          {expense && canDelete && <Button variant="ghost" icon="trash" className="danger-text" onClick={() => setConfirmDelete(true)} style={{ marginRight: 'auto' }}>Delete</Button>}
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={pending}>{expense ? 'Save changes' : 'Add expense'}</Button>
        </>
      )}>
      <div className="stack-lg">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="exp-amount">Amount</label>
          <div className="prefix-input exp-amount">
            <span>₹</span>
            <input id="exp-amount" className="input num" inputMode="decimal" autoComplete="off" placeholder="0" autoFocus
              value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
        </div>

        <fieldset className="field exp-fieldset">
          <legend className="label">Category</legend>
          <div className="exp-cats">
            {EXPENSE_CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip chip-sm" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
        </fieldset>

        {advance && (
          <SelectField label="Advance given to" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Choose a team member…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
        )}

        <div className="field">
          <span className="label" id="exp-paid-label">Paid from</span>
          <div className="filters-scroll">
            <Segmented label="Paid from" value={paidFrom} onChange={setPaidFrom}
              options={PAID_FROM.map((p) => ({ value: p, label: PAID_FROM_LABEL[p] }))} />
          </div>
          <span className="hint">{PAID_FROM_HINT[paidFrom]}</span>
        </div>

        <div className="grid-2 exp-row">
          <TextField label="Date" type="date" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)}
            hint={date === today ? 'Today' : date ? fmtDateShort(date) : undefined} />
          <TextField label="Note (optional)" value={note} maxLength={300} placeholder={advance ? 'e.g. Festival advance' : 'e.g. Shampoo 5 L, Ravi Stores'}
            onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Sheet>
  );
}
