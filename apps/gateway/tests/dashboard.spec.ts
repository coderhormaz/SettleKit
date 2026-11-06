import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Explicit HTTP fixtures prove interface behavior only. Database/testnet evidence is separate.
const now = '2026-11-06T09:00:00.000Z';
const screening = { state: 'allowed', checkedAt: now, expiresAt: '2099-11-06T09:00:00.000Z', sourceFetchedAt: now, sourceHash: 'fixture-source-hash', sourceAgeMs: 1000, reasonCodes: [] };
const merchant = { id: 'merchant-fixture', displayName: 'Juniper Studio', websiteOrigin: 'https://store.example', ownerWallet: `0x${'1'.repeat(40)}`, settlementWallet: `0x${'1'.repeat(40)}`, settlementProvenAt: now, version: 1, screening };
const payment = { id: 'payment-fixture', reference: 'checkout-fixture', orderId: 'Juniper design consultation', amountBaseUnits: '25000000', refundedBaseUnits: '5000000', status: 'accepted', confirmationStage: 'included_2_blocks', deliveryStatus: 'pending', riskState: 'allowed', payer: `0x${'2'.repeat(40)}`, merchantWallet: merchant.settlementWallet, txHash: `0x${'b'.repeat(64)}`, createdAt: now, sourceTime: now, stateVersion: 3 };

