'use client';
// Core UI primitives. Styling lives in app/globals.css; these components only add structure and behaviour.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon, type IconName } from './icons';
import { initials } from '@/lib/phone';
import type { ApptStatus } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/types';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; loading?: boolean; block?: boolean;
}
export function Button({ variant = 'secondary', size = 'md', icon, loading, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', !children && 'btn-icon', className)} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

/** Submit button that shows progress while its parent <form action={...}> is pending. */
export function SubmitButton({ children, pendingText, ...rest }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="primary" loading={pending} {...rest}>{pending && pendingText ? pendingText : children}</Button>;
}

// ---------- Form fields ----------
export function Field({ label, hint, error, children, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="error-text" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

type WithLabel = { label?: ReactNode; hint?: ReactNode; error?: string | null };
export function TextField({ label, hint, error, className, id, ...rest }: WithLabel & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId(); const fid = id ?? auto;
  return <Field label={label} hint={hint} error={error} htmlFor={fid}><input id={fid} className={cx('input', className)} aria-invalid={!!error || undefined} {...rest} /></Field>;
}
export function TextArea({ label, hint, error, className, id, ...rest }: WithLabel & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId(); const fid = id ?? auto;
  return <Field label={label} hint={hint} error={error} htmlFor={fid}><textarea id={fid} className={cx('textarea', className)} {...rest} /></Field>;
}
export function SelectField({ label, hint, error, className, id, children, ...rest }: WithLabel & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId(); const fid = id ?? auto;
  return <Field label={label} hint={hint} error={error} htmlFor={fid}><select id={fid} className={cx('select', className)} {...rest}>{children}</select></Field>;
}
export function Switch({ label, checked, onChange, name, defaultChecked, disabled }: { label?: ReactNode; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; name?: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" name={name} checked={checked} defaultChecked={defaultChecked} disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)} />
      <span className="track" aria-hidden />
      {label && <span>{label}</span>}
    </label>
  );
}
export function SearchInput({ value, onChange, placeholder = 'Search', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="input-group">
      <span className="icon-left"><Icon name="search" size={17} /></span>
      <input className="input" type="search" value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

// ---------- Display ----------
type Tone = 'neutral' | 'peacock' | 'marigold' | 'success' | 'danger' | 'plum' | 'outline';
export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: string }) {
  return <span className={cx('badge', tone !== 'neutral' && `badge-${tone}`)}>{dot && <span className="dot" style={{ background: dot }} />}{children}</span>;
}

const STATUS_TONE: Record<ApptStatus, Tone> = {
  waiting: 'marigold', booked: 'neutral', confirmed: 'peacock', checked_in: 'plum', in_service: 'marigold',
  completed: 'success', cancelled: 'danger', no_show: 'danger',
};
export function StatusBadge({ status }: { status: ApptStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function Avatar({ name, color, size }: { name: string; color?: string; size?: 'sm' | 'lg' }) {
  return <span className={cx('avatar', size && `avatar-${size}`)} style={color ? { background: color } : undefined} aria-hidden>{initials(name)}</span>;
}

export function Panel({ title, actions, children, footer, flush, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; footer?: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={cx('panel', className)}>
      {(title || actions) && <div className="panel-head">{typeof title === 'string' ? <h2>{title}</h2> : title}{actions && <div className="row">{actions}</div>}</div>}
      {flush ? children : <div className="panel-body">{children}</div>}
      {footer && <div className="panel-foot">{footer}</div>}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>;
}

export function Empty({ icon = 'sparkle', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const icon: IconName = tone === 'error' || tone === 'warn' ? 'alert' : tone === 'success' ? 'check' : 'info';
  return <div className={cx('notice', tone !== 'info' && `notice-${tone}`)} role={tone === 'error' ? 'alert' : undefined}><Icon name={icon} size={18} style={{ flex: 'none', marginTop: 1 }} /><div>{children}</div></div>;
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

// ---------- Overlays ----------
function useEscape(onClose: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
}

export function Sheet({ open, onClose, title, children, footer, width }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(onClose, open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} ref={ref} style={width ? { width: `min(${width}px, 100vw)` } : undefined}>
        <div className="sheet-head">{typeof title === 'string' ? <h2>{title}</h2> : title}<Button variant="ghost" icon="x" onClick={onClose} aria-label="Close" /></div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose, open);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-body stack"><h2>{title}</h2>{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </>
  );
}

// ---------- Toasts ----------
type ToastItem = { id: number; text: string; tone: 'default' | 'error' };
const ToastCtx = createContext<(text: string, tone?: 'default' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: 'default' | 'error' = 'default') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className={cx('toast', t.tone === 'error' && 'toast-error')}>{t.tone === 'error' ? <Icon name="alert" size={16} /> : <Icon name="check" size={16} />}{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
