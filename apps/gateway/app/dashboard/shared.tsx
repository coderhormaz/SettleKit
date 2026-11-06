'use client';

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, Copy, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { formatUsdt, parseUsdt } from '@settlekit/core';
import styles from './dashboard.module.css';

export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(path.startsWith('/api/') ? path : `/api/operations${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const value = await response.json() as T & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new ApiError(response.status, value.error?.code ?? 'REQUEST_FAILED', value.error?.message ?? 'This request could not finish. Please try again.');
    return value;
  } catch (error) { if (error instanceof ApiError) throw error; throw new Error('We couldn’t reach SettleKit. Your saved records are safe. Check your connection and retry.'); }
  finally { clearTimeout(timer); }
}
export function useResource<T>(path: string, enabled = true) { return useQuery<T>({ queryKey: ['operations', path], queryFn: () => api<T>(path), enabled, retry: false, refetchOnWindowFocus: true, staleTime: 10_000 }); }
export function useAction() {
  const cache = useQueryClient(); const lock = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null); const [success, setSuccess] = useState<string | null>(null);
  async function execute<T>(path: string, method: string, body: unknown, message: string): Promise<T | undefined> {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null); setSuccess(null);
    try { const value = await api<T>(path, method, body); await cache.invalidateQueries({ queryKey: ['operations'] }); await cache.invalidateQueries({ queryKey: ['dashboard-identity'] }); setSuccess(message); return value; }
    catch (cause) { setError(cause instanceof Error ? cause : new Error('The action could not finish. Please try again.')); if (cause instanceof ApiError && cause.status === 409) await cache.invalidateQueries({ queryKey: ['operations'] }); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, success, execute, clear: () => { setError(null); setSuccess(null); } };
}
export function date(value: string | null | undefined, includeTime = true) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(parsed); }
export function label(value: string | null | undefined) { return value ? value.replaceAll('_', ' ').replaceAll('.', ' ') : 'Not available'; }
export function short(value: string, length = 22) { return value.length > length ? `${value.slice(0, length - 9)}…${value.slice(-8)}` : value; }
export function Money({ value, unit = true }: { value: string; unit?: boolean }) { const negative = value.startsWith('-'); return <span className={styles.money}>{negative ? '−' : ''}{formatUsdt(negative ? value.slice(1) : value)}{unit && <span className={styles.unit}>USDT</span>}</span>; }
export function Badge({ value, stale = false }: { value: string | null | undefined; stale?: boolean }) { const positive = ['accepted', 'paid', 'allowed', 'active', 'delivered', 'completed', 'success'].includes(value ?? ''); const caution = ['review', 'orphaned', 'blocked', 'unavailable', 'dead', 'failed', 'overdue', 'paused', 'refund_hold'].includes(value ?? ''); return <span className={`${styles.badge} ${!stale && positive ? styles.positive : caution ? styles.caution : styles.neutral}`}>{value === 'accepted' ? 'Received' : label(value)}</span>; }
export function Notice({ children, success = false }: { children: ReactNode; success?: boolean }) { return <div role={success ? 'status' : 'alert'} className={`${styles.notice} ${success ? styles.noticeSuccess : ''}`}>{success ? <Check size={17} /> : <CircleAlert size={17} />}<div>{children}</div></div>; }
export function ActionFeedback({ action }: { action: ReturnType<typeof useAction> }) { if (action.error instanceof ApiError && action.error.status === 401) return <SignIn />; return <>{action.error && <Notice>{action.error.message}</Notice>}{action.success && <Notice success>{action.success}</Notice>}</>; }
export function SignIn() { return <div className={styles.empty}><CircleAlert size={25} /><h2>Your session has ended</h2><p>Verify your merchant wallet to continue. Your saved business records are safe.</p><a className={styles.primary} href="/">Sign in with your wallet<ArrowRight size={15} /></a></div>; }
export function ReadState<T>({ query, children }: { query: UseQueryResult<T, Error>; children: (data: T) => ReactNode }) {
  if (query.error instanceof ApiError && query.error.status === 401) return <SignIn />;
  if (query.isPending) return <div className={styles.loading} role="status"><LoaderCircle size={23} className="spin" /><p>Loading your records…</p></div>;
  if (query.isError) return <Notice><strong>Current records are unavailable.</strong><p>{query.error.message}</p><button className={styles.textButton} onClick={() => void query.refetch()}><RefreshCw size={14} />Try again</button></Notice>;
  return query.data === undefined ? null : <>{children(query.data)}</>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className={styles.empty}><h2>{title}</h2><p>{children}</p>{action}</div>; }
export function CopyButton({ value, name = 'Copy', disabled = false }: { value: string; name?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false); const [error, setError] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); setError(false); } catch { setCopied(false); setError(true); } }
  return <span className={styles.copyGroup}><button type="button" className={styles.secondary} disabled={disabled} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : name}</button>{error && <span role="alert" className={styles.fieldError}>Copy failed. Select and copy the value manually.</span>}</span>;
}
export function Dialog({ title, description, children, onClose, busy = false, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId(); const descriptionId = useId(); const close = useRef(onClose); close.current = onClose;
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); prior?.focus(); }; }, []);
  return <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.dialogWide : ''}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={event => { event.preventDefault(); if (!busy) close.current(); }} onKeyDown={event => { if (event.key !== 'Tab' || [...document.querySelectorAll('dialog[open]')].at(-1) !== ref.current) return; const elements = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])].filter(node => node.offsetParent !== null); const first = elements[0]; const last = elements.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}>
    <div className={styles.dialogHeading}><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className={styles.iconButton} aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button></div><fieldset className={styles.dialogContent} disabled={busy}>{children}</fieldset>
  </dialog>;
}
export function Confirm({ title, description, actionLabel, busy, error, onClose, onConfirm }: { title: string; description: string; actionLabel: string; busy: boolean; error?: string; onClose: () => void; onConfirm: () => void }) { return <Dialog title={title} description={description} onClose={onClose} busy={busy}>{error && <Notice>{error}</Notice>}<div className={styles.formFooter}><button className={styles.secondary} disabled={busy} onClick={onClose}>Keep current state</button><button className={styles.danger} disabled={busy} onClick={onConfirm}>{busy && <LoaderCircle className="spin" size={15} />}{busy ? 'Saving…' : actionLabel}</button></div></Dialog>; }
export function Field({ label: text, name, hint, error, children }: { label: string; name: string; hint?: string; error?: string; children: ReactNode }) { const control = isValidElement(children) ? cloneElement(children as ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, { 'aria-invalid': !!error, 'aria-describedby': error ? `${name}-error` : hint ? `${name}-hint` : undefined }) : children; return <div className={styles.field}><label htmlFor={name}>{text}</label>{control}{error ? <span className={styles.fieldError} id={`${name}-error`} role="alert">{error}</span> : hint ? <span className={styles.hint} id={`${name}-hint`}>{hint}</span> : null}</div>; }
export function useForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  function read(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const invalid: Record<string, string> = {}; for (const input of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')) { if (!input.disabled && input.required && !input.value.trim()) invalid[input.name] = 'Complete this field.'; else if (!input.checkValidity()) invalid[input.name] = input.validity.valueMissing ? 'Complete this field.' : input.validity.typeMismatch ? 'Enter a valid email address or URL.' : input.validationMessage; } setErrors(invalid); if (Object.keys(invalid).length) { form.querySelector<HTMLElement>('[name="' + Object.keys(invalid)[0] + '"]')?.focus(); return null; } return Object.fromEntries(new FormData(form).entries()) as Record<string, string>; }
  function amount(value: string, name = 'amount') { try { const units = parseUsdt(value); if (units <= 0n) throw new Error(); return units.toString(); } catch { setErrors(previous => ({ ...previous, [name]: 'Enter a positive USDT amount with at most six decimal places.' })); return null; } }
  return { errors, read, amount, setErrors };
}
export function FormFooter({ busy, label: text, onCancel }: { busy: boolean; label: string; onCancel: () => void }) { return <div className={styles.formFooter}><button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button><button className={styles.primary} disabled={busy} type="submit">{busy && <LoaderCircle className="spin" size={15} />}{busy ? 'Saving…' : text}</button></div>; }
export function Pagination({ page, total, pageSize, onPage, busy = false }: { page: number; total: number; pageSize: number; onPage: (page: number) => void; busy?: boolean }) { const pages = Math.max(1, Math.ceil(total / pageSize)); return <div className={styles.pagination}><span>{total} records · Page {page} of {pages}</span><div><button className={styles.secondary} disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}><ChevronLeft size={15} />Previous</button><button className={styles.secondary} disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>Next<ChevronRight size={15} /></button></div></div>; }
export interface Filters { search: string; status: string; from: string; to: string; sort: string; page: number }
export const emptyFilters: Filters = { search: '', status: '', from: '', to: '', sort: 'newest', page: 1 };
export function queryString(filters: Partial<Filters>, extra: Record<string, string> = {}) { const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)])), ...extra }); return params.toString(); }
export function FiltersBar({ onApply, statuses = [], dates = false, sorting = false, search = true, defaultStatus = '' }: { onApply: (filters: Filters) => void; statuses?: string[]; dates?: boolean; sorting?: boolean; search?: boolean; defaultStatus?: string }) {
  const form = useForm();
  return <form className={styles.filters} noValidate onSubmit={event => { const values = form.read(event); if (values) onApply({ ...emptyFilters, search: values.search ?? '', status: values.status ?? defaultStatus, from: values.from ?? '', to: values.to ?? '', sort: values.sort ?? 'newest' }); }}>{search && <label className={styles.searchField}><span>Search</span><input name="search" placeholder="Search records" maxLength={120} /></label>}{statuses.length > 0 && <label><span>Status</span><select name="status" defaultValue={defaultStatus}><option value={defaultStatus}>All statuses</option>{statuses.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label>}{dates && <><label><span>From · UTC</span><input type="date" name="from" /></label><label><span>To · UTC</span><input type="date" name="to" /></label></>}{sorting && <label><span>Sort</span><select name="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount-desc">Highest amount</option><option value="amount-asc">Lowest amount</option></select></label>}<button type="submit" className={styles.secondary}>Apply filters</button><button type="reset" className={styles.textButton} onClick={() => onApply({ ...emptyFilters, status: defaultStatus })}>Clear</button></form>;
}
