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