async function fixtures(page: Page) {
  const state = {
    contacts: [{ id: 'contact-fixture', name: 'Mira Shah', email: 'mira@example.test', notes: 'Private studio contact.', archived: false, version: 1, createdAt: now, updatedAt: now }],
    links: [{ id: 'link-fixture', reference: 'link-reference', title: 'Design consultation', amountBaseUnits: '25000000', expiresAt: null as string | null, active: true, version: 1, url: '/pay/link-reference', createdAt: now, paymentCount: 1 }],
    invoices: [{ id: 'invoice-fixture', reference: 'invoice-reference', title: 'November consultation', amountBaseUnits: '25000000', contactId: 'contact-fixture', contactName: 'Mira Shah', dueDate: '2026-11-20', notes: 'Private consultation details.', status: 'unpaid', version: 1, url: '/invoice/invoice-reference', createdAt: now, paidBaseUnits: '0', refundedBaseUnits: '0' }],
    keys: [{ id: 'key-fixture', name: 'Store server', prefix: 'fixture_key', scopes: ['checkout:create', 'payment:read'], revokedAt: null as string | null, createdAt: now, lastUsedAt: now }],
    config: { webhookUrl: 'https://store.example/api/webhook', orderApiUrl: 'https://store.example/api/orders', configured: true, active: true, secretConfigured: true },
    tests: [] as Array<{ id: string; status: string; attempts: number; errorCode: null; createdAt: string }>,
    deliveries: [{ id: 'delivery-fixture', paymentId: payment.id, stateVersion: 3, eventType: 'payment.accepted', status: 'dead', attempts: 5, errorCode: 'ENDPOINT_TIMEOUT', createdAt: now, replayCount: 0 }],
    settings: { paused: false, version: 1 }, sessions: [{ id: 'session-current', createdAt: now, expiresAt: '2099-11-06T09:00:00.000Z', current: true }, { id: 'session-other', createdAt: now, expiresAt: '2099-11-06T09:00:00.000Z', current: false }],
    notes: [] as Array<{ id: string; note: string; createdAt: string }>, mutationCount: 0,
  };
  await page.route('**/api/auth/me', route => route.fulfill({ json: { merchant } }));
  await page.route('**/api/merchant', route => route.fulfill({ json: { merchant: { ...merchant, ...route.request().postDataJSON() } } }));
  await page.route('**/api/refunds?*', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/operations/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname.replace('/api/operations', ''); const method = route.request().method(); const body = method === 'GET' ? {} : route.request().postDataJSON() as Record<string, unknown>;
    const pageNumber = Number(url.searchParams.get('page') ?? 1); const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    function list<T>(items: T[]) { return { items, total: items.length, page: pageNumber, pageSize }; }
    let result: unknown;
    if (method !== 'GET') state.mutationCount++;
    if (path === '/overview') result = { grossBaseUnits: '25000000', refundedBaseUnits: '5000000', netBaseUnits: '20000000', paymentCount: 1, reviewCount: 1, notificationIssueCount: 1, unverifiedTimestampCount: 0, range: { from: url.searchParams.get('from') || '2026-10-08', to: url.searchParams.get('to') || '2026-11-06' }, series: [{ date: '2026-11-04', grossBaseUnits: '10000000', refundedBaseUnits: '0' }, { date: '2026-11-05', grossBaseUnits: '15000000', refundedBaseUnits: '0' }, { date: '2026-11-06', grossBaseUnits: '0', refundedBaseUnits: '5000000' }] };
    else if (path === '/payments') result = list([payment]);
    else if (path === `/payments/${payment.id}`) result = { item: payment, remainingRefundableBaseUnits: '20000000', timeline: [{ eventType: 'payment.accepted', status: 'pending', attempts: 1, errorCode: null, createdAt: now, stateVersion: 3 }] };
    else if (path === '/contacts' && method === 'GET') result = list(state.contacts.filter(item => !url.searchParams.get('search') || item.name.includes(url.searchParams.get('search')!)));
    else if (path === '/contacts' && method === 'POST') { const item = { id: 'contact-new', name: String(body.name), email: String(body.email ?? ''), notes: String(body.notes ?? ''), archived: false, version: 1, createdAt: now, updatedAt: now }; state.contacts.push(item); result = { item }; }
    else if (path.startsWith('/contacts/')) { const item = state.contacts.find(item => path.includes(item.id))!; if (method === 'GET') result = { item, invoices: state.invoices, payments: [payment], historyLimit: 100 }; else { if (path.endsWith('/archive')) item.archived = true; else Object.assign(item, body, { version: item.version + 1 }); result = { item }; } }
    else if (path === '/links' && method === 'GET') result = list(state.links);
    else if (path === '/links' && method === 'POST') { const item = { ...state.links[0], id: 'link-new', reference: 'new-reference', title: String(body.title), amountBaseUnits: String(body.amountBaseUnits), url: '/pay/new-reference', paymentCount: 0 }; state.links.push(item); result = { item }; }
    else if (path.startsWith('/links/')) { const item = state.links.find(item => path.includes(item.id))!; if (path.endsWith('/deactivate')) item.active = false; else Object.assign(item, body); result = { item }; }
    else if (path === '/invoices' && method === 'GET') result = list(state.invoices);
    else if (path === '/invoices' && method === 'POST') { const item = { ...state.invoices[0], id: 'invoice-new', title: String(body.title), amountBaseUnits: String(body.amountBaseUnits), notes: String(body.notes ?? ''), dueDate: String(body.dueDate ?? ''), contactId: String(body.contactId ?? ''), url: '/invoice/new-invoice', reference: 'new-invoice' }; state.invoices.push(item); result = { item }; }
    else if (path.startsWith('/invoices/')) { const item = state.invoices.find(item => path.includes(item.id))!; if (method === 'GET') result = { item, contactSnapshot: state.contacts[0], merchant }; else { item.status = 'void'; result = { item }; } }
    else if (path === '/keys' && method === 'GET') result = list(state.keys);
    else if (path === '/keys' && method === 'POST') { const item = { ...state.keys[0], id: 'key-new', name: String(body.name), scopes: body.scopes as string[], revokedAt: null }; state.keys.push(item); result = { item, key: 'fixture-only-key-never-a-real-credential' }; }
    else if (path.startsWith('/keys/')) { const item = state.keys.find(item => path.includes(item.id))!; item.revokedAt = now; result = path.endsWith('/rotate') ? { item, key: 'fixture-only-replacement-not-a-real-credential' } : { item }; }
    else if (path === '/webhooks' && method === 'GET') result = { config: state.config, ...list(state.tests) };
    else if (path === '/webhooks' && method === 'PATCH') { Object.assign(state.config, body); result = { config: state.config }; }
    else if (path === '/webhooks/test') { const item = { id: `test-${state.tests.length}`, status: 'delivered', attempts: 1, errorCode: null, createdAt: now }; state.tests.push(item); result = { item }; }
    else if (path === '/webhooks/rotate-secret') result = { secret: 'fixture-only-webhook-secret-not-a-real-credential' };
    else if (path === '/deliveries') result = list(state.deliveries);
    else if (path.endsWith('/replay')) { state.deliveries[0].replayCount++; state.deliveries[0].status = 'pending'; result = { item: state.deliveries[0] }; }
    else if (path === '/reviews') result = { ...list([{ id: payment.id, paymentId: payment.id, reference: payment.reference, orderId: payment.orderId, amountBaseUnits: payment.amountBaseUnits, status: 'review', riskState: 'review_required', refundHold: false, payer: payment.payer, merchantWallet: payment.merchantWallet, stateVersion: 3, createdAt: now, notes: state.notes }]), screening };
    else if (path === '/reviews/refresh') result = { screening };
    else if (path.endsWith('/notes')) { state.notes.push({ id: 'note-fixture', note: String(body.note), createdAt: now }); result = { item: {} }; }
    else if (path.endsWith('/resolve')) { await route.fulfill({ status: 409, json: { error: { code: 'REVIEW_NOT_ELIGIBLE', message: 'Current canonical and screening evidence does not permit resolution.' } } }); return; }
    else if (path === '/settings' && method === 'GET') result = { settings: state.settings, merchant, screening, sessions: state.sessions };
    else if (path === '/settings' && method === 'PATCH') { Object.assign(state.settings, body, { version: state.settings.version + 1 }); result = { settings: state.settings }; }
    else if (path.startsWith('/settings/sessions/')) { state.sessions = state.sessions.filter(item => path.endsWith('revoke-others') ? item.current : !path.includes(item.id)); result = { revoked: 1 }; }
    else if (path === '/audit') result = list([{ id: 'audit-fixture', kind: 'profile.saved', metadata: { fields: ['displayName', 'websiteOrigin'] }, createdAt: now }]);
    else if (path === '/reports.csv') { await route.fulfill({ contentType: 'text/csv', body: 'order,amount_base_units\nfixture,25000000\n' }); return; }
    else { await route.fulfill({ status: 404, json: { error: { code: 'FIXTURE_NOT_DEFINED', message: `No UI fixture for ${method} ${path}` } } }); return; }
    await route.fulfill({ json: result });
  });
  return state;
}

