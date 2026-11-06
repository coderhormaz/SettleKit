import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ProviderHealth, ScreeningDecision, SourceSnapshot } from '@settlekit/screening';

const time = (name: string) => timestamp(name, { withTimezone: true });
export const merchants = pgTable('merchants', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerWallet: text('owner_wallet').notNull().unique(),
  displayName: text('display_name').notNull().default(''),
  websiteOrigin: text('website_origin').notNull().default(''),
  settlementWallet: text('settlement_wallet').notNull(),
  settlementProvenAt: time('settlement_proven_at').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
}, (t) => [check('owner_address', sql`${t.ownerWallet} ~ '^0x[0-9a-f]{40}$'`), check('settlement_address', sql`${t.settlementWallet} ~ '^0x[0-9a-f]{40}$'`)]);

export const challenges = pgTable('wallet_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  address: text('address').notNull(),
  nonce: text('nonce').notNull().unique(),
  message: text('message').notNull(),
  purpose: text('purpose').notNull(),
  merchantId: uuid('merchant_id').references(() => merchants.id),
  browserHash: text('browser_hash').notNull(),
  expiresAt: time('expires_at').notNull(),
  consumedAt: time('consumed_at'),
  createdAt: time('created_at').notNull().defaultNow(),
}, (t) => [index('challenge_expiry_idx').on(t.expiresAt), check('challenge_purpose', sql`${t.purpose} in ('login', 'settlement')`)]);

export const sessions = pgTable('merchant_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  merchantId: uuid('merchant_id').notNull().references(() => merchants.id),
  expiresAt: time('expires_at').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
}, (t) => [index('sessions_merchant_idx').on(t.merchantId), index('sessions_expiry_idx').on(t.expiresAt)]);

export const jobs = pgTable('outbox_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id').references(() => merchants.id),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  availableAt: time('available_at').notNull().defaultNow(),
  leaseToken: uuid('lease_token'),
  leaseUntil: time('lease_until'),
  lastErrorCode: text('last_error_code'),
  createdAt: time('created_at').notNull().defaultNow(),
}, (t) => [index('jobs_due_idx').on(t.status, t.availableAt), index('jobs_merchant_idx').on(t.merchantId), check('job_status', sql`${t.status} in ('pending','processing','completed','dead')`), check('job_budget', sql`${t.attempts} >= 0 and ${t.maxAttempts} between 1 and 10`)]);

export const screeningSources = pgTable('screening_sources', {
  sourceId: text('source_id').primaryKey(),
  snapshot: jsonb('snapshot').$type<SourceSnapshot>(),
  health: jsonb('health').$type<ProviderHealth>().notNull(),
  fetchedAt: time('fetched_at'),
  updatedAt: time('updated_at').notNull().defaultNow(),
});
export const screeningDecisions = pgTable('screening_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id').notNull().references(() => merchants.id),
  wallet: text('wallet').notNull(),
  decision: jsonb('decision').$type<ScreeningDecision>().notNull(),
  validUntil: time('valid_until').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
}, (t) => [index('decisions_merchant_idx').on(t.merchantId, t.createdAt)]);

export const audit = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  merchantId: uuid('merchant_id').notNull().references(() => merchants.id),
  kind: text('kind').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
}, (t) => [index('audit_merchant_idx').on(t.merchantId, t.createdAt)]);

export const rateLimits = pgTable('request_budgets', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: time('reset_at').notNull(),
});

// Used by persistence boundary checks; future payment tables reuse this exact type.
export const precisionChecks = pgTable('monetary_precision_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  amount: numeric('amount').notNull(),
  isFixture: boolean('is_fixture').notNull().default(true),
}, (t) => [uniqueIndex('precision_id_idx').on(t.id), check('uint256_amount', sql`${t.amount} = trunc(${t.amount}) and ${t.amount} >= 0 and ${t.amount} <= 115792089237316195423570985008687907853269984665640564039457584007913129639935`)]);

