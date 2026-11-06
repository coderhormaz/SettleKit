'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, Building2, ChevronRight, Code2, FileSpreadsheet, FileText, LayoutDashboard, Link2, LoaderCircle, LogOut, Settings2, ShieldCheck, Users, Webhook } from 'lucide-react';
import { api, ApiError, ReadState, SignIn, Notice, useResource } from './shared';
import type { Merchant, Section } from './types';
import { OverviewSection, PaymentsSection } from './sections/payments';
import { ContactsSection, InvoicesSection, LinksSection } from './sections/collections';
import { DevelopersSection, ReportsSection, WebhooksSection } from './sections/integration';
import { AuditSection, RiskSection, SettingsSection } from './sections/risk-settings';
import styles from './dashboard.module.css';

const navigation = [
  { id: 'overview', title: 'Overview', icon: LayoutDashboard, description: 'A clear view of verified receipts, refunds and the work that follows.' },
  { id: 'payments', title: 'Payments', icon: ArrowDownLeft, description: 'Onchain payment evidence, current eligibility and store notification status.' },
  { id: 'links', title: 'Payment links', icon: Link2, description: 'Create a shareable checkout with a fixed USDT amount.' },
  { id: 'invoices', title: 'Invoices', icon: FileText, description: 'Send clear payment requests and keep the private business details together.' },
  { id: 'contacts', title: 'Contacts', icon: Users, description: 'Keep customer details private and connected to their invoice history.' },
  { id: 'developers', title: 'Developer setup', icon: Code2, description: 'Connect your store with a small server adapter and scoped API keys.' },
  { id: 'webhooks', title: 'Webhooks', icon: Webhook, description: 'Configure signed notifications and track their real delivery results.' },
  { id: 'reports', title: 'Reports', icon: FileSpreadsheet, description: 'Export exact payment and refund records for an explicit period.' },
  { id: 'risk', title: 'Risk & review', icon: ShieldCheck, description: 'Inspect current configured checks and resolve only eligible payment holds.' },
  { id: 'settings', title: 'Settings', icon: Settings2, description: 'Manage your business profile, payment availability and active sessions.' },
  { id: 'audit', title: 'Audit history', icon: Activity, description: 'A durable record of changes made in your merchant workspace.' },
] as const;

export function Dashboard({ section }: { section: Section }) {
  const router = useRouter(); const identity = useResource<{ merchant: Merchant }>('/api/auth/me');
  const [signingOut, setSigningOut] = useState(false); const [signOutError, setSignOutError] = useState<string | null>(null); const [signedOut, setSignedOut] = useState(false);
  const current = navigation.find(item => item.id === section)!;
  async function signOut() { if (signingOut) return; setSigningOut(true); setSignOutError(null); try { await api('/api/auth/logout', 'POST'); setSignedOut(true); } catch (error) { setSignOutError(error instanceof Error ? error.message : 'Sign out could not finish. Try again.'); } finally { setSigningOut(false); } }
  const content = section === 'overview' ? <OverviewSection /> : section === 'payments' ? <PaymentsSection /> : section === 'links' ? <LinksSection /> : section === 'invoices' ? <InvoicesSection /> : section === 'contacts' ? <ContactsSection /> : section === 'developers' ? <DevelopersSection /> : section === 'webhooks' ? <WebhooksSection /> : section === 'reports' ? <ReportsSection /> : section === 'risk' ? <RiskSection /> : section === 'settings' ? <SettingsSection /> : <AuditSection />;
  return <div className={styles.shell}>
    <a href="#dashboard-main" className="skip-link">Skip to merchant workspace</a>
    <aside className={styles.rail}><a className={styles.brand} href="/dashboard/overview"><span><ArrowRight size={18} /></span>SettleKit</a><nav aria-label="Merchant navigation">{navigation.map(item => <a key={item.id} href={`/dashboard/${item.id}`} aria-current={section === item.id ? 'page' : undefined}><item.icon size={17} />{item.title}</a>)}</nav><div className={styles.railFoot}><a href="/"><Building2 size={16} />Business setup</a><p>Direct settlement.<br />Independent evidence.</p></div></aside>
    <div className={styles.workspace}><header className={styles.header}><div className={styles.breadcrumb}>Workspace<ChevronRight size={13} /><strong>{current.title}</strong></div><div className={styles.mobileBrand}><a className={styles.brand} href="/dashboard/overview"><span><ArrowRight size={18} /></span>SettleKit</a></div><div className={styles.headerTools}>{identity.data?.merchant.displayName && <span className={styles.businessName}>{identity.data.merchant.displayName}</span>}<span className={styles.environment}><span />Testnet</span>{identity.data && !signedOut && <button className={styles.iconButton} disabled={signingOut} aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>{signingOut ? <LoaderCircle size={17} className="spin" /> : <LogOut size={17} />}</button>}</div></header>
      <div className={styles.mobileNavigation}><label htmlFor="dashboard-section">Workspace section</label><select id="dashboard-section" value={section} onChange={event => router.push(`/dashboard/${event.target.value}`)}>{navigation.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></div>
      <main className={styles.main} id="dashboard-main"><div className={styles.pageHeading}><div><h1>{current.title}</h1><p>{current.description}</p></div></div>{signOutError && <Notice>{signOutError}</Notice>}{signedOut || identity.error instanceof ApiError && identity.error.status === 401 ? <SignIn /> : <ReadState query={identity}>{() => content}</ReadState>}<footer className={styles.footer}><span>SettleKit · Merchant workspace</span><span><ShieldCheck size={14} />USDT on Whitechain Sepolia</span></footer></main>
    </div>
  </div>;
}