test('dashboard overview and payments render at desktop/tablet/mobile with actual navigation', async ({ page }) => {
  await fixtures(page); await mkdir('.impeccable/review/phase-3', { recursive: true }); await page.goto('/dashboard/overview');
  await expect(page.getByRole('heading', { name: 'Payment activity', exact: true })).toBeVisible();
  for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) { await page.setViewportSize({ width, height }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `.impeccable/review/phase-3/overview-${name}.png`, fullPage: true }); }
  await page.getByLabel('Workspace section').selectOption('payments'); await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `View payment ${payment.orderId}` }).click(); await expect(page.getByRole('dialog', { name: 'Payment details' })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true); await page.screenshot({ path: '.impeccable/review/phase-3/payment-detail-mobile.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('contacts validate, persist across reload, edit and confirm archive with keyboard focus', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/dashboard/contacts'); await page.getByRole('button', { name: 'Add contact', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Add contact' });
  await dialog.getByRole('button', { name: 'Add contact', exact: true }).click(); await expect(dialog.getByText('Complete this field.')).toBeVisible();
  await dialog.getByLabel('Contact name', { exact: true }).fill('Studio customer'); await dialog.getByLabel('Email · optional').fill('customer@example.test'); await dialog.getByLabel('Private notes · optional').fill('Private notes stay private.');
  await page.screenshot({ path: '.impeccable/review/phase-3/contact-form.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Add contact', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(state.contacts).toHaveLength(2); await page.reload(); await expect(page.getByText('Studio customer', { exact: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Studio customer' }); await row.getByRole('button', { name: 'Edit', exact: true }).click(); const edit = page.getByRole('dialog', { name: 'Edit contact' }); await edit.getByLabel('Contact name', { exact: true }).fill('Studio customer updated'); await edit.getByRole('button', { name: 'Save contact' }).click(); await expect(edit).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive Studio customer updated', exact: true }).click(); expect(state.contacts[1].archived).toBe(false); const confirm = page.getByRole('dialog', { name: 'Archive this contact?' }); await confirm.getByRole('button', { name: 'Keep current state' }).focus(); await page.keyboard.press('Shift+Tab'); await expect(confirm.getByRole('button', { name: 'Close dialog' })).toBeFocused(); await page.keyboard.press('Shift+Tab'); await expect(confirm.getByRole('button', { name: 'Archive contact' })).toBeFocused(); await confirm.getByRole('button', { name: 'Archive contact' }).click(); await expect(confirm).toHaveCount(0); expect(state.contacts[1].archived).toBe(true);
});

test('overview follow-up and private contact payment history are usable with nested detail focus',async({page})=>{
  await fixtures(page);await page.goto('/dashboard/overview');await expect(page.getByRole('link',{name:'1 payment in review'})).toHaveAttribute('href','/dashboard/risk');await expect(page.getByRole('link',{name:'1 failed notification'})).toHaveAttribute('href','/dashboard/webhooks');
  await page.goto('/dashboard/contacts');await page.getByRole('button',{name:/^Mira Shah/}).click();const history=page.getByRole('dialog',{name:'Contact history'});await expect(history.getByText('Payment history',{exact:true})).toBeVisible();
  for(const [name,width,height]of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]]as const){await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`.impeccable/review/phase-3/contact-history-${name}.png`,fullPage:true});}
  const open=history.getByRole('button',{name:/Juniper design consultation/});await open.click();const details=page.getByRole('dialog',{name:'Payment details'});await expect(details).toBeVisible();await details.getByRole('button',{name:'Close dialog'}).click();await expect(history).toBeVisible();await expect(open).toBeFocused();
});

