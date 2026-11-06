import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { createDatabase } from '../../../packages/db/src/client.ts';
import { cleanupTestMerchants } from '../../../packages/db/test/cleanup.ts';
import { isEndpointTest, verifyWebhook } from '../../../packages/integration/src/index.ts';

config({ path: '.env', quiet: true });

async function installWallet(page: Page) {
  const account = privateKeyToAccount(generatePrivateKey());
  // Only signing requests cross this bridge. Private material stays in Node.
  await page.exposeFunction('dashboardWalletRequest', async (request: { method: string; params?: unknown[] }) => {
    if (['eth_accounts', 'eth_requestAccounts'].includes(request.method)) return [account.address];
    if (request.method === 'eth_chainId') return '0x752';
    if (['wallet_switchEthereumChain', 'wallet_addEthereumChain'].includes(request.method)) return null;
    if (['wallet_requestPermissions', 'wallet_getPermissions'].includes(request.method)) return [{ parentCapability: 'eth_accounts' }];
    if (request.method === 'personal_sign') return account.signMessage({ message: { raw: request.params![0] as Hex } });
    throw new Error('Unsupported dashboard test-wallet method.');
  });
  await page.addInitScript(() => {
    const bridge = window as unknown as { dashboardWalletRequest: (request: unknown) => Promise<unknown>; ethereum: unknown };
    bridge.ethereum = { isMetaMask: true, request: (request: unknown) => bridge.dashboardWalletRequest(request), on: () => {}, removeListener: () => {} };
  });
  return account.address.toLowerCase();
}

