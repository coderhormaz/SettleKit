'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useConfig, useConnect, usePublicClient, useSignMessage, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi';
import { getAccount } from 'wagmi/actions';
import { hexToSignature, isAddress, type Address, type Hex } from 'viem';
import { ArrowLeft, ArrowRight, Check, CheckCheck, CircleAlert, ExternalLink, Fingerprint, Fuel, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { formatUsdt, USDT_ADDRESS, WHITECHAIN_CHAIN_ID } from '@settlekit/core';
import { routerAbi, transferWithAuthorizationTypes, usdtEip3009Domain } from '@settlekit/core/router';
import styles from './checkout.module.css';

type CheckoutData = {
  reference: string; amount_base_units: string; merchant_name: string; merchant_wallet: string;
  status: 'open' | 'accepted' | 'review' | 'orphaned' | 'expired' | 'pending'; payment_id: string | null;
  confirmation_stage: 'included_2_blocks'; router: string | null; token: string; chain_id: number;
  expires_at: string; return_url: string; delivery_status?: string | null; mode?: 'store' | 'collection';
  tx_hash?: Hex | null; sponsor_buyer_gas?: boolean;
};
type Authorization = { invoiceId: Hex; payer: Address; merchant: Address; token: Address; amount: string; evidence: Hex; epoch: string; deadline: string };
type AuthorizationResponse = { authorization: Authorization; signature: Hex; router: Address };
type TokenAuthorization = { validAfter: string; validBefore: string; nonce: Hex; v: number; r: Hex; s: Hex };
type Stage = 'idle' | 'connecting' | 'checking' | 'signing' | 'paying' | 'submitted';
class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }

async function api<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const result = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const value = await result.json() as T & { error?: { code?: string; message?: string } };
    if (!result.ok) throw new ApiError(result.status, value.error?.code ?? 'REQUEST_FAILED', value.error?.message ?? 'The request could not finish. Please try again.');
    return value;
  } catch (error) { if (error instanceof ApiError) throw error; throw new Error('We couldn’t reach checkout. Check your connection and try again.'); }
  finally { clearTimeout(timer); }
}
function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function walletError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (/reject|denied|cancel|user refused/i.test(text)) return 'The wallet request was cancelled. Check the current payment status before trying again.';
  if (/chain|network|switch|unknown chain|unrecognized chain/i.test(text)) return 'Switch your wallet to Whitechain Sepolia, then try again.';
  if (/insufficient|funds|balance/i.test(text)) return 'Your wallet needs enough test USDT for this payment, or test WBT if you pay network gas yourself.';
  if (/provider|connector.*not|no.*wallet|wallet.*not found|not installed/i.test(text)) return 'No compatible browser wallet was found. Open checkout in a browser with an EVM wallet extension (e.g. MetaMask/Rabby) and unlock it, then try again.';
  if (text.includes('Browser wallet provider not found') || text.includes('Wallet account unavailable')) return 'Your browser wallet could not be reached. Unlock your wallet extension, refresh the page, and try again. If you have multiple wallets, disable extras or open this page in the wallet’s browser.';
  return text && text.length < 180 ? text : 'The wallet request could not finish. Unlock your wallet, check the network, and try again.';
}
function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return (`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`) as Hex;
}

