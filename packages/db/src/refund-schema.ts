import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,numeric,integer,boolean,jsonb,timestamp,index,uniqueIndex,check} from 'drizzle-orm/pg-core';
import {merchants,payments} from './schema.ts';
const time=(name:string)=>timestamp(name,{withTimezone:true});
const uint='115792089237316195423570985008687907853269984665640564039457584007913129639935';
export const refundIntents=pgTable('refund_intents',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),paymentId:uuid('payment_id').notNull().references(()=>payments.id),
  refundId:text('refund_id').notNull().unique(),idempotencyKey:text('idempotency_key').notNull(),requestHash:text('request_hash').notNull(),amount:numeric('amount').notNull(),
  status:text('status').notNull().default('requested'),version:integer('version').notNull().default(1),submittedTxHash:text('submitted_tx_hash'),reasonCode:text('reason_code'),
  createdAt:time('created_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[uniqueIndex('refund_idempotency_idx').on(t.merchantId,t.idempotencyKey),index('refund_payment_idx').on(t.paymentId,t.createdAt),check('refund_intent_uint',sql`${t.amount}=trunc(${t.amount}) and ${t.amount}>0 and ${t.amount}<=${sql.raw(uint)}`),check('refund_intent_status',sql`${t.status} in ('requested','authorized','submitted','confirmed','cancel_pending','cancelled','failed','expired','review')`)]);
export const refundAuthorizations=pgTable('refund_authorizations',{
  id:uuid('id').primaryKey().defaultRandom(),intentId:uuid('intent_id').notNull().references(()=>refundIntents.id),evidence:text('evidence').notNull().unique(),
  epoch:numeric('epoch').notNull(),deadline:time('deadline').notNull(),payload:jsonb('payload').$type<Record<string,string>>().notNull(),signature:text('signature').notNull(),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('refund_authorization_intent_idx').on(t.intentId,t.deadline)]);
export const refundEvents=pgTable('refund_events',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),paymentId:uuid('payment_id').notNull().references(()=>payments.id),intentId:uuid('intent_id').references(()=>refundIntents.id),refundId:text('refund_id').notNull(),
  amount:numeric('amount').notNull(),txHash:text('tx_hash').notNull(),logIndex:integer('log_index').notNull(),blockNumber:numeric('block_number').notNull(),blockHash:text('block_hash').notNull(),blockTime:time('block_time').notNull(),canonical:boolean('canonical').notNull().default(true),checkedAt:time('checked_at').notNull().defaultNow(),createdAt:time('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('refund_source_event_idx').on(t.txHash,t.logIndex),index('refund_merchant_date_idx').on(t.merchantId,t.blockTime),check('refund_event_uint',sql`${t.amount}=trunc(${t.amount}) and ${t.amount}>0 and ${t.amount}<=${sql.raw(uint)}`)]);
export const arkivMappings=pgTable('arkiv_mappings',{
  eventId:text('event_id').primaryKey(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),kind:text('kind').notNull(),payload:jsonb('payload').$type<Record<string,unknown>>().notNull(),
  status:text('status').notNull().default('pending'),entityKey:text('entity_key'),expiresAtBlock:numeric('expires_at_block'),transactionHash:text('transaction_hash'),errorCode:text('error_code'),updatedAt:time('updated_at').notNull().defaultNow(),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('arkiv_merchant_idx').on(t.merchantId,t.createdAt),index('arkiv_expiry_idx').on(t.status,t.expiresAtBlock)]);
export const arkivWriterLeases=pgTable('arkiv_writer_leases',{
  writer:text('writer').primaryKey(),leaseToken:uuid('lease_token').notNull(),leaseUntil:time('lease_until').notNull(),
});
