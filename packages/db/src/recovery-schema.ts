import {sql} from 'drizzle-orm';
import {pgTable,text,uuid,integer,timestamp,index,check} from 'drizzle-orm/pg-core';
import {merchants,payments,deliveries} from './schema.ts';
const time=(name:string)=>timestamp(name,{withTimezone:true});
export const recoveryIntents=pgTable('recovery_intents',{
  id:uuid('id').primaryKey().defaultRandom(),stableKey:text('stable_key').notNull().unique(),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),paymentId:uuid('payment_id').notNull().references(()=>payments.id),deliveryId:uuid('delivery_id').notNull().references(()=>deliveries.id),stateVersion:integer('state_version').notNull(),actor:text('actor').notNull(),status:text('status').notNull(),reasonCode:text('reason_code'),deliveredAt:time('delivered_at'),createdAt:time('created_at').notNull().defaultNow(),
},t=>[index('recovery_merchant_idx').on(t.merchantId,t.createdAt),index('recovery_delivery_idx').on(t.deliveryId,t.deliveredAt),check('recovery_status',sql`${t.status} in ('scheduled','noop','refused')`)]);
export const recoveryBudgets=pgTable('recovery_budgets',{
  paymentId:uuid('payment_id').primaryKey().references(()=>payments.id),merchantId:uuid('merchant_id').notNull().references(()=>merchants.id),count:integer('count').notNull().default(0),lastAt:time('last_at'),
},t=>[check('recovery_count',sql`${t.count} between 0 and 3`)]);
