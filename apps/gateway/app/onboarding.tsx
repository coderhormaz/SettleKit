"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { ArrowDownLeft, ArrowRight, Check, CheckCheck, ChevronRight, CircleHelp, ExternalLink, Fingerprint, Globe2, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck, ShieldX, Wallet, X } from "lucide-react";
import { profileSchema } from "@settlekit/core";

type Screening = {
  state: "allowed" | "blocked" | "unavailable" | "review_required";
  reasonCodes: string[];
  checkedAt: string;
  expiresAt: string;
  sourceHash: string | null;
  sourceAgeMs: number | null;
  sourceFetchedAt: string | null;
};
type Merchant = {
  id: string;
  ownerWallet: string;
  displayName: string;
  websiteOrigin: string;
  settlementWallet: string;
  settlementProvenAt: string;
  updatedAt: string;
  version: number;
  screening: Screening;
};
type Challenge = { id: string; message: string; expiresAt: string };
class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", signal: controller.signal, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const value = await response.json() as T & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new ApiError(response.status, value.error?.code ?? "REQUEST_FAILED", value.error?.message ?? "This action could not finish. Please try again.");
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("We couldn’t reach SettleKit. Check your connection and try again.");
  } finally { clearTimeout(timeout); }
}

function shortAddress(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function timestamp(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function walletError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && /reject|denied|cancel/i.test(error.message)) return "The wallet request was cancelled. Nothing was sent. You can try again.";
  if (error instanceof Error && /provider|connector|wallet.*found|unavailable/i.test(error.message)) return "No compatible browser wallet was found. Open this page in a browser with an EVM wallet, then try again.";
  if (error instanceof Error && /chain|network|switch/i.test(error.message)) return "Switch your wallet to Whitechain Sepolia, then try again. The network uses test WBT for gas.";
  return error instanceof Error && error.message.startsWith("We couldn’t") ? error.message : "The wallet request could not finish. Check your wallet and try again.";
}

