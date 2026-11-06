'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowRight, CheckCheck, ChevronRight, CircleAlert, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Wallet, X } from 'lucide-react';
import { formatUsdt } from '@settlekit/core';
import styles from './payments.module.css';

type Payment = {
  id: string; reference: string; order_id: string; amount_base_units: string; status: string;
  confirmation_stage: string; delivery_status: string | null; created_at: string; payer: string | null;
  tx_hash: string | null; risk_state: string; state_version: number;
};
type PaymentDetail = Payment & { timeline?: Array<{ event_type: string; status: string; attempts: number; error_code: string | null; created_at: string; state_version: number }> };
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function api<T>(path: string): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    const value = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) throw new ApiError(response.status, value.error?.message ?? 'Payment records could not be loaded.');
    return value;
  } catch (error) { if (error instanceof ApiError) throw error; throw new Error('We couldn’t reach your payment records. Check your connection and try again.'); }
  finally { clearTimeout(timer); }
}
function date(value: string) {
  return new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function label(value: string | null) { return value ? value.replaceAll('_', ' ').replaceAll('.', ' ') : 'Not delivered'; }
function status(value: string) { return value === 'accepted' ? 'Received' : value === 'open' ? 'Awaiting payment' : label(value); }
function short(value: string) { return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-7)}` : value; }
function badge(value: string, stale = false) {
  return stale ? styles.neutral : value === 'accepted' || value === 'delivered' || value === 'completed' || value === 'allowed' ? styles.positive : value === 'review' || value === 'orphaned' || value === 'blocked' || value === 'dead' || value === 'unavailable' ? styles.caution : styles.neutral;
}

export function Payments() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['payments'], queryFn: () => api<{ payments: Payment[] }>('/api/merchant/payments'), retry: false, refetchInterval: 15_000, refetchOnWindowFocus: 'always' });
  const detail = useQuery({ queryKey: ['payment', selected], queryFn: () => api<PaymentDetail>(`/api/merchant/payments/${encodeURIComponent(selected!)}`), enabled: !!selected, retry: false, refetchInterval: 10_000, refetchOnWindowFocus: 'always' });
  const expired = list.error instanceof ApiError && list.error.status === 401 || detail.error instanceof ApiError && detail.error.status === 401;
  const payments = list.data?.payments ?? [];
  const payment = detail.data;
  async function refresh() { await list.refetch(); if (selected) await detail.refetch(); }

  return <div className={styles.page}>
    <a className="skip-link" href="#payments-main">Skip to payments</a>
    <aside className={styles.sidebar}><a className={styles.brand} href="/"><span><ArrowRight size={19} /></span>SettleKit</a><p>WORKSPACE</p><nav aria-label="Merchant workspace"><a href="/"><Wallet size={16} />Business setup</a><a href="/payments" aria-current="page"><ArrowDownLeft size={16} />Payments</a></nav><div className={styles.sidebarNote}><ShieldCheck size={17} /><p>Direct settlement.<br />Verifiable payment records.</p></div></aside>
    <div className={styles.workspace}>
      <header className={styles.topbar}><div>Workspace<ChevronRight size={13} /><strong>Payments</strong></div><span className={styles.network}><span />Whitechain Sepolia <span>Testnet</span></span></header>
      <main id="payments-main" className={styles.main}>
        <div className={styles.heading}><div><h1>Payments</h1><p>Follow each payment from onchain receipt to store notification.</p></div>{!expired && <button className={`secondary-button ${styles.refresh}`} disabled={list.isFetching || detail.isFetching} onClick={() => void refresh()}><RefreshCw size={15} className={list.isFetching ? 'spin' : ''} />Refresh</button>}</div>
        <div className={styles.boundary}><LockKeyhole size={15} /><p>USDT settles directly to your wallet. These records track payment and delivery; they are not a custodial balance.</p></div>
        {expired ? <section className={styles.empty}><LockKeyhole size={27} /><h2>Sign in to view payments</h2><p>Your session has ended. Verify your merchant wallet to continue.</p><a className="primary-button" href="/">Go to sign in<ArrowRight size={15} /></a></section> : list.isPending ? <section className={styles.empty} aria-live="polite"><LoaderCircle size={25} className="spin" /><h2>Loading your payments</h2><p>Reading the latest saved payment and notification states.</p></section> : <>
          {list.isError && <div className={styles.warning} role="alert"><CircleAlert size={18} /><div><strong>Current payment status is unavailable</strong><p>{list.error.message} Saved records below may be out of date.</p><button className="text-button" onClick={() => void refresh()}>Try again</button></div></div>}
          {!payments.length && !list.isError ? <section className={styles.empty}><span className={styles.emptyIcon}><ArrowDownLeft size={27} /></span><h2>Your first payment starts here</h2><p>Payments created through your store integration appear here with their chain confirmation and delivery status.</p><a className={styles.setupLink} href="/">Review your business setup<ArrowRight size={15} /></a></section> : payments.length > 0 ? <div className={`${styles.content} ${selected ? styles.withDetail : ''}`}>
            <section className={styles.listPanel} aria-label="Payment records"><div className={styles.listHeading}><h2>Payment records</h2><span>{payments.length} loaded</span></div><div className={styles.tableWrap}><table><thead><tr><th scope="col">Payment</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Notification</th><th scope="col"><span className={styles.srOnly}>Details</span></th></tr></thead><tbody>{payments.map((row) => <tr key={row.id} className={selected === row.id ? styles.selectedRow : ''}><td><button className={styles.rowButton} onClick={() => setSelected(row.id)} aria-label={`View payment ${row.order_id}`}><strong>{short(row.order_id)}</strong><span>{date(row.created_at)}</span></button></td><td className={styles.money}>{formatUsdt(row.amount_base_units)}<span>USDT</span></td><td><span className={`${styles.badge} ${badge(row.status, list.isError)}`}>{status(row.status)}</span></td><td><span className={styles.delivery}>{label(row.delivery_status)}</span></td><td><button className={styles.openButton} aria-label={`Open details for ${row.order_id}`} onClick={() => setSelected(row.id)}><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div><p className={styles.tableNote}>Received means included with two block confirmations. It does not imply finality or completed store delivery.</p></section>
            {selected && <section className={styles.detail} aria-labelledby="payment-detail-heading"><div className={styles.detailHeading}><h2 id="payment-detail-heading">Payment details</h2><button className={styles.closeButton} aria-label="Close payment details" onClick={() => setSelected(null)}><X size={17} /></button></div>{detail.isPending ? <div className={styles.detailLoading} role="status"><LoaderCircle size={21} className="spin" />Loading payment details…</div> : detail.isError ? <div className={styles.detailError} role="alert"><CircleAlert size={19} /><p>{detail.error.message}</p><button className="text-button" onClick={() => void detail.refetch()}>Try again</button></div> : payment ? <>
              <div className={styles.detailAmount}>{formatUsdt(payment.amount_base_units)}<span>USDT</span></div><span className={`${styles.badge} ${badge(payment.status)}`}>{payment.status === 'accepted' && <CheckCheck size={12} />}{status(payment.status)}</span>
              <dl className={styles.detailRows}><div><dt>Order reference</dt><dd><code>{payment.order_id}</code></dd></div><div><dt>Created</dt><dd>{date(payment.created_at)}</dd></div><div><dt>Confirmation</dt><dd>{payment.confirmation_stage === 'included_2_blocks' ? 'Included · 2 blocks' : label(payment.confirmation_stage)}</dd></div><div><dt>Configured checks</dt><dd>{label(payment.risk_state)}</dd></div><div><dt>Store notification</dt><dd>{label(payment.delivery_status)}</dd></div><div><dt>State version</dt><dd>{payment.state_version}</dd></div></dl>
              {payment.payer && <div className={styles.identifier}><span>Payer wallet</span><a href={`https://explorer.testnet.whitechain.io/address/${payment.payer}`} target="_blank" rel="noreferrer"><code>{payment.payer}</code><ExternalLink size={13} /></a></div>}
              {payment.tx_hash && <div className={styles.identifier}><span>Payment transaction</span><a href={`https://explorer.testnet.whitechain.io/tx/${payment.tx_hash}`} target="_blank" rel="noreferrer"><code>{payment.tx_hash}</code><ExternalLink size={13} /></a></div>}
              <div className={styles.identifier}><span>Payment ID</span><code>{payment.id}</code></div>
              {payment.timeline && payment.timeline.length > 0 && <div className={styles.timeline}><h3>Notification activity</h3><ol>{payment.timeline.map((event, index) => <li key={`${event.created_at}-${index}`}><span /><div><strong>{label(event.event_type)} · {label(event.status)}</strong><time dateTime={event.created_at}>{date(event.created_at)} · {event.attempts} attempts · v{event.state_version}</time>{event.error_code && <span className={styles.activityError}>{label(event.error_code)}</span>}</div></li>)}</ol></div>}
              {['review', 'orphaned', 'blocked'].includes(payment.status) && <div className={styles.detailWarning}><CircleAlert size={16} /><p>Automatic delivery is held. Review the current evidence before taking action in your store.</p></div>}
              <a className={styles.checkoutLink} href={`/checkout/${encodeURIComponent(payment.reference)}`}>Open customer checkout<ExternalLink size={13} /></a>
            </> : null}</section>}
          </div> : null}
        </>}
        <footer className={styles.footer}><span>SettleKit · Merchant workspace</span><span><ShieldCheck size={13} />Test environment · USDT on Whitechain</span></footer>
      </main>
    </div>
  </div>;
}