test('actual wallet-authenticated dashboard CRUD, public quote, scoped key, HMAC test, reports and cleanup', async ({ page }) => {
  test.setTimeout(180_000);
  if (process.env.TEST_DATABASE_ISOLATED !== 'true' || !process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) throw new Error('A separate isolated Neon test target is required.');
  const db = createDatabase(process.env.TEST_DATABASE_URL, 1);
  let ownerWallet: string | null = null; let merchantId: string | null = null; let webhookSecret = ''; let verifiedTests = 0; let unexpectedEvents = 0;
  const receiver = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/webhook') { response.writeHead(404).end(); return; }
    try {
      const chunks: Buffer[] = []; let length = 0;
      for await (const value of request) { const chunk = Buffer.from(value); length += chunk.byteLength; if (length > 32_768) throw new Error('Body too large'); chunks.push(chunk); }
      const raw = Buffer.concat(chunks);
      verifyWebhook(raw, String(request.headers['x-settlekit-timestamp'] ?? ''), String(request.headers['x-settlekit-signature'] ?? ''), webhookSecret);
      if (!isEndpointTest(raw)) { unexpectedEvents++; response.writeHead(409).end(); return; }
      verifiedTests++; response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted: true, test: true }));
    } catch { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Invalid signed test event' })); }
  });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening'); const address = receiver.address();
  if (!address || typeof address === 'string') throw new Error('Test receiver could not bind loopback.');
  const storeOrigin = `http://127.0.0.1:${address.port}`;
  try {
    ownerWallet = await installWallet(page); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
    await page.getByRole('button', { name: 'Connect & verify wallet' }).click();
    await page.getByLabel('Business name').fill('Juniper Studio · isolated browser check'); await page.getByLabel('Website origin').fill(storeOrigin); await page.getByRole('button', { name: 'Save business details' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
    const identity = await page.request.get('/api/auth/me'); expect(identity.status()).toBe(200); merchantId = (await identity.json() as { merchant: { id: string } }).merchant.id;

    await page.goto('/dashboard/contacts'); await page.getByRole('button', { name: 'Add contact', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Add contact' }); await dialog.getByLabel('Contact name', { exact: true }).fill('Mira · isolated test contact'); await dialog.getByLabel('Email · optional').fill('mira@example.test'); await dialog.getByLabel('Private notes · optional').fill('Browser verification contact. No real customer data.'); await dialog.getByRole('button', { name: 'Add contact', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.reload(); await expect(page.getByText('Mira · isolated test contact', { exact: true })).toBeVisible();
    const contacts = await (await page.request.get('/api/operations/contacts?status=all')).json() as { items: Array<{ id: string; name: string }> }; const contactId = contacts.items.find(item => item.name === 'Mira · isolated test contact')?.id; if (!contactId) throw new Error('Created test contact was not persisted.');

    await page.goto('/dashboard/invoices'); await page.getByRole('button', { name: 'Create invoice', exact: true }).first().click(); dialog = page.getByRole('dialog', { name: 'Create invoice' }); await dialog.getByLabel('Invoice title').fill('Isolated studio invoice'); await dialog.getByLabel('Amount · USDT').fill('25.123456'); await dialog.getByLabel('Attach contact · optional').selectOption(contactId); await dialog.getByLabel('Private invoice notes · optional').fill('Private test invoice notes.'); await dialog.getByRole('button', { name: 'Create invoice' }).click(); await expect(dialog).toHaveCount(0); await page.reload(); await expect(page.getByText('Isolated studio invoice', { exact: true })).toBeVisible();
    const invoices = await (await page.request.get('/api/operations/invoices')).json() as { items: Array<{ id: string; reference: string; amountBaseUnits: string }> }; const invoice = invoices.items[0]; expect(invoice.amountBaseUnits).toBe('25123456');
    const publicInvoice = await page.request.get(`/api/collection/invoice/${invoice.reference}`); expect(publicInvoice.status()).toBe(200); const metadata = await publicInvoice.json() as Record<string, unknown>; expect('notes' in metadata || 'contactName' in metadata || 'contactSnapshot' in metadata || 'email' in metadata).toBe(false);
    await page.getByRole('button', { name: 'Print Isolated studio invoice' }).click(); await expect(page.getByRole('dialog').getByText('Private test invoice notes.', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Void Isolated studio invoice' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Void invoice', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect((await (await page.request.get(`/api/collection/invoice/${invoice.reference}`)).json() as { active: boolean }).active).toBe(false);

    await page.goto('/dashboard/contacts'); await page.getByRole('row').filter({ hasText: 'Mira · isolated test contact' }).getByRole('button', { name: 'Edit', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Edit contact' }); await dialog.getByLabel('Contact name', { exact: true }).fill('Mira · contact updated'); await dialog.getByRole('button', { name: 'Save contact' }).click(); await expect(dialog).toHaveCount(0); await page.reload(); await expect(page.getByText('Mira · contact updated', { exact: true })).toBeVisible();
    const historical = await (await page.request.get(`/api/operations/invoices/${invoice.id}`)).json() as { contactSnapshot: { name: string } }; expect(historical.contactSnapshot.name).toBe('Mira · isolated test contact');
    await page.getByRole('button', { name: 'Archive Mira · contact updated' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Archive contact' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/dashboard/links'); await page.getByRole('button', { name: 'Create payment link', exact: true }).first().click(); dialog = page.getByRole('dialog', { name: 'Create payment link' }); await dialog.getByLabel('Link title').fill('Isolated fixed USDT link'); await dialog.getByLabel('Amount · USDT').fill('25.123456'); await dialog.getByRole('button', { name: 'Create payment link' }).click(); await expect(dialog).toHaveCount(0); await page.reload();
    const links = await (await page.request.get('/api/operations/links?status=all')).json() as { items: Array<{ reference: string; amountBaseUnits: string }> }; const link = links.items[0]; expect(link.amountBaseUnits).toBe('25123456');
    await page.goto(`/pay/${link.reference}`); await expect(page.getByRole('heading', { name: 'Make a payment' })).toBeVisible(); await page.getByRole('button', { name: 'Continue to secure checkout' }).click(); await expect(page).toHaveURL(/\/checkout\/[a-f0-9]{64}$/); await expect(page.getByRole('heading', { name: 'Secure checkout' })).toBeVisible();
    const quote = await (await page.request.get(`/api/checkout/${page.url().split('/').at(-1)}`)).json() as { amount_base_units: string; merchant_wallet: string; status: string }; expect(quote.amount_base_units).toBe('25123456'); expect(quote.merchant_wallet.toLowerCase()).toBe(ownerWallet); expect(quote.status).toBe('open');
    await page.goto('/dashboard/links'); await page.getByRole('button', { name: 'Deactivate Isolated fixed USDT link' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Deactivate link' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect((await (await page.request.get(`/api/collection/link/${link.reference}`)).json() as { active: boolean }).active).toBe(false);

    await page.goto('/dashboard/developers'); await page.getByRole('button', { name: 'Create key', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Create server API key' }); await dialog.getByLabel('Key name').fill('Read-only isolated test key'); await dialog.getByRole('checkbox', { name: 'Create checkouts', exact: false }).uncheck(); const keyResponse = page.waitForResponse(response => response.url().endsWith('/api/operations/keys') && response.request().method() === 'POST'); await dialog.getByRole('button', { name: 'Create API key' }).click(); const keyResult = await (await keyResponse).json() as { item: { id: string }; key: string }; if (!keyResult.key) throw new Error('One-time test key was not returned.'); await page.getByRole('dialog', { name: 'Save your new server key' }).getByRole('button', { name: 'I have saved it' }).click();
    const keyHeaders = { Authorization: `Bearer ${keyResult.key}` }; const missingPaymentPath = `/api/v1/payments/${randomUUID()}/eligibility`;
    expect((await page.request.get(missingPaymentPath, { headers: keyHeaders })).status()).toBe(404); expect((await page.request.post('/api/v1/checkouts', { headers: { ...keyHeaders, 'Idempotency-Key': randomUUID() }, data: { order_id: randomUUID(), amount_base_units: '25000000', return_url: `${storeOrigin}/return` } })).status()).toBe(403);
    await page.getByRole('button', { name: 'Revoke Read-only isolated test key' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Revoke key' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect((await page.request.get(missingPaymentPath, { headers: keyHeaders })).status()).toBe(401);

    await page.goto('/dashboard/webhooks'); await page.getByRole('button', { name: 'Configure endpoints' }).click(); dialog = page.getByRole('dialog', { name: 'Configure your store endpoints' }); await dialog.getByLabel('Webhook receiver URL').fill(`${storeOrigin}/webhook`); await dialog.getByLabel('Authenticated order API base URL').fill(`${storeOrigin}/orders`); await dialog.getByLabel('Order-read secret', { exact: true }).fill(randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')); const configResponse = page.waitForResponse(response => response.url().endsWith('/api/operations/webhooks') && response.request().method() === 'PATCH'); await dialog.getByRole('button', { name: 'Save endpoints' }).click(); const configuration = await (await configResponse).json() as { secret: string }; if (!configuration.secret) throw new Error('One-time test webhook secret was not returned.'); webhookSecret = configuration.secret; await page.getByRole('dialog', { name: 'Save your webhook signing secret' }).getByRole('button', { name: 'I have saved it' }).click();
    await page.getByRole('button', { name: 'Send test event' }).click(); await expect(page.getByText('Webhook configuration test', { exact: true })).toBeVisible(); expect(verifiedTests).toBe(1); expect(unexpectedEvents).toBe(0); const testHistory = await (await page.request.get('/api/operations/webhooks')).json() as { items: Array<{ status: string }> }; expect(testHistory.items[0].status).toBe('delivered');

    await page.goto('/dashboard/settings'); await page.getByRole('button', { name: 'Pause new payments' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Pause payments', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await page.reload(); await expect(page.getByRole('button', { name: 'Resume new payments' })).toBeVisible(); await page.getByRole('button', { name: 'Resume new payments' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Resume payments', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/dashboard/reports'); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download CSV' }).click(); const download = await downloadPromise; const downloadPath = await download.path(); if (!downloadPath) throw new Error('CSV download was not saved.'); expect((await readFile(downloadPath, 'utf8')).split('\r\n')[0]).toContain('net_base_units');
    const audit = await (await page.request.get('/api/operations/audit?pageSize=50')).json() as { total: number; items: Array<{ kind: string; metadata: Record<string, unknown> }> }; expect(audit.total).toBeGreaterThanOrEqual(8); expect(JSON.stringify(audit.items).includes(keyResult.key) || JSON.stringify(audit.items).includes(webhookSecret)).toBe(false);

    await mkdir('.impeccable/review/dashboard', { recursive: true });
    for (const section of ['overview', 'links', 'invoices', 'webhooks'] as const) {
      await page.goto(`/dashboard/${section}`); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await expect(page.getByText('Loading your records…', { exact: true })).toHaveCount(0);
      for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) { await page.setViewportSize({ width, height }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/dashboard/real-${section}-${name}.png`, fullPage: true }); }
    }
    await page.goto('/dashboard/contacts'); await page.getByRole('button', { name: 'Add contact', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Add contact' })).toBeVisible(); await page.screenshot({ path: '.impeccable/review/dashboard/real-contact-form-mobile.png', fullPage: true }); await page.keyboard.press('Escape');
    await writeFile('.impeccable/review/dashboard/real-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Actual wallet-signature login, gateway HTTP API and isolated Neon persistence; signed loopback endpoint test. No payment transaction or Arkiv write claimed.', checks: ['contact create/edit/archive/reload and historical invoice snapshot', 'exact invoice/link base units and private/public projection', 'public link creates real immutable checkout', 'invoice void/link deactivate', 'scoped API read, denied create and immediate revoke', 'actual HMAC endpoint.test delivery with no fulfillment', 'pause/resume persistence', 'CSV HTTP download and scrubbed audit'], verifiedNonfinancialWebhookTests: verifiedTests, fundedEvidence: 'pending user-deferred funding', secretsCaptured: false }, null, 2) + '\n');
  } finally {
    receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve()));
    try { if (!merchantId && ownerWallet) merchantId = (await db.pool.query<{ id: string }>('select id from merchants where owner_wallet=$1', [ownerWallet])).rows[0]?.id ?? null; if (merchantId) await cleanupTestMerchants(db, [merchantId]); }
    finally { await db.pool.end(); }
  }
});
