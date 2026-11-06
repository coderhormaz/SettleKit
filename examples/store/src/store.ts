import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg, { type PoolClient } from 'pg';
import { IntegrationError, receiptDisposition, type CurrentEligibility, type PaymentEvent } from '../../../packages/integration/src/index.ts';

export const CATALOG_PRICE = '25000000';
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
export interface StoreOrder {
  id:string; amount_base_units:string; cancel_token_hash:string; checkout_reference:string|null; checkout_url:string|null;
  payment_id:string|null; state:'pending'|'fulfilled'|'cancelled'|'review'; state_version:number; payment_version:number; fulfillment_count:number;
}
export function createStoreDatabase(url:string) {
  let parsed:URL;try{parsed=new URL(url);}catch{throw new IntegrationError('STORE_DATABASE_CONFIGURATION',503);}
  if (!['postgres:','postgresql:'].includes(parsed.protocol) || !parsed.hostname.endsWith('.neon.tech') || parsed.searchParams.get('sslmode') !== 'verify-full') throw new IntegrationError('STORE_DATABASE_CONFIGURATION',503);
  const pool = new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:10_000,idleTimeoutMillis:30_000,query_timeout:10_000,allowExitOnIdle:true});
  pool.on('error',()=>process.stderr.write('Store database connection interrupted.\n'));
  return pool;
}
export async function storeTransaction<T>(pool:pg.Pool, work:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try{await client.query('begin');await client.query("set local statement_timeout='10s'");const result=await work(client);await client.query('commit');return result;}
  catch(error){try{await client.query('rollback');}catch{/* Disconnected transaction cannot be reused. */}throw error;}
  finally{client.release();}
}
export async function createOrder(pool:pg.Pool) {
  const id=randomUUID();const token=randomBytes(32).toString('hex');
  await pool.query('insert into store_orders(id,amount_base_units,cancel_token_hash) values($1,$2,$3)',[id,CATALOG_PRICE,digest(token)]);
  return {id,cancel_token:token,amount_base_units:CATALOG_PRICE};
}
export async function orderById(pool:pg.Pool,id:string):Promise<StoreOrder> {
  const result=await pool.query<StoreOrder>('select * from store_orders where id=$1',[id]);
  if(!result.rows[0])throw new IntegrationError('ORDER_NOT_FOUND',404);return result.rows[0];
}
export async function saveCheckout(pool:pg.Pool,id:string,reference:string,url:string):Promise<void> {
  const result=await pool.query("update store_orders set checkout_reference=$2,checkout_url=$3,updated_at=now() where id=$1 and state='pending' and (checkout_reference is null or checkout_reference=$2) returning id",[id,reference,url]);
  if(result.rowCount!==1)throw new IntegrationError('ORDER_NOT_PAYABLE',409);
}
export async function cancelOrder(pool:pg.Pool,id:string,token:string):Promise<void> {
  await storeTransaction(pool,async client=>{
    const result=await client.query<StoreOrder>('select * from store_orders where id=$1 for update',[id]);const order=result.rows[0];
    if(!order || order.cancel_token_hash!==digest(token))throw new IntegrationError('ORDER_NOT_FOUND',404);
    if(order.state==='cancelled')return;
    if(order.state!=='pending')throw new IntegrationError('ORDER_CANNOT_CANCEL',409);
    await client.query("update store_orders set state='cancelled',state_version=state_version+1,updated_at=now() where id=$1",[id]);
    await client.query("insert into store_review_events(order_id,code) values($1,'ORDER_CANCELLED')",[id]);
  });
}
export function publicOrder(order:StoreOrder) {
  return {id:order.id,amount_base_units:order.amount_base_units,state:order.state,state_version:order.state_version,fulfillment_count:order.fulfillment_count};
}
export function adapterOrder(order:StoreOrder) {
  return {order_ref:order.id,amount_base_units:order.amount_base_units,state:order.state,payment_id:order.payment_id,state_version:order.state_version};
}

/** Receipt audit and logical fulfillment share the merchant's own order transaction. */
export async function applyReceipt(pool:pg.Pool,event:PaymentEvent,current:CurrentEligibility):Promise<{duplicate:boolean;disposition:string}> {
  const disposition=receiptDisposition(event,current);
  return storeTransaction(pool,async client=>{
    const result=await client.query<StoreOrder>('select * from store_orders where id=$1 for update',[event.merchant_order_id]);const order=result.rows[0];
    if(!order)throw new IntegrationError('ORDER_NOT_FOUND',404);
    if(order.amount_base_units!==event.amount_base_units || order.checkout_reference!==event.checkout_reference || (order.payment_id && order.payment_id!==event.payment_id)) throw new IntegrationError('ORDER_ASSOCIATION_MISMATCH',409);
    // The short grant is checked again after acquiring the lock, not just before waiting for it.
    if(Date.parse(current.grant_expires_at)<=Date.now())throw new IntegrationError('ELIGIBILITY_GRANT_EXPIRED',503);
    const received=await client.query('insert into store_receipts(event_id,order_id,payment_id,payment_version,event_type,disposition) values($1,$2,$3,$4,$5,$6) on conflict(event_id) do nothing returning event_id',[event.event_id,order.id,event.payment_id,event.state_version,event.event_type,disposition]);
    if(received.rowCount!==1)return {duplicate:true,disposition:'duplicate'};
    if(disposition==='superseded' || current.state_version<order.payment_version)return {duplicate:false,disposition:'superseded'};
    const fulfill=disposition==='fulfill' && order.state==='pending';
    const exposure=order.fulfillment_count===1 && disposition!=='fulfill';
    const held=disposition!=='fulfill' || (order.state!=='pending' && order.state!=='fulfilled');
    if(fulfill){
      await client.query("update store_orders set state='fulfilled',payment_id=$2,payment_version=$3,fulfillment_count=fulfillment_count+1,state_version=state_version+1,updated_at=now() where id=$1",[order.id,event.payment_id,current.state_version]);
    }else if(held){
      await client.query("update store_orders set state=case when state='cancelled' then state else 'review' end,payment_id=coalesce(payment_id,$2),payment_version=greatest(payment_version,$3),state_version=state_version+1,updated_at=now() where id=$1",[order.id,event.payment_id,current.state_version]);
      await client.query('insert into store_review_events(order_id,event_id,code) values($1,$2,$3) on conflict do nothing',[order.id,event.event_id,exposure?'CORRECTION_AFTER_FULFILLMENT':order.state==='cancelled'?'PAYMENT_AFTER_CANCELLATION':'PAYMENT_REQUIRES_REVIEW']);
    }else{
      await client.query('update store_orders set payment_version=greatest(payment_version,$2),updated_at=now() where id=$1',[order.id,current.state_version]);
    }
    if(Date.parse(current.grant_expires_at)<=Date.now())throw new IntegrationError('ELIGIBILITY_GRANT_EXPIRED',503);
    return {duplicate:false,disposition:fulfill?'fulfilled':exposure?'review_exposure':held?'review':'already_fulfilled'};
  });
}