export function Onboarding() {
  const queryClient = useQueryClient();
  const account = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const [busy, setBusy] = useState<"login" | "save" | "screen" | "settlement" | "logout" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [websiteOrigin, setWebsiteOrigin] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [walletMissing, setWalletMissing] = useState(false);
  const initializedMerchant = useRef<string | null>(null);
  const connectedOnce = useRef(false);
  const query = useQuery({
    queryKey: ["merchant"],
    queryFn: async () => {
      try { return (await api<{ merchant: Merchant }>("/api/auth/me")).merchant; }
      catch (cause) { if (cause instanceof ApiError && cause.status === 401) return null; throw cause; }
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
  });
  const merchant = query.data ?? null;

  useEffect(() => {
    if (merchant && initializedMerchant.current !== merchant.id) {
      initializedMerchant.current = merchant.id;
      setDisplayName(merchant.displayName);
      setWebsiteOrigin(merchant.websiteOrigin);
      setDirty(false);
    }
  }, [merchant]);

  useEffect(() => {
    if (account.isConnected) connectedOnce.current = true;
    if (account.status === "disconnected" && connectedOnce.current && merchant && busy !== "logout") {
      connectedOnce.current = false;
      void api("/api/auth/logout", "POST").then(() => {
        queryClient.setQueryData(["merchant"], null);
        setMessage("Wallet disconnected. Your session is now signed out.");
      }).catch(() => setError("Your wallet disconnected, but sign-out could not reach the server. Reconnect or use Sign out to end this session."));
    }
  }, [account.isConnected, account.status, merchant, busy, queryClient]);

  const ownerMatches = !!(merchant && account.address && account.address.toLowerCase() === merchant.ownerWallet.toLowerCase());
  const differentWallet = !!(merchant && account.address && !ownerMatches);
  const profileSaved = !!(merchant?.displayName && merchant.websiteOrigin);
  const screeningCurrent = !!(merchant && !query.isError && Date.parse(merchant.screening.expiresAt) > Date.now());
  const screeningState = merchant && !query.isError && (merchant.screening.state !== "allowed" || screeningCurrent) ? merchant.screening.state : "unavailable";
  const allowed = screeningState === "allowed";
  const setupSteps = [
    { label: "Verify your wallet", detail: "A signature keeps you in control", complete: !!merchant, active: !merchant, icon: Wallet },
    { label: "Add your business", detail: "The name your customers will see", complete: profileSaved, active: !!merchant && !profileSaved, icon: Globe2 },
    { label: "Check settlement", detail: "Ownership and configured checks", complete: !!merchant && allowed && !!merchant.settlementProvenAt, active: !!merchant && profileSaved, icon: ShieldCheck },
  ];

  function actionError(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) {
      queryClient.setQueryData(["merchant"], null);
      setError("Your session expired. Sign in again to continue; your saved business details are safe.");
    } else setError(walletError(cause));
  }

  async function connectedAddress() {
    setWalletMissing(false);
    const connector = connectors[0];
    if (!connector || !(await connector.getProvider())) {
      setWalletMissing(true);
      throw new Error("Browser wallet provider not found");
    }
    let address = account.address;
    if (!account.isConnected || !address) {
      const connection = await connectAsync({ connector });
      address = connection.accounts[0];
    }
    if (!address) throw new Error("Wallet account unavailable");
    await switchChainAsync({ chainId: 1874 });
    return address;
  }

  async function signIn() {
    setBusy("login"); setError(null); setMessage(null);
    try {
      const address = await connectedAddress();
      const challenge = await api<Challenge>("/api/auth/challenge", "POST", { address });
      const signature = await signMessageAsync({ message: challenge.message });
      const result = await api<{ merchant: Merchant }>("/api/auth/verify", "POST", { id: challenge.id, signature });
      queryClient.setQueryData(["merchant"], result.merchant);
      setMessage("Wallet verified. Add your business details to continue.");
    } catch (cause) { actionError(cause); } finally { setBusy(null); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setMessage(null);
    const result = profileSchema.safeParse({ displayName, websiteOrigin });
    if (!result.success) {
      setFieldErrors(Object.fromEntries(result.error.issues.map(issue => [String(issue.path[0]), issue.message])));
      return;
    }
    setFieldErrors({}); setBusy("save");
    try {
      const response = await api<{ merchant: Merchant }>("/api/merchant", "PATCH", result.data);
      queryClient.setQueryData(["merchant"], response.merchant);
      setDisplayName(response.merchant.displayName); setWebsiteOrigin(response.merchant.websiteOrigin);
      setDirty(false); setMessage("Business details saved. Your settlement wallet is shown below.");
    } catch (cause) { actionError(cause); } finally { setBusy(null); }
  }

  async function refreshScreening() {
    setBusy("screen"); setError(null); setMessage(null);
    try {
      const { screening } = await api<{ screening: Screening }>("/api/merchant/screening", "POST");
      queryClient.setQueryData<Merchant | null>(["merchant"], current => current ? { ...current, screening } : current);
      setMessage(screening.state === "allowed" ? "The wallet passed the currently configured checks." : "Check complete. Review the current settlement status below.");
    } catch (cause) { actionError(cause); } finally { setBusy(null); }
  }

  async function proveSettlement() {
    setBusy("settlement"); setError(null); setMessage(null);
    try {
      const address = await connectedAddress();
      const challenge = await api<Challenge>("/api/merchant/settlement/challenge", "POST", { address });
      const signature = await signMessageAsync({ message: challenge.message });
      const result = await api<{ merchant: Merchant }>("/api/merchant/settlement/verify", "POST", { id: challenge.id, signature });
      queryClient.setQueryData(["merchant"], result.merchant);
      setMessage("Settlement wallet ownership verified. Its current screening result is shown below.");
    } catch (cause) { actionError(cause); } finally { setBusy(null); }
  }

  async function signOut() {
    setBusy("logout"); setError(null); setMessage(null);
    try {
      await api("/api/auth/logout", "POST");
      queryClient.setQueryData(["merchant"], null); disconnect(); connectedOnce.current = false;
      setMessage("You’re signed out. Your saved business details are still there for next time.");
    } catch (cause) { actionError(cause); } finally { setBusy(null); }
  }

  const source = merchant?.screening;
  const pending = busy !== null;
  const statusLabel = allowed ? "Passed configured checks" : screeningState === "blocked" ? "Wallet blocked" : screeningState === "review_required" ? "Review required" : "Checks unavailable";

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to business setup</a>
    <aside className="sidebar" aria-label="SettleKit workspace">
      <a href="/" className="brand" aria-label="SettleKit business setup"><span className="brand-mark" aria-hidden="true"><ArrowDownLeft size={25} strokeWidth={2.4} /></span>SettleKit<span className="brand-dot">.</span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <a className="nav-item active" href="#main-content" aria-current="page"><Fingerprint size={19} />Business setup<ChevronRight size={16} /></a>
      <div className="sidebar-bottom">
        <div className="test-notice"><span className="status-dot" />Test environment<span className="network-name">Whitechain Sepolia</span></div>
        <button className="help-button" type="button" onClick={() => setHelpOpen(value => !value)} aria-expanded={helpOpen} aria-controls="setup-help"><CircleHelp size={18} />How setup works<ChevronRight size={15} className={helpOpen ? "rotate" : ""} /></button>
        {helpOpen && <div id="setup-help" className="help-content">Sign a message to verify your wallet, save your business details, then review settlement ownership and current checks. This setup does not send tokens.</div>}
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={13} /><span>Business setup</span></div><div className="topbar-right"><span className="network-chip"><span className="status-dot" />Whitechain testnet</span>{merchant && <button className="icon-button" type="button" onClick={signOut} disabled={pending} aria-label="Sign out" title="Sign out">{busy === "logout" ? <LoaderCircle className="spin" size={18} /> : <LogOut size={18} />}</button>}</div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="page-heading"><div><h1>A good beginning<span className="heading-dot">.</span></h1><p>Connect your wallet. Make this business yours.</p></div><span className="environment-tag">Test setup</span></div>

        <div className="setup-layout">
          <section className="setup-work" aria-label="Merchant onboarding">
            <ol className="setup-steps" aria-label="Business setup progress">{setupSteps.map((step, index) => <li key={step.label} className={`${step.complete ? "complete" : ""} ${step.active ? "current" : ""}`}><span className="step-symbol" aria-hidden="true">{step.complete ? <Check size={15} /> : index + 1}</span><div><span className="step-title">{step.label}</span><span className="step-detail">{step.detail}</span></div>{index < 2 && <span className="step-connector" aria-hidden="true" />}</li>)}</ol>

            {(error || query.isError) && <div className="notice notice-error" role="alert"><ShieldX size={19} /><div><strong>Let’s try that again</strong><p>{error ?? (query.error instanceof Error ? query.error.message : "Your setup could not be loaded.")}</p>{query.isError && <button className="text-button" type="button" onClick={() => void query.refetch()}>Retry loading setup<RefreshCw size={13} /></button>}{walletMissing && <a className="text-button" href="https://ethereum.org/wallets/find-wallet/" target="_blank" rel="noreferrer">Find an EVM wallet<ExternalLink size={13} /></a>}</div><button type="button" className="dismiss-button" onClick={() => setError(null)} aria-label="Dismiss message"><X size={15} /></button></div>}
            {message && <div className="notice notice-success" role="status"><CheckCheck size={19} /><p>{message}</p></div>}

            {query.isPending ? <div className="setup-panel loading-state" aria-live="polite"><LoaderCircle size={23} className="spin" /><h2>Checking your session</h2><p>We’re looking for your saved business setup.</p></div> : !merchant ? <section className="setup-panel wallet-panel">
              <div className="panel-topline"><span className="surface-icon"><Wallet size={24} strokeWidth={1.7} /></span><span className="private-label"><LockKeyhole size={12} />Signature only</span></div>
              <h2>Your wallet.<br />Your business.</h2><p className="panel-description">Use your browser wallet to sign in securely. You keep control of your keys and where your business receives funds.</p>
              <button className="primary-button connect-button" type="button" onClick={signIn} disabled={pending || query.isError}>{busy === "login" ? <><LoaderCircle className="spin" size={18} />Check your wallet</> : <><Wallet size={18} />Connect &amp; verify wallet<ArrowRight size={17} /></>}</button>
              <div className="signature-note"><ShieldCheck size={16} /><span>A sign-in message, no token approval.<br /><strong>Nothing moves during setup.</strong></span></div>
              <a className="network-footnote" href="https://docs.whitechain.io/learn/network/testnet" target="_blank" rel="noreferrer"><span className="small-network-mark">W</span><span>Whitechain Sepolia<span>Test network · chain 1874</span></span><ExternalLink size={14} /></a>
            </section> : <>
              <section className="setup-panel profile-panel"><div className="section-heading"><div><h2>Make it official.</h2><p>A few details for your business workspace.</p></div><span className="small-icon"><Globe2 size={21} /></span></div>
                <div className="identity-line"><span className="verified-icon"><Check size={13} /></span><span>Signed in as</span><code title={merchant.ownerWallet}>{shortAddress(merchant.ownerWallet)}</code><span className="identity-verified">Verified</span></div>
                {differentWallet && <div className="wallet-change-note" role="status">Your connected wallet changed. This session still belongs to <code>{shortAddress(merchant.ownerWallet)}</code>. Sign out to switch businesses, or prove the connected wallet for settlement below.</div>}
                <form onSubmit={saveProfile} noValidate><div className="form-field"><label htmlFor="display-name">Business name</label><input id="display-name" name="displayName" autoComplete="organization" maxLength={80} value={displayName} placeholder="Your business name" onChange={event => { setDisplayName(event.target.value); setDirty(true); }} aria-invalid={!!fieldErrors.displayName} aria-describedby={fieldErrors.displayName ? "display-name-error" : undefined} disabled={pending} />{fieldErrors.displayName && <span id="display-name-error" className="field-error">{fieldErrors.displayName}</span>}</div>
                  <div className="form-field"><label htmlFor="website-origin">Website origin</label><input id="website-origin" name="websiteOrigin" type="url" autoComplete="url" maxLength={250} value={websiteOrigin} placeholder="https://your-business.com" onChange={event => { setWebsiteOrigin(event.target.value); setDirty(true); }} aria-invalid={!!fieldErrors.websiteOrigin} aria-describedby={fieldErrors.websiteOrigin ? "website-error website-hint" : "website-hint"} disabled={pending} /><span id="website-hint" className="field-hint">Your website address, without a page path or query.</span>{fieldErrors.websiteOrigin && <span id="website-error" className="field-error">{fieldErrors.websiteOrigin}</span>}</div>
                  <div className="form-footer"><span>{dirty ? "Unsaved changes" : profileSaved ? `Saved ${timestamp(merchant.updatedAt)}` : "Private business details"}</span><button className="primary-button" type="submit" disabled={pending || (!dirty && profileSaved)}>{busy === "save" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{busy === "save" ? "Saving details" : "Save business details"}</button></div>
                </form>
              </section>

              <section className="setup-panel settlement-panel"><div className="section-heading"><div><h2>Settlement wallet</h2><p>Your verified destination on Whitechain Sepolia.</p></div><span className="small-icon"><Wallet size={21} /></span></div><div className="wallet-address"><code>{merchant.settlementWallet}</code><a href={`https://explorer.testnet.whitechain.io/address/${merchant.settlementWallet}`} target="_blank" rel="noreferrer" aria-label="View settlement wallet on Whitechain Explorer"><ExternalLink size={16} /></a></div><div className="ownership-line"><ShieldCheck size={15} />Ownership proven<span>{timestamp(merchant.settlementProvenAt)}</span></div><p className="settlement-description">Your sign-in wallet is verified for this business. To use another wallet, connect it in your wallet extension and prove ownership here.</p><button className="secondary-button" type="button" disabled={pending || (ownerMatches && account.address?.toLowerCase() === merchant.settlementWallet.toLowerCase())} onClick={proveSettlement}>{busy === "settlement" ? <LoaderCircle className="spin" size={16} /> : <Fingerprint size={16} />}{busy === "settlement" ? "Check your wallet" : "Prove connected wallet"}</button></section>
            </>}
          </section>

          <aside className="setup-context" aria-label="Setup information">
            <section className="context-introduction"><div className="context-symbol" aria-hidden="true"><ArrowDownLeft size={26} strokeWidth={1.5} /></div><h2>Built around<br />your business.</h2><p>A clear path from a verified wallet to a business that’s ready for its next step.</p><ul className="trust-list"><li><Check size={15} /><span><strong>Your keys stay yours</strong>SettleKit never asks for a private key.</span></li><li><Check size={15} /><span><strong>One network, clear records</strong>USDT payments and refunds stay on Whitechain.</span></li><li><Check size={15} /><span><strong>Checks with clear limits</strong>Wallet screening has named sources and a stated freshness policy.</span></li></ul></section>
            {merchant && <section className={`screening-summary ${allowed ? "screening-allowed" : "screening-held"}`}><div className="screening-title">{allowed ? <ShieldCheck size={18} /> : <ShieldX size={18} />}<h3>Settlement checks</h3><button type="button" className="icon-button" disabled={pending || query.isFetching} onClick={refreshScreening} aria-label="Refresh settlement checks" title="Refresh settlement checks"><RefreshCw size={15} className={busy === "screen" ? "spin" : ""} /></button></div><span className={`screening-badge ${allowed ? "positive" : "caution"}`}>{statusLabel}</span><p>{allowed ? "No exact address match was found in the configured source." : screeningState === "blocked" ? "A configured hard denial prevents payment authorization. A merchant cannot override this result." : screeningState === "review_required" ? "This wallet needs review before any payment authorization." : "Current required evidence is unavailable or has expired. Payment authorization stays paused."}</p><dl><div><dt>Source</dt><dd>OFAC SDN · ETH identifiers</dd></div><div><dt>Last evaluated</dt><dd>{timestamp(source?.checkedAt ?? null)}</dd></div><div><dt>Source fetched</dt><dd>{timestamp(source?.sourceFetchedAt ?? null)}</dd></div><div><dt>Coverage</dt><dd>Exact address checks</dd></div></dl><p className="coverage-note">These checks do not establish lawful funds or trace their origin.</p></section>}
            <div className="test-boundary"><ShieldCheck size={16} /><p>This is a testnet setup. Payment processing is a later step; no funds are collected here.</p></div>
          </aside>
        </div>
        <footer className="workspace-footer"><span>SettleKit<span className="footer-separator">/</span>Business setup</span><span><LockKeyhole size={12} />Your configuration stays private</span></footer>
      </main>
    </div>
  </div>;
}
