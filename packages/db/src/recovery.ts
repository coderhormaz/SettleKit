import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {keccak256,toHex} from 'viem';
import {AppError,addressSchema,USDT_ADDRESS} from '@settlekit/core';
import {hashToken} from '@settlekit/core/server';
import {evaluateWallet,OFAC_SOURCE_ID} from '@settlekit/screening';
import {transaction,type Database} from './client.ts';
import {paymentState} from './observer.ts';
import {readStoreOrder} from './integration.ts';
import {enqueue} from './jobs.ts';

export function authenticateRecovery(header:string|null):'cre'{
  const expected=process.env.RECOVERY_SERVICE_TOKEN;
  if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw new AppError('RECOVERY_UNCONFIGURED',503,'Recovery service is not configured.');
  const supplied=header?.startsWith('Bearer ')?header.slice(7):'';
  const a=Buffer.from(hashToken(supplied));const b=Buffer.from(hashToken(expected));
  if(!timingSafeEqual(a,b))throw new AppError('RECOVERY_UNAUTHORIZED',401,'Recovery service authorization is required.');return 'cre';
}
export const recoverInput=z.object({paymentId:z.string().uuid(),deliveryId:z.string().uuid(),stateVersion:z.number().int().positive(),round:z.number().int().min(1).max(3),txHash:z.string().regex(/^0x[0-9a-f]{64}$/i),blockHash:z.string().regex(/^0x[0-9a-f]{64}$/i),logIndex:z.number().int().nonnegative()}).strict();
export async function recoveryCandidates(db:Database,query:URLSearchParams){
  const limit=z.coerce.number().int().min(1).max(20).parse(query.get('limit')??'5');const cursor=query.get('cursor');if(cursor)z.string().uuid().parse(cursor);const merchant=query.get('merchant');const wallet=merchant?addressSchema.parse(merchant):null;
  const slot=query.has('slot')?z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(query.get('slot')):null;
  if(slot!==null&&(cursor||limit!==1))throw new AppError('INVALID_INPUT',400,'Slot selection requires one candidate and no cursor.');
  const eligible=`select coalesce(b.count,0)+1 as "recoveryRound",d.id as "deliveryId",d.id as "eventId",p.id as "paymentId",c.state_version as "stateVersion",c.order_id as "orderId",c.invoice_id as "invoiceId",c.merchant_wallet as merchant,p.payer,c.amount::text as "amountBaseUnits",p.tx_hash as "txHash",p.log_index as "logIndex",p.block_number::text as "blockNumber",p.block_hash as "blockHash",a.router,i.order_api_url as "orderApiBase" from webhook_deliveries d join payments p on p.id=d.payment_id join checkout_sessions c on c.id=p.checkout_id join payment_authorizations a on a.id=p.authorization_id join merchant_integrations i on i.merchant_id=c.merchant_id left join recovery_budgets b on b.payment_id=p.id where d.status='dead' and d.event_type='payment.accepted' and d.state_version=c.state_version and c.mode='store' and c.status='accepted' and p.canonical=true and not c.refund_hold and c.refund_amount=0 and i.active=true and coalesce(b.count,0)<3 and (b.last_at is null or b.last_at<now()-interval '60 seconds') and ($1::uuid is null or d.id>$1) and ($2::text is null or c.merchant_wallet=$2)`;
  // Read-only deterministic rotation avoids repeatedly selecting one permanently
  // ineligible order. Every CRE node uses the same trigger-time slot; ordinary
  // operator/API readers retain stable cursor pagination.
  const selection=slot===null?`${eligible} order by d.id limit $3`:`with eligible as (${eligible}) select * from eligible order by "deliveryId" offset (select case when count(*)=0 then 0 else mod($3::numeric,count(*))::bigint end from eligible) limit 1`;
  const rows=(await db.pool.query(selection,[cursor,wallet,slot??limit])).rows;
  return {items:rows.map(row=>({...row,token:USDT_ADDRESS,chainId:1874,confirmationStage:'included_2_blocks'})),nextCursor:rows.length===limit?rows.at(-1)!.deliveryId:null};
}
export async function recoveryCurrent(db:Database,paymentId:string){
  const tenant=(await db.pool.query<{merchant_id:string}>('select c.merchant_id from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1',[z.string().uuid().parse(paymentId)])).rows[0];if(!tenant)throw new AppError('PAYMENT_NOT_FOUND',404,'This payment was not found.');
  return paymentState(db,tenant.merchant_id,paymentId);
}
export async function requestRecovery(db:Database,input:unknown,actor:'cre',deps={state:paymentState,order:readStoreOrder}){
  const data=recoverInput.parse(input);const row=(await db.pool.query<{merchant_id:string;checkout_id:string;tx_hash:string;block_hash:string;log_index:number;order_id:string;amount:string;status:string;state_version:number;mode:string;delivery_status:string;event_type:string}>('select c.merchant_id,c.id as checkout_id,p.tx_hash,p.block_hash,p.log_index,c.order_id,c.amount,c.status,c.state_version,c.mode,d.status as delivery_status,d.event_type from payments p join checkout_sessions c on c.id=p.checkout_id join webhook_deliveries d on d.payment_id=p.id where p.id=$1 and d.id=$2',[data.paymentId,data.deliveryId])).rows[0];
  if(!row)throw new AppError('RECOVERY_NOT_FOUND',404,'The recovery association was not found.');
  if(row.tx_hash.toLowerCase()!==data.txHash.toLowerCase()||row.block_hash.toLowerCase()!==data.blockHash.toLowerCase()||row.log_index!==data.logIndex||row.mode!=='store'||row.event_type!=='payment.accepted')throw new AppError('RECOVERY_EVIDENCE_MISMATCH',409,'Recovery evidence is stale or mismatched.');
  const stableKey=keccak256(toHex(JSON.stringify(['recovery-v1',data.paymentId,data.deliveryId,data.stateVersion,data.round])));
  const existing=(await db.pool.query<{status:string}>('select status from recovery_intents where stable_key=$1',[stableKey])).rows[0];if(existing)return {status:existing.status,duplicate:true};
  if(row.state_version!==data.stateVersion)throw new AppError('RECOVERY_EVIDENCE_MISMATCH',409,'Recovery evidence is stale or mismatched.');
  const state=await deps.state(db,row.merchant_id,data.paymentId);
  if(!state.eligible||state.state_version!==data.stateVersion)throw new AppError('RECOVERY_INELIGIBLE',409,'Current payment state does not allow new fulfillment.');
  const order=await deps.order(db,row.merchant_id,row.order_id,row.amount);
  if(order.payment_id!==null&&order.payment_id!==data.paymentId)throw new AppError('RECOVERY_ORDER_MISMATCH',409,'The merchant order belongs to another payment.');
  const status=order.state==='fulfilled'?'noop':order.state==='pending'?'scheduled':'refused';
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[row.merchant_id]);
    const prior=(await sql.query<{status:string}>('select status from recovery_intents where stable_key=$1',[stableKey])).rows[0];if(prior)return {status:prior.status,duplicate:true};
    const current=(await sql.query<{state_version:number;status:string;refund_hold:boolean;refund_amount:string}>('select state_version,status,refund_hold,refund_amount from checkout_sessions where id=$1 for update',[row.checkout_id])).rows[0];
    if(current.state_version!==data.stateVersion||current.status!=='accepted'||current.refund_hold||BigInt(current.refund_amount)>0n||Date.parse(state.grant_expires_at)<=Date.now()+1000)throw new AppError('RECOVERY_CHANGED',409,'Payment eligibility changed before recovery.');
    await (await import('./operations.ts')).assertCollectionPayable(sql,{merchant_id:row.merchant_id,amount:row.amount,mode:'store',collection_order_id:null});
    const source=(await sql.query('select snapshot,health from screening_sources where source_id=$1 for share',[OFAC_SOURCE_ID])).rows[0];if([state.payer,state.merchant].some(address=>evaluateWallet({address,snapshot:source?.snapshot??null,providerHealth:source?.health??{state:'unavailable',checkedAt:new Date().toISOString()}}).state!=='allowed'))throw new AppError('RECOVERY_SCREENING_CHANGED',409,'Required recovery checks changed.');
    const delivery=(await sql.query<{status:string;state_version:number}>('select status,state_version from webhook_deliveries where id=$1 for update',[data.deliveryId])).rows[0];if(!delivery||delivery.state_version!==data.stateVersion||!['dead','delivered'].includes(delivery.status))throw new AppError('RECOVERY_DELIVERY_CHANGED',409,'The notification is no longer in a recoverable state.');
    if(status==='scheduled'){
      if(delivery.status!=='dead')throw new AppError('RECOVERY_DELIVERY_CHANGED',409,'Only a failed notification can be reopened for new fulfillment.');
      await sql.query('insert into recovery_budgets(payment_id,merchant_id) values($1,$2) on conflict do nothing',[data.paymentId,row.merchant_id]);
      const budget=(await sql.query<{count:number;last_at:Date|null}>('select count,last_at from recovery_budgets where payment_id=$1 for update',[data.paymentId])).rows[0];if(budget.count>=3||(budget.last_at&&Date.now()-budget.last_at.getTime()<60000))throw new AppError('RECOVERY_BUDGET',429,'Recovery is cooling down or its budget is exhausted.');
      if(data.round!==budget.count+1)throw new AppError('RECOVERY_ROUND_CHANGED',409,'The bounded recovery round changed. Read a fresh candidate.');
      await sql.query('update recovery_budgets set count=count+1,last_at=now() where payment_id=$1',[data.paymentId]);
      await sql.query("update webhook_deliveries set status='pending',error_code=null where id=$1",[data.deliveryId]);
      await enqueue(sql,'payment.webhook',`cre:${stableKey}`,{deliveryId:data.deliveryId,recoveryActor:actor,recoveryKey:stableKey},row.merchant_id);
    }
    if(status==='noop')await sql.query("update webhook_deliveries set status='acknowledged',error_code='ORDER_ALREADY_FULFILLED' where id=$1 and status='dead'",[data.deliveryId]);
    await sql.query('insert into recovery_intents(stable_key,merchant_id,payment_id,delivery_id,state_version,actor,status,reason_code) values($1,$2,$3,$4,$5,$6,$7,$8)',[stableKey,row.merchant_id,data.paymentId,data.deliveryId,data.stateVersion,actor,status,status==='refused'?'ORDER_NOT_PENDING':null]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'recovery.requested',$2)",[row.merchant_id,JSON.stringify({actor,paymentId:data.paymentId,deliveryId:data.deliveryId,stateVersion:data.stateVersion,status,recoveryKey:stableKey})]);return {status,duplicate:false};
  });
}