export const integrations = pgTable('merchant_integrations', {
  merchantId: uuid('merchant_id').primaryKey().references(() => merchants.id),
  keyHash: text('key_hash').notNull().unique(),
  webhookUrl: text('webhook_url').notNull(),
  orderApiUrl: text('order_api_url').notNull(),
  webhookSecret: text('webhook_secret').notNull(),
  orderReadSecret: text('order_read_secret').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: time('created_at').notNull().defaultNow(),
});
export const checkouts = pgTable('checkout_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reference: text('reference').notNull().unique(),
  merchantId: uuid('merchant_id').notNull().references(() => merchants.id),
  orderId: text('order_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  invoiceId: text('invoice_id').notNull().unique(),
  merchantWallet: text('merchant_wallet').notNull(),
  amount: numeric('amount').notNull(),
  returnUrl: text('return_url').notNull(),
  status: text('status').notNull().default('open'),
  stateVersion: integer('state_version').notNull().default(1),
  refundHold: boolean('refund_hold').notNull().default(false),
  refundAmount: numeric('refund_amount').notNull().default('0'),
  riskState: text('risk_state').notNull().default('unchecked'),
  submittedTxHash: text('submitted_tx_hash'),
  mode: text('mode').notNull().default('store'),
  collectionOrderId: uuid('collection_order_id'),
  expiresAt: time('expires_at').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
}, t => [uniqueIndex('checkout_idempotency_idx').on(t.merchantId,t.idempotencyKey), uniqueIndex('checkout_order_idx').on(t.merchantId,t.orderId), index('checkout_merchant_idx').on(t.merchantId,t.createdAt), check('checkout_amount_uint',sql`${t.amount}=trunc(${t.amount}) and ${t.amount}>0 and ${t.amount}<=115792089237316195423570985008687907853269984665640564039457584007913129639935`),check('checkout_refund_uint',sql`${t.refundAmount}=trunc(${t.refundAmount}) and ${t.refundAmount}>=0 and ${t.refundAmount}<=${t.amount}`),check('checkout_status',sql`${t.status} in ('open','accepted','orphaned','review','cancelled')`)]);
export const payerChallenges = pgTable('payer_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkoutId: uuid('checkout_id').notNull().references(()=>checkouts.id),
  payer: text('payer').notNull(),
  browserHash: text('browser_hash').notNull(),
  message: text('message').notNull(),
  expiresAt: time('expires_at').notNull(),
  consumedAt: time('consumed_at'),
},t=>[index('payer_challenge_checkout_idx').on(t.checkoutId)]);
export const paymentAuthorizations = pgTable('payment_authorizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkoutId: uuid('checkout_id').notNull().references(()=>checkouts.id),
  payer: text('payer').notNull(),
  router: text('router').notNull(),
  evidence: text('evidence').notNull().unique(),
  epoch: numeric('epoch').notNull(),
  deadline: time('deadline').notNull(),
  payload: jsonb('payload').$type<Record<string,string>>().notNull(),
  signature: text('signature').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
},t=>[index('authorization_checkout_idx').on(t.checkoutId)]);
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkoutId: uuid('checkout_id').notNull().unique().references(()=>checkouts.id),
  authorizationId: uuid('authorization_id').notNull().references(()=>paymentAuthorizations.id),
  txHash: text('tx_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  blockNumber: numeric('block_number').notNull(),
  blockHash: text('block_hash').notNull(),
  payer: text('payer').notNull(),
  canonical: boolean('canonical').notNull().default(true),
  checkedAt: time('checked_at').notNull().defaultNow(),
  blockTime: time('block_time'),
  createdAt: time('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('payment_event_idx').on(t.txHash,t.logIndex)]);
export const deliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(()=>payments.id),
  merchantId: uuid('merchant_id').notNull().references(()=>merchants.id),
  stateVersion: integer('state_version').notNull(),
  eventType: text('event_type').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  errorCode: text('error_code'),
  createdAt: time('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('delivery_payment_version_idx').on(t.paymentId,t.stateVersion),index('delivery_merchant_idx').on(t.merchantId,t.createdAt)]);
export const chainCursors = pgTable('chain_cursors', {
  router: text('router').primaryKey(),
  nextBlock: numeric('next_block').notNull(),
  updatedAt: time('updated_at').notNull().defaultNow(),
});