test('refund requests bound amounts, reuse an ambiguous-save key and preserve original-wallet/cancellation states',async({page})=>{
  // Explicit HTTP fixture tests interface behavior; actual refund execution is
  // separately proved against the local EVM, canonical observer and real Neon.
  await fixtures(page);const keys:string[]=[];let created=false;const refund={id:'11111111-1111-4111-8111-111111111111',paymentId:payment.id,refundId:`0x${'c'.repeat(64)}`,amountBaseUnits:'5000000',status:'requested',version:1,submittedTxHash:null,reasonCode:null,createdAt:now};
  await page.route('**/api/refunds**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/api/refunds','');const method=route.request().method();
    if(method==='GET'){await route.fulfill({json:path?{...refund,payer:payment.payer,merchantWallet:payment.merchantWallet,originalAmountBaseUnits:'25000000',canonicalRefundedBaseUnits:'5000000',invoiceId:`0x${'a'.repeat(64)}`,authorizations:[],events:[]}:{items:created?[refund]:[]}});return;}
    if(path.endsWith('/cancel')){refund.status='cancelled';await route.fulfill({json:{cancelPending:false,message:'Cancellation verified against current evidence.'}});return;}
    const value=route.request().postDataJSON() as {amountBaseUnits:string;idempotencyKey:string};expect(value.amountBaseUnits).toBe('5000000');keys.push(value.idempotencyKey);created=true;
    if(keys.length===1){await route.fulfill({status:503,json:{error:{message:'Temporary fixture outage. Retry the same request.'}}});return;}await route.fulfill({json:refund});
  });
  await page.goto('/dashboard/payments');await page.getByRole('button',{name:`View payment ${payment.orderId}`}).click();const panel=page.getByRole('region',{name:'Refunds'});await panel.getByRole('button',{name:'Request refund',exact:true}).click();const request=page.getByRole('dialog',{name:'Request a refund'});
  await request.getByLabel('Refund amount (USDT)').fill('30');await request.getByRole('button',{name:'Save request and hold fulfillment'}).click();await expect(request.getByRole('alert')).toContainText('remaining refundable');expect(keys).toHaveLength(0);
  await request.getByLabel('Refund amount (USDT)').fill('5');await request.getByRole('button',{name:'Save request and hold fulfillment'}).click();await expect(request.getByRole('alert')).toContainText('Temporary fixture outage');await request.getByRole('button',{name:'Save request and hold fulfillment'}).click();await expect(request).not.toBeVisible();expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
  await expect(panel.getByRole('button',{name:'Connect original wallet'})).toBeVisible();await expect(panel.getByRole('definition').filter({hasText:payment.payer})).toBeVisible();await panel.getByRole('button',{name:/Cancel request/}).click();await expect(panel.getByRole('button',{name:'Connect original wallet'})).toHaveCount(0);await expect(panel.getByText('cancelled',{exact:true}).first()).toBeVisible();
});