export function Checkout({ reference }: { reference: string }) {
  const config = useConfig(); const account = useAccount(); const client = usePublicClient({ chainId: WHITECHAIN_CHAIN_ID });
  const { connectAsync, connectors } = useConnect(); const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage(); const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [stage, setStage] = useState<Stage>('idle'); const [error, setError] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<AuthorizationResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [dismissedTxHash, setDismissedTxHash] = useState<Hex | null>(null);
  const [retryConfirmation, setRetryConfirmation] = useState(false); const [retryChecking, setRetryChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null); const inFlight = useRef(false);
  const basePath = `/api/checkout/${encodeURIComponent(reference)}`;
  const query = useQuery({ queryKey: ['checkout', reference], queryFn: () => api<CheckoutData>(basePath), refetchInterval: 5_000, refetchOnWindowFocus: 'always', retry: false });
  const checkout = query.data;
  const amount = checkout ? formatUsdt(checkout.amount_base_units) : '—';
  const busy = !['idle', 'submitted'].includes(stage);
  const terminal = !!checkout && ['accepted', 'review', 'orphaned', 'expired'].includes(checkout.status);
  const submittedHash = txHash ?? checkout?.tx_hash ?? null;
  const pending = !!(submittedHash && submittedHash !== dismissedTxHash) || stage === 'submitted' || checkout?.status === 'pending';
  const configured = !!checkout?.router && isAddress(checkout.router) && checkout.chain_id === WHITECHAIN_CHAIN_ID && checkout.token.toLowerCase() === USDT_ADDRESS.toLowerCase();
  const expired = !!checkout && Date.parse(checkout.expires_at) <= Date.now();
  const authorizationCurrent = !!authorization && !query.isError && authorization.authorization.payer.toLowerCase() === account.address?.toLowerCase() && BigInt(authorization.authorization.deadline) > BigInt(Math.floor(now / 1000) + 5);
  const sponsored = !!checkout?.sponsor_buyer_gas;

  useEffect(() => { setAuthorization(null); }, [account.address, account.chainId]);
  useEffect(() => { if (checkout?.status === 'accepted') setStage('idle'); }, [checkout?.status]);
  useEffect(() => {
    if (!authorization) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [authorization]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`settlekit:submitted:${reference}`);
      const dismissed = sessionStorage.getItem(`settlekit:dismissed:${reference}`);
      if (dismissed && /^0x[0-9a-fA-F]{64}$/.test(dismissed)) setDismissedTxHash(dismissed as Hex);
      if (saved && saved !== dismissed && /^0x[0-9a-fA-F]{64}$/.test(saved)) setTxHash(saved as Hex);
    } catch { /* Server observations still determine payment state when local storage is unavailable. */ }
  }, [reference]);

  async function walletAddress(): Promise<Address> {
    let account = getAccount(config).address;
    if (!account || !getAccount(config).isConnected) {
      const available = connectors.length ? connectors : [];
      let lastError: unknown;
      for (const connector of available) {
        try {
          const result = await connectAsync({ connector, chainId: WHITECHAIN_CHAIN_ID });
          account = result.accounts[0];
          if (account) break;
        } catch (cause) {
          lastError = cause;
          const text = cause instanceof Error ? cause.message : '';
          if (/reject|denied|cancel|user refused/i.test(text)) throw cause;
        }
      }
      if (!account) {
        if (lastError) throw lastError;
        throw new Error('Browser wallet provider not found');
      }
    }
    if (getAccount(config).chainId !== WHITECHAIN_CHAIN_ID) {
      try { await switchChainAsync({ chainId: WHITECHAIN_CHAIN_ID }); }
      catch (cause) {
        const text = cause instanceof Error ? cause.message : '';
        if (/reject|denied|cancel/i.test(text)) throw new Error('Switch your wallet to Whitechain Sepolia to continue.');
        throw cause;
      }
    }
    const current = getAccount(config).address;
    if (!current) throw new Error('Wallet account unavailable');
    return current;
  }
  function assertWallet(payer: string) {
    const current = getAccount(config);
    if (current.address?.toLowerCase() !== payer.toLowerCase() || current.chainId !== WHITECHAIN_CHAIN_ID) throw new Error('Your wallet or network changed. Verify your wallet again before paying.');
  }
  function validateAuthorization(result: AuthorizationResponse, payer: Address) {
    const auth = result.authorization;
    if (!checkout || !isAddress(result.router) || result.router.toLowerCase() !== checkout.router?.toLowerCase() || auth.payer.toLowerCase() !== payer.toLowerCase() || auth.merchant.toLowerCase() !== checkout.merchant_wallet.toLowerCase() || auth.token.toLowerCase() !== USDT_ADDRESS.toLowerCase() || auth.amount !== checkout.amount_base_units || !/^0x[0-9a-fA-F]{64}$/.test(auth.invoiceId) || !/^0x[0-9a-fA-F]{64}$/.test(auth.evidence) || !/^\d+$/.test(auth.epoch) || !/^\d+$/.test(auth.deadline)) throw new Error('This payment authorization does not match checkout. Reload before continuing.');
    if (BigInt(auth.deadline) <= BigInt(Math.floor(Date.now() / 1000) + 5)) throw new Error('This wallet check expired. Verify your wallet again to continue.');
  }
  async function authorize(payer: Address) {
    const challenge = await api<{ id: string; message: string }>(`${basePath}/challenge`, { address: payer });
    const signature = await signMessageAsync({ account: payer, message: challenge.message });
    assertWallet(payer);
    const result = await api<AuthorizationResponse>(`${basePath}/authorize`, { id: challenge.id, signature });
    validateAuthorization(result, payer); setAuthorization(result); return result;
  }
  async function signTokenAuthorization(auth: AuthorizationResponse): Promise<TokenAuthorization> {
    const validAfter = '0';
    const validBefore = String(Math.floor(Date.now() / 1000) + 600);
    const nonce = randomNonce();
    const sig = await signTypedDataAsync({
      domain: usdtEip3009Domain(WHITECHAIN_CHAIN_ID, USDT_ADDRESS),
      types: transferWithAuthorizationTypes,
      primaryType: 'TransferWithAuthorization',
      message: { from: auth.authorization.payer, to: auth.authorization.merchant, value: BigInt(auth.authorization.amount), validAfter: BigInt(validAfter), validBefore: BigInt(validBefore), nonce },
      account: auth.authorization.payer,
    });
    const { v, r, s } = hexToSignature(sig);
    return { validAfter, validBefore, nonce, v: Number(v), r, s };
  }
  async function noteSubmitted(hash: Hex) {
    setTxHash(hash); setDismissedTxHash(null); setStage('submitted');
    try { sessionStorage.setItem(`settlekit:submitted:${reference}`, hash); sessionStorage.removeItem(`settlekit:dismissed:${reference}`); } catch { /* Server observations still determine payment state. */ }
    try { await api(`${basePath}/submitted`, { tx_hash: hash }); }
    catch { setError('Your transaction was submitted, but status reporting could not connect. Do not pay again; keep the transaction link and refresh the status.'); }
    await query.refetch();
  }
  async function retryPayment() {
    if (inFlight.current || retryChecking || !checkout || checkout.status !== 'open') return;
    inFlight.current = true; setRetryChecking(true); setError(null);
    try {
      const latest = await query.refetch();
      if (latest.error || !latest.data || latest.data.status !== 'open' || Date.parse(latest.data.expires_at) <= Date.now()) throw new Error('This checkout cannot start another attempt. Review its latest payment status.');
      const previousHash = latest.data.tx_hash ?? submittedHash;
      setDismissedTxHash(previousHash); setTxHash(null); setAuthorization(null); setStage('idle');
      setRetryConfirmation(false); setHint(null);
      try { sessionStorage.removeItem(`settlekit:submitted:${reference}`); if (previousHash) sessionStorage.setItem(`settlekit:dismissed:${reference}`, previousHash); } catch { /* dismissal still applies for this page session */ }
    } catch (cause) { setError(walletError(cause)); }
    finally { inFlight.current = false; setRetryChecking(false); }
  }
  async function run(action: 'verify' | 'pay' | 'walletPay') {
    if (inFlight.current || !checkout || !client || !configured || terminal || pending) return;
    inFlight.current = true; setError(null); setHint(null);
    try {
      setStage('connecting'); const payer = await walletAddress();
      const latest = await query.refetch();
      if (latest.error || !latest.data || latest.data.status !== 'open' || Date.parse(latest.data.expires_at) <= Date.now()) throw new Error('This checkout is no longer available for a new payment. Review its current status.');
      if (action === 'verify') {
        const balance = await client.readContract({ address: USDT_ADDRESS, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [payer] });
        if (balance < BigInt(checkout.amount_base_units)) throw new Error('Your wallet needs enough test USDT for this payment.');
        setStage('checking'); await authorize(payer);
        setHint(sponsored ? 'Your wallet passed the configured checks. You can pay with sponsored gas, or pay network gas yourself if needed.' : 'Your wallet passed the configured checks. Sign the payment authorization to complete the payment.');
      } else {
        let result = authorization;
        if (!result || BigInt(result.authorization.deadline) <= BigInt(Math.floor(Date.now() / 1000) + 15)) { setStage('checking'); result = await authorize(payer); }
        validateAuthorization(result, payer); assertWallet(payer);
        setStage('signing');
        const tokenAuthorization = await signTokenAuthorization(result);
        assertWallet(payer);
        if (action === 'pay' && sponsored) {
          setStage('paying');
          try {
            const relayed = await api<{ tx_hash: Hex }>(`${basePath}/relay`, { authorization: result.authorization, signature: result.signature, tokenAuthorization });
            await noteSubmitted(relayed.tx_hash);
            return;
          } catch (cause) {
            if (cause instanceof ApiError && cause.code === 'SPONSOR_UNAVAILABLE') throw new Error('Sponsored gas is temporarily unavailable. Use “Pay with my wallet gas” if your wallet has test WBT.');
            throw cause;
          }
        } else {
          const gas = await client.getBalance({ address: payer });
          if (gas === 0n) throw new Error('Your wallet needs test WBT for network gas to submit this payment.');
          setStage('paying');
          const auth = result.authorization;
          const hash = await writeContractAsync({
            account: payer, chainId: WHITECHAIN_CHAIN_ID, address: result.router, abi: routerAbi,
            functionName: 'payWithTransferAuthorization',
            args: [
              { ...auth, amount: BigInt(auth.amount), epoch: BigInt(auth.epoch), deadline: BigInt(auth.deadline) },
              result.signature,
              { validAfter: BigInt(tokenAuthorization.validAfter), validBefore: BigInt(tokenAuthorization.validBefore), nonce: tokenAuthorization.nonce, v: tokenAuthorization.v, r: tokenAuthorization.r as Hex, s: tokenAuthorization.s as Hex },
            ],
          });
          await noteSubmitted(hash);
        }
      }
    } catch (cause) { setError(walletError(cause)); }
    finally { inFlight.current = false; setStage((value) => value === 'submitted' ? value : 'idle'); }
  }

  const accepted = checkout?.status === 'accepted' && !query.isError;
  const held = checkout?.status === 'review' || checkout?.status === 'orphaned';
  const canPay = authorizationCurrent && !busy && configured && !query.isError && !terminal && !pending && !expired;
  const loadingLabel = stage === 'connecting' ? 'Connecting to Whitechain…' : stage === 'checking' ? 'Verify the message in your wallet…' : stage === 'signing' ? 'Sign the payment authorization in your wallet…' : 'Submitting your payment…';

  return <div className={styles.page}>
    <a className="skip-link" href="#checkout-main">Skip to checkout</a>
    <header className={styles.header}><a href="/" className={styles.brand} aria-label="SettleKit home"><span className={styles.brandMark}><ArrowRight size={19} /></span>SettleKit</a><span className={styles.network}><span />Whitechain Sepolia <span className={styles.testTag}>Testnet</span></span></header>
    <main id="checkout-main" className={styles.main}>
      <div className={styles.intro}><h1>Secure checkout</h1><span><LockKeyhole size={14} /> Direct to the business wallet</span></div>
      {query.isPending ? <section className={styles.loading} aria-live="polite"><LoaderCircle className="spin" size={25} /><h2>Loading your checkout</h2><p>Checking the amount and payment status.</p></section> : !checkout ? <section className={styles.unavailable}><CircleAlert size={26} /><h2>{query.error instanceof ApiError && query.error.status === 404 ? 'Checkout not found' : 'Checkout is unavailable'}</h2><p>{query.error instanceof Error ? query.error.message : 'Return to the business and open a new checkout.'}</p><button className="secondary-button" onClick={() => void query.refetch()}><RefreshCw size={15} />Try again</button></section> : <div className={styles.grid}>
        <section className={styles.receipt} aria-labelledby="receipt-title"><div className={styles.merchantSymbol}>{checkout.merchant_name.slice(0, 1).toUpperCase() || 'S'}</div><p className={styles.payTo}>Payment to</p><h2 id="receipt-title">{checkout.merchant_name || 'Business'}</h2><div className={styles.amount}>{amount}<span>USDT</span></div><p className={styles.currencyNote}>Test Tether USD · Whitechain Sepolia</p><dl className={styles.details}><div><dt>Network</dt><dd>Whitechain Sepolia</dd></div><div><dt>Payment token</dt><dd>USDT · 6 decimals</dd></div><div><dt>Amount due</dt><dd>{amount} USDT</dd></div></dl><div className={styles.destination}><span>Settlement wallet</span><a href={`https://explorer.testnet.whitechain.io/address/${checkout.merchant_wallet}`} target="_blank" rel="noreferrer"><code>{checkout.merchant_wallet}</code><ExternalLink size={14} /></a></div><div className={styles.receiptFoot}><ShieldCheck size={17} /><p>Payment goes directly to this business. SettleKit does not hold your USDT.{sponsored ? ' Network gas can be sponsored for this checkout.' : ''}</p></div></section>
        <section className={styles.actionPanel} aria-labelledby="payment-title">
          <div className={styles.panelHeading}><h2 id="payment-title">{query.isError ? 'Current status unavailable' : accepted ? 'Payment received' : held ? 'Payment needs review' : pending ? 'Confirming your payment' : expired || checkout.status === 'expired' ? 'Checkout expired' : 'Pay with your wallet'}</h2><span className={styles.iconCircle}>{accepted ? <CheckCheck size={20} /> : <Wallet size={20} />}</span></div>
          <p className={styles.panelDescription}>{accepted ? 'The payment was verified on Whitechain. Store delivery is tracked separately below.' : held ? 'This payment is on hold. The business must review the current chain or eligibility state before delivery.' : pending ? 'Your wallet sent a transaction. We are checking its onchain evidence; please do not pay again.' : expired || checkout.status === 'expired' ? 'This checkout can no longer authorize a new payment. Return to the store for a new checkout.' : sponsored ? 'Connect a wallet with test USDT. Network gas can be sponsored; no separate USDT approval transaction is needed.' : 'Connect a wallet with test USDT. No separate USDT approval transaction is needed; your wallet signs the payment and pays network gas.'}</p>
          {query.isError && <div className={styles.warning} role="alert"><CircleAlert size={17} /><p>Current status could not refresh. Check your connection and refresh before taking another action.</p></div>}
          {error && <div className={styles.warning} role="alert"><CircleAlert size={17} /><p>{error}</p></div>}
          {hint && authorizationCurrent && !error && !pending && !terminal && <div className={styles.feedback} role="status"><ShieldCheck size={17} /><p>{hint}</p></div>}
          {authorization && !authorizationCurrent && !query.isError && !error && !pending && !terminal && !busy && <div className={styles.warning} role="status"><RefreshCw size={17} /><p>Your wallet check expired. Verify it again for a current payment authorization.</p></div>}
          {accepted ? <div className={styles.accepted} role="status"><span><Check size={26} /></span><strong>{amount} USDT received</strong><p>Included with two block confirmations.<br />This is soft confirmation, not finality.</p></div> : held ? <div className={styles.warning}><CircleAlert size={18} /><p>Do not send a second payment. Keep your transaction reference and contact the business.</p></div> : pending ? <div className={styles.pending} role="status"><LoaderCircle className="spin" size={23} /><strong>Waiting for verified confirmation</strong><p>Closing this page does not cancel a transaction.</p></div> : !terminal && !expired ? <>
            <ol className={styles.steps}><li className={authorizationCurrent ? styles.doneStep : styles.activeStep}><span className={styles.iconCircle}>{authorizationCurrent ? <Check size={13} /> : <Fingerprint size={15} />}</span><div><strong>Verify your wallet</strong><p>Sign a message for required checks.</p></div></li><li className={authorizationCurrent ? styles.activeStep : ''}><span className={styles.iconCircle}>{sponsored ? <Fuel size={15} /> : <Wallet size={15} />}</span><div><strong>{sponsored ? 'Sign and pay' : 'Sign and send payment'}</strong><p>{sponsored ? 'Sign the payment authorization. Sponsored gas can submit it; fallback uses your wallet gas.' : 'Sign the payment authorization and submit the payment. No USDT approval transaction is needed.'}</p></div></li></ol>
            {!configured && <div className={styles.warning} role="status"><CircleAlert size={17} /><p>Live payments are not available for this checkout yet. Nothing can be sent until payment setup is verified.</p></div>}
            {!authorizationCurrent ? <button className={`primary-button ${styles.payButton}`} disabled={busy || !configured || query.isError} onClick={() => void run('verify')}>{busy ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />}{busy ? loadingLabel : (account.isConnected ? 'Verify wallet & check eligibility' : 'Connect wallet to continue')}{!busy && <ArrowRight size={16} />}</button>
              : sponsored ? <><button className={`primary-button ${styles.payButton}`} disabled={!canPay} onClick={() => void run('pay')}>{busy && stage !== 'idle' ? <LoaderCircle className="spin" size={17} /> : <Fuel size={17} />}{busy ? loadingLabel : `Pay ${amount} USDT with sponsored gas`}{!busy && <ArrowRight size={16} />}</button><button className="secondary-button" style={{ marginTop: 8, width: '100%' }} disabled={!canPay} onClick={() => void run('walletPay')}><Wallet size={16} />Pay with my wallet gas</button></>
              : <button className={`primary-button ${styles.payButton}`} disabled={!canPay} onClick={() => void run('walletPay')}>{busy ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />}{busy ? loadingLabel : `Pay ${amount} USDT`}{!busy && <ArrowRight size={16} />}</button>}
            {account.address && <p className={styles.connected}>Connected wallet <code title={account.address}>{short(account.address)}</code></p>}
          </> : null}
          {checkout.payment_id && <dl className={styles.statusList}><div><dt>Payment</dt><dd>{checkout.status === 'accepted' ? 'Received' : checkout.status}</dd></div><div><dt>{checkout.mode === 'collection' ? 'Collection record' : 'Store notification'}</dt><dd>{checkout.mode === 'collection' && checkout.delivery_status === 'delivered' ? 'Recorded' : checkout.delivery_status ?? 'Not delivered yet'}</dd></div></dl>}
          {(txHash || checkout.tx_hash) && <a className={styles.transaction} href={`https://explorer.testnet.whitechain.io/tx/${txHash ?? checkout.tx_hash}`} target="_blank" rel="noreferrer">View submitted transaction<ExternalLink size={14} /></a>}
          {(pending || terminal || query.isError) && <button className={`secondary-button ${styles.refresh}`} disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} className={query.isFetching ? 'spin' : ''} />Refresh payment status</button>}
          {pending && checkout.status === 'open' && !expired && !query.isError && <div className={styles.retryArea}>{retryConfirmation ? <div className={styles.retryConfirmation}><strong>Start another payment attempt?</strong><p>A submitted transaction may still confirm. Retrying does not cancel it. The SettleKit router accepts this invoice only once, so another attempt cannot charge it twice. Check the transaction first; network fees may still apply.</p><div><button className="secondary-button" disabled={retryChecking || query.isFetching} onClick={() => void retryPayment()}>{retryChecking && <LoaderCircle className="spin" size={14} />}Start a new payment attempt</button><button className="text-button" disabled={retryChecking} onClick={() => setRetryConfirmation(false)}>Keep waiting</button></div></div> : <button className="text-button" onClick={() => setRetryConfirmation(true)}>Try payment again</button>}</div>}
          <div className={styles.gasNote}><CircleAlert size={15} /><p>{sponsored ? 'Sponsored gas may be available for this checkout. If sponsor gas is unavailable, you can pay with your wallet gas (test WBT). No separate USDT approval is needed.' : 'Your wallet signs the payment authorization and submits it. Test WBT is needed for network gas. No separate USDT approval is needed.'}</p></div>
        </section>
      </div>}
      {checkout?.return_url && <a className={styles.back} href={checkout.return_url}><ArrowLeft size={15} />{accepted ? 'Return to the store' : 'Back to the store'}</a>}
      <footer className={styles.footer}><span><LockKeyhole size={13} />Powered by SettleKit</span><span>USDT on Whitechain · Test environment</span></footer>
    </main>
  </div>;
}
