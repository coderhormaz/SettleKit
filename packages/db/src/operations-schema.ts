import { sql } from 'drizzle-orm';
import { boolean,check,date,index,integer,jsonb,numeric,pgTable,text,timestamp,uniqueIndex,uuid } from 'drizzle-orm/pg-core';
import { merchants,checkouts,payments,deliveries } from './schema.ts';
const time=(name:string)=>timestamp(name,{withTimezone:true});
export const contacts=pgTable('merchant_contacts',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),name:text('name').notNull(),email:text('email').notNull().default(''),notes:text('notes').notNull().default(''),archived:boolean('archived').notNull().default(false),version:integer('version').notNull().default(1),createdAt:time('created_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[index('contacts_merchant_created_idx').on(t.merchantId,t.createdAt)]);
export const paymentLinks=pgTable('payment_links',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),reference:text('reference').notNull().unique(),title:text('title').notNull(),amount:numeric('amount').notNull(),expiresAt:time('expires_at'),active:boolean('active').notNull().default(true),version:integer('version').notNull().default(1),createdAt:time('created_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[index('links_merchant_created_idx').on(t.merchantId,t.createdAt),check('link_amount_uint',sql`${t.amount}=trunc(${t.amount}) and ${t.amount}>0 and ${t.amount}<=115792089237316195423570985008687907853269984665640564039457584007913129639935`)]);
export const invoices=pgTable('merchant_invoices',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),reference:text('reference').notNull().unique(),title:text('title').notNull(),amount:numeric('amount').notNull(),contactId:uuid('contact_id').references(()=>contacts.id),contactSnapshot:jsonb('contact_snapshot').$type<{name:string;email:string}>(),dueDate:date('due_date'),notes:text('notes').notNull().default(''),state:text('state').notNull().default('open'),version:integer('version').notNull().default(1),createdAt:time('created_at').notNull().defaultNow(),updatedAt:time('updated_at').notNull().defaultNow(),
},t=>[index('invoices_merchant_created_idx').on(t.merchantId,t.createdAt),index('invoices_contact_idx').on(t.contactId),check('invoice_state',sql`${t.state} in ('open','void')`),check('invoice_amount_uint',sql`${t.amount}=trunc(${t.amount}) and ${t.amount}>0 and ${t.amount}<=115792089237316195423570985008687907853269984665640564039457584007913129639935`)]);
export const collectionOrders=pgTable('internal_collection_orders',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),linkId:uuid('link_id').references(()=>paymentLinks.id),invoiceId:uuid('invoice_id').references(()=>invoices.id),checkoutId:uuid('checkout_id').references(()=>checkouts.id),amount:numeric('amount').notNull(),state:text('state').notNull().default('pending'),version:integer('version').notNull().default(1),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('collection_merchant_created_idx').on(t.merchantId,t.createdAt),index('collection_link_idx').on(t.linkId),uniqueIndex('collection_invoice_idx').on(t.invoiceId),uniqueIndex('collection_checkout_idx').on(t.checkoutId),check('collection_source',sql`(${t.linkId} is null) <> (${t.invoiceId} is null)`),check('collection_state',sql`${t.state} in ('pending','fulfilled','cancelled','review')`),check('collection_amount_uint',sql`${t.amount}=trunc(${t.amount}) and ${t.amount}>0 and ${t.amount}<=115792089237316195423570985008687907853269984665640564039457584007913129639935`)]);
export const apiKeys=pgTable('merchant_api_keys',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),name:text('name').notNull(),prefix:text('prefix').notNull(),keyHash:text('key_hash').notNull().unique(),scopes:jsonb('scopes').$type<('checkout:create'|'payment:read')[]>().notNull(),revokedAt:time('revoked_at'),lastUsedAt:time('last_used_at'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('api_keys_merchant_idx').on(t.merchantId,t.createdAt),check('api_key_scopes',sql`jsonb_typeof(${t.scopes})='array' and jsonb_array_length(${t.scopes}) between 1 and 2 and ${t.scopes} <@ '["checkout:create","payment:read"]'::jsonb`)]);
export const merchantSettings=pgTable('merchant_settings',{
  merchantId:uuid('merchant_id').primaryKey().references(()=>merchants.id),paused:boolean('paused').notNull().default(false),version:integer('version').notNull().default(1),updatedAt:time('updated_at').notNull().defaultNow(),
});
export const reviewNotes=pgTable('payment_review_notes',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),paymentId:uuid('payment_id').notNull().references(()=>payments.id),note:text('note').notNull(),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('review_notes_payment_idx').on(t.paymentId,t.createdAt),index('review_notes_merchant_idx').on(t.merchantId,t.createdAt)]);
export const webhookTests=pgTable('webhook_tests',{
  id:uuid('id').primaryKey().defaultRandom(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),status:text('status').notNull().default('processing'),attempts:integer('attempts').notNull().default(1),errorCode:text('error_code'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('webhook_tests_merchant_idx').on(t.merchantId,t.createdAt),check('webhook_test_status',sql`${t.status} in ('processing','delivered','failed')`)]);
export const deliveryReplayBudget=pgTable('delivery_replay_budget',{
  deliveryId:uuid('delivery_id').primaryKey().references(()=>deliveries.id),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),count:integer('count').notNull().default(0),lastAt:time('last_at'),
},t=>[index('replay_budget_merchant_idx').on(t.merchantId),check('replay_count_cap',sql`${t.count} between 0 and 3`)]);