test('fixed links and invoices preserve exact amounts and explicit deactivation/void', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/dashboard/links'); await page.getByRole('button', { name: 'Create payment link', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Create payment link' }); await dialog.getByLabel('Link title').fill('Precise amount link'); await dialog.getByLabel('Amount · USDT').fill('0.000001'); await dialog.getByRole('button', { name: 'Create payment link' }).click(); await expect(dialog).toHaveCount(0); expect(state.links[1].amountBaseUnits).toBe('1'); await page.reload(); await expect(page.getByText('Precise amount link', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deactivate Precise amount link' }).click(); expect(state.links[1].active).toBe(true); await page.getByRole('dialog').getByRole('button', { name: 'Deactivate link' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.links[1].active).toBe(false);
  await page.goto('/dashboard/invoices'); await page.getByRole('button', { name: 'Create invoice', exact: true }).click(); const invoice = page.getByRole('dialog', { name: 'Create invoice' }); await invoice.getByLabel('Invoice title').fill('Private invoice'); await invoice.getByLabel('Amount · USDT').fill('25'); await invoice.getByLabel('Attach contact · optional').selectOption('contact-fixture'); await invoice.getByLabel('Private invoice notes · optional').fill('Only on the authenticated invoice.'); await invoice.getByRole('button', { name: 'Create invoice' }).click(); await expect(invoice).toHaveCount(0); expect(state.invoices[1].amountBaseUnits).toBe('25000000');
  await page.getByRole('button', { name: 'Print Private invoice' }).click(); await expect(page.getByRole('dialog').getByText('Only on the authenticated invoice.')).toBeVisible(); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Void Private invoice' }).click(); expect(state.invoices[1].status).toBe('unpaid'); await page.getByRole('dialog').getByRole('button', { name: 'Void invoice' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.invoices[1].status).toBe('void');
});

test('keys reveal once, webhook test/replay and settings mutations use real actions', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/dashboard/developers'); await page.getByRole('button', { name: 'Create key', exact: true }).click(); const form = page.getByRole('dialog', { name: 'Create server API key' }); await form.getByLabel('Key name').fill('New server key'); await form.getByRole('button', { name: 'Create API key' }).click(); const secret = page.getByRole('dialog', { name: 'Save your new server key' }); await expect(secret).toContainText('fixture-only-key-never-a-real-credential'); await secret.getByRole('button', { name: 'I have saved it' }).click(); await page.reload(); await expect(page.getByText('fixture-only-key-never-a-real-credential')).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke New server key' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Revoke key' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.keys[1].revokedAt).toBe(now);
  await page.goto('/dashboard/webhooks'); await page.getByRole('button', { name: 'Send test event' }).click(); await expect(page.getByText('Webhook configuration test', { exact: true })).toBeVisible(); expect(state.tests).toHaveLength(1); await page.getByRole('button', { name: 'Replay (0/3)' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Request eligible replay' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.deliveries[0].replayCount).toBe(1);
  await page.goto('/dashboard/settings'); await page.getByRole('button', { name: 'Pause new payments' }).click(); expect(state.settings.paused).toBe(false); await page.getByRole('dialog').getByRole('button', { name: 'Pause payments', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.settings.paused).toBe(true); await page.getByRole('button', { name: 'Revoke other sessions' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Revoke other sessions' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.sessions).toHaveLength(1);
});

test('risk cannot override an ineligible review; reports download and session errors recover', async ({ page }) => {
  const state = await fixtures(page); await page.goto('/dashboard/risk'); await page.getByRole('button', { name: payment.orderId }).click(); const review = page.getByRole('dialog', { name: 'Payment review' }); await review.getByLabel('Add a private note').fill('Current evidence was reviewed.'); await review.getByRole('button', { name: 'Save review note' }).click(); await expect(review).toHaveCount(0); expect(state.notes).toHaveLength(1); await page.getByRole('button', { name: payment.orderId }).click(); await review.getByRole('button', { name: 'Resolve eligible review' }).click(); await review.getByRole('button', { name: 'Recheck and resolve if eligible' }).click(); await expect(review.getByRole('alert').filter({ hasText: 'Current canonical' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.goto('/dashboard/reports'); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download CSV' }).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toContain('.csv');
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: { code: 'SESSION_EXPIRED', message: 'Sign in again.' } } })); await page.reload(); await expect(page.getByRole('heading', { name: 'Your session has ended' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Sign in with your wallet' })).toHaveAttribute('href', '/');
});
