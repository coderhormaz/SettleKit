import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

// Explicit HTTP fixtures exercise UI states only. They are not payment/testnet evidence.
const reference = 'phase-2-browser-fixture';
const checkout = {
  reference, amount_base_units: '25000000', merchant_name: 'Juniper Studio',
  merchant_wallet: '0x1111111111111111111111111111111111111111', status: 'open', payment_id: null,
  confirmation_stage: 'included_2_blocks', router: null, token: '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7',
  chain_id: 1874, expires_at: '2099-11-07T09:00:00.000Z', return_url: 'https://store.example/', delivery_status: null,
};
async function fixture(page: Page, value: Record<string, unknown>) {
  await page.route(`**/api/checkout/${reference}`, (route) => route.fulfill({ json: value }));
}

test('checkout has truthful unavailable setup and responsive receipt layouts', async ({ page }) => {
  await fixture(page, checkout);
  await page.goto(`/checkout/${reference}`);
  await expect(page.getByRole('heading', { name: 'Pay with your wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect wallet to continue' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Live payments are not available');
  await mkdir('.impeccable/review/phase-2', { recursive: true });
  for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('heading', { name: 'Juniper Studio' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/phase-2/checkout-${name}.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'Back to the store' }).focus();
  await expect(page.getByRole('link', { name: 'Back to the store' })).toBeFocused();
});

test('checkout reports missing wallet and stale status without a paid claim', async ({ page }) => {
  await fixture(page, { ...checkout, router: '0x2222222222222222222222222222222222222222' });
  await page.goto(`/checkout/${reference}`);
  await page.getByRole('button', { name: 'Connect wallet to continue' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('No compatible browser wallet');
  await page.route(`**/api/checkout/${reference}`, (route) => route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'The service is temporarily unavailable.' } } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Checkout is unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('submitted, accepted and review states stay distinct', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { ...checkout, tx_hash: `0x${'a'.repeat(64)}`, payment_id: 'payment-fixture' });
  await page.goto(`/checkout/${reference}`);
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay 25 USDT', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.impeccable/review/phase-2/checkout-pending-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Try payment again', exact: true }).click();
  await expect(page.getByText('A submitted transaction may still confirm.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Keep waiting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  await page.getByRole('button', { name: 'Try payment again', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new payment attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay with your wallet' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pay with your wallet' })).toBeVisible();
  await fixture(page, { ...checkout, status: 'accepted', payment_id: 'payment-fixture', delivery_status: 'pending' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible();
  await expect(page.getByText('This is soft confirmation, not finality.')).toBeVisible();
  await page.screenshot({ path: '.impeccable/review/phase-2/checkout-accepted-mobile.png', fullPage: true });
  await fixture(page, { ...checkout, status: 'orphaned', payment_id: 'payment-fixture', delivery_status: 'held' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Payment needs review' })).toBeVisible();
  await expect(page.getByText('Do not send a second payment.', { exact: false })).toBeVisible();
});

test('wallet proof and payment submission remain separate from observed acceptance', async ({ page }) => {
  const account = privateKeyToAccount(generatePrivateKey());
  const transactionHash = `0x${'c'.repeat(64)}` as Hex;
  let signedMessages = 0; let sentTransactions = 0; let submittedHints = 0;
  await page.exposeFunction('phase2WalletRequest', async (request: { method: string; params?: unknown[] }) => {
    if (['eth_accounts', 'eth_requestAccounts'].includes(request.method)) return [account.address];
    if (request.method === 'eth_chainId') return '0x752';
    if (['wallet_switchEthereumChain', 'wallet_addEthereumChain'].includes(request.method)) return null;
    if (['wallet_requestPermissions', 'wallet_getPermissions'].includes(request.method)) return [{ parentCapability: 'eth_accounts' }];
    if (request.method === 'personal_sign') { signedMessages++; return account.signMessage({ message: { raw: request.params![0] as Hex } }); }
    if (request.method === 'eth_signTypedData_v4') return account.signTypedData(JSON.parse(request.params![1] as string));
    if (request.method === 'eth_sendTransaction') { sentTransactions++; return transactionHash; }
    throw new Error(`Unsupported fixture wallet method ${request.method}`);
  });
  await page.addInitScript(() => {
    const bridge = window as unknown as { phase2WalletRequest: (request: unknown) => Promise<unknown>; ethereum: unknown };
    bridge.ethereum = { isMetaMask: true, request: (request: unknown) => bridge.phase2WalletRequest(request), on: () => {}, removeListener: () => {} };
  });
  await page.route('https://rpc.testnet.whitechain.io/**', async (route) => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    const requests = route.request().postDataJSON() as { id: number; method: string } | Array<{ id: number; method: string }>;
    function reply(request: { id: number; method: string }) {
      const result = request.method === 'eth_getBalance' ? '0x16345785d8a0000' : request.method === 'eth_chainId' ? '0x752' : request.method === 'eth_call' ? `0x${(25_000_000n).toString(16).padStart(64, '0')}` : '0x1';
      return { jsonrpc: '2.0', id: request.id, result };
    }
    await route.fulfill({ headers, json: Array.isArray(requests) ? requests.map(reply) : reply(requests) });
  });
  await fixture(page, { ...checkout, router: '0x2222222222222222222222222222222222222222' });
  await page.route(`**/api/checkout/${reference}/challenge`, (route) => route.fulfill({ json: { id: 'fixture-challenge', message: 'SettleKit checkout fixture ownership proof' } }));
  await page.route(`**/api/checkout/${reference}/authorize`, (route) => route.fulfill({ json: { router: '0x2222222222222222222222222222222222222222', signature: `0x${'d'.repeat(130)}`, authorization: { invoiceId: `0x${'e'.repeat(64)}`, evidence: `0x${'f'.repeat(64)}`, payer: account.address, merchant: checkout.merchant_wallet, token: checkout.token, amount: '25000000', epoch: '1', deadline: String(Math.floor(Date.now() / 1000) + 60) } } }));
  await page.route(`**/api/checkout/${reference}/submitted`, async (route) => { submittedHints++; expect(route.request().postDataJSON()).toEqual({ tx_hash: transactionHash }); await route.fulfill({ json: { submitted: true } }); });
  await page.goto(`/checkout/${reference}`);
  await page.getByRole('button', { name: 'Connect wallet to continue' }).click();
  await expect(page.getByRole('button', { name: 'Pay 25 USDT', exact: true })).toBeEnabled();
  expect(signedMessages).toBe(1); expect(sentTransactions).toBe(0);
  await page.getByRole('button', { name: 'Pay 25 USDT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
  expect(sentTransactions).toBe(1); expect(submittedHints).toBe(1);
  await expect(page.getByRole('heading', { name: 'Payment received' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
});

test('payment records render details, long identifiers and expired-session recovery', async ({ page }) => {
  const payment = { id: 'payment-fixture', reference, order_id: `order-${'long'.repeat(24)}`, amount_base_units: '25000000', status: 'accepted', confirmation_stage: 'included_2_blocks', delivery_status: 'pending', created_at: '2026-11-06T12:00:00.000Z', payer: '0x3333333333333333333333333333333333333333', tx_hash: `0x${'b'.repeat(64)}`, risk_state: 'allowed', state_version: 2 };
  await page.route('**/api/merchant/payments', (route) => route.fulfill({ json: { payments: [payment] } }));
  await page.route(`**/api/merchant/payments/${payment.id}`, (route) => route.fulfill({ json: { ...payment, timeline: [{ event_type: 'payment.accepted', status: 'pending', attempts: 1, error_code: null, state_version: 2, created_at: payment.created_at }] } }));
  await page.goto('/payments');
  await page.getByRole('button', { name: `View payment ${payment.order_id}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payment details' })).toBeVisible();
  await expect(page.getByText('Included · 2 blocks', { exact: true })).toBeVisible();
  for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/phase-2/payments-${name}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Close payment details' }).click();
  await expect(page.getByRole('heading', { name: 'Payment details' })).toHaveCount(0);
  await page.route('**/api/merchant/payments', (route) => route.fulfill({ status: 401, json: { error: { message: 'Sign in again.' } } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to view payments' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/');
});
