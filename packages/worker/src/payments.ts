import { createHmac } from 'node:crypto';
import { type Hex } from 'viem';
import { routerAbi } from '@settlekit/core/router';
import { runtimeConfig } from '@settlekit/core/server';
import { chainClient, holdPayment, merchantIntegration, paymentState, persistObservation, persistRefundObservation, retractRefund, readStoreOrder, routerConfiguration, transaction, verifiedReceipt, verifiedRefundReceipt, type CheckoutRow, type Database, type ClaimedJob } from '@settlekit/db';
import {evaluateWallet,OFAC_SOURCE_ID} from '@settlekit/screening';
import { safeJsonRequest, type PaymentEvent } from '@settlekit/integration';

export async function observePayments(db:Database) {
  // Unconfigured deployments are intentionally disabled, not replaced by mocks.
  if(!process.env.WHITECHAIN_ROUTER_ADDRESS)return;
  const config=routerConfiguration();const client=chainClient();
  if(await client.getChainId()!==1874)throw new Error('CHAIN_MISMATCH');
  const head=await client.getBlockNumber();if(head<config.deploymentBlock+1n)return;
  const acceptedHead=head-1n;
  await db.pool.query('insert into chain_cursors(router,next_block) values($1,$2) on conflict do nothing',[config.router,config.deploymentBlock.toString()]);
  const cursor=(await db.pool.query<{next_block:string}>('select next_block from chain_cursors where router=$1',[config.router])).rows[0];
  const next=BigInt(cursor.next_block);const from=next>config.deploymentBlock+12n?next-12n:config.deploymentBlock;
  const to=from+199n<acceptedHead?from+199n:acceptedHead;
  if(from<=to){
    const logs=await client.getLogs({address:config.router,event:routerAbi.find(e=>e.type==='event'&&e.name==='PaymentAccepted') as Extract<typeof routerAbi[number],{type:'event';name:'PaymentAccepted'}>,fromBlock:from,toBlock:to});
    for(const log of logs){if(!log.removed)await persistObservation(db,await verifiedReceipt(log.transactionHash,log.logIndex));}
    const refunds=await client.getLogs({address:config.router,event:routerAbi.find(e=>e.type==='event'&&e.name==='RefundExecuted') as Extract<typeof routerAbi[number],{type:'event';name:'RefundExecuted'}>,fromBlock:from,toBlock:to});
    for(const log of refunds){if(!log.removed)await persistRefundObservation(db,await verifiedRefundReceipt(log.transactionHash,log.logIndex));}
    // CAS prevents a slower overlapping poll from moving the durable cursor backwards.
    await db.pool.query('update chain_cursors set next_block=greatest(next_block,$2),updated_at=now() where router=$1',[config.router,(to+1n).toString()]);
  }
  // Bounded rolling check, oldest-checked first, includes historical accepted rows.
  const known=await db.pool.query<{id:string;block_number:string;block_hash:Hex;tx_hash:Hex;log_index:number}>(`select p.id,p.block_number,p.block_hash,p.tx_hash,p.log_index from payments p join checkout_sessions c on c.id=p.checkout_id where p.canonical=true order by p.checked_at asc limit 50`);
  for(const payment of known.rows){
    const block=await client.getBlock({blockNumber:BigInt(payment.block_number)});
    if(block.hash!==payment.block_hash)await holdPayment(db,payment.id,'CHAIN_ORPHANED',Number(block.timestamp),payment.block_hash);
    // RPC errors propagate; they are never silently treated as an orphan.
    await db.pool.query('update payments set checked_at=now() where id=$1',[payment.id]);
  }
  const refundRows=await db.pool.query<{id:string;block_number:string;block_hash:Hex}>('select id,block_number,block_hash from refund_events where canonical=true order by checked_at asc limit 50');
  for(const refund of refundRows.rows){const block=await client.getBlock({blockNumber:BigInt(refund.block_number)});if(block.hash!==refund.block_hash)await retractRefund(db,refund.id,Number(block.timestamp),refund.block_hash);await db.pool.query('update refund_events set checked_at=now() where id=$1',[refund.id]);}
}

const deliveryDependencies={state:paymentState,order:readStoreOrder,config:merchantIntegration,post:safeJsonRequest};
export async function deliverPayment(db:Database,job:ClaimedJob,deps=deliveryDependencies) {
  const id=typeof job.payload.deliveryId==='string'?job.payload.deliveryId:'';
  const delivery=(await db.pool.query<{id:string;payment_id:string;merchant_id:string;state_version:number;event_type:'payment.accepted'|'payment.review';created_at:Date}>('select id,payment_id,merchant_id,state_version,event_type,created_at from webhook_deliveries where id=$1',[id])).rows[0];
  if(!delivery||delivery.merchant_id!==job.merchant_id)throw new Error('DELIVERY_INVALID');
  const state=await deps.state(db,delivery.merchant_id,delivery.payment_id);
  if(state.state_version!==delivery.state_version){await finishDelivery(db,job,id,'superseded');return;}
  const mode=(await db.pool.query<{mode:string}>('select c.mode from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2',[delivery.payment_id,delivery.merchant_id])).rows[0]?.mode;
  const order=mode==='collection'?await (await import('../../db/src/operations.ts')).readInternalOrder(db,delivery.merchant_id,state.merchant_order_id,state.amount_base_units):await deps.order(db,delivery.merchant_id,state.merchant_order_id,state.amount_base_units);
  if(!order)throw new Error('COLLECTION_ORDER_MISSING');
  if(delivery.event_type==='payment.accepted'&&(!state.eligible||!['pending','fulfilled'].includes(order.state)||(order.payment_id!==null&&order.payment_id!==delivery.payment_id))){await holdPayment(db,delivery.payment_id,'SCREENING_REVIEW');await finishDelivery(db,job,id,'superseded');return;}
  if(mode==='collection'){
    await transaction(db,async sql=>{
      await sql.query('select id from merchants where id=$1 for update',[delivery.merchant_id]);
      const checkout=(await sql.query<CheckoutRow>('select c.* from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2 for update of c',[delivery.payment_id,delivery.merchant_id])).rows[0];
      const lease=await sql.query("select id from outbox_jobs where id=$1 and lease_token=$2 and status='processing' and lease_until>now() for share",[job.id,job.lease_token]);if(!lease.rowCount)throw new Error('DELIVERY_LEASE_LOST');
      if(checkout.state_version!==delivery.state_version){await sql.query("update webhook_deliveries set status='superseded' where id=$1",[id]);return;}
      let eligible=state.eligible&&Date.parse(state.grant_expires_at)>Date.now()&&checkout.status==='accepted'&&!checkout.refund_hold&&BigInt(checkout.refund_amount)===0n;
      if(eligible){await (await import('../../db/src/operations.ts')).assertCollectionPayable(sql,checkout);const source=(await sql.query('select snapshot,health from screening_sources where source_id=$1 for share',[OFAC_SOURCE_ID])).rows[0];if([state.payer,state.merchant].some(address=>evaluateWallet({address,snapshot:source?.snapshot??null,providerHealth:source?.health??{state:'unavailable',checkedAt:new Date().toISOString()}}).state!=='allowed'))eligible=false;}
      const previous=(await sql.query<{state:string}>('select state from internal_collection_orders where id=$1 and merchant_id=$2 for update',[checkout.collection_order_id,delivery.merchant_id])).rows[0];if(!previous)throw new Error('COLLECTION_ORDER_MISSING');
      if(delivery.event_type==='payment.accepted'&&eligible){await sql.query("update internal_collection_orders set state='fulfilled',version=version+1 where id=$1 and state='pending'",[checkout.collection_order_id]);}
      else{await sql.query("update internal_collection_orders set state='review',version=version+1 where id=$1 and state='pending'",[checkout.collection_order_id]);await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'collection.review',$2)",[delivery.merchant_id,JSON.stringify({paymentId:delivery.payment_id,exposureAfterAcknowledgment:previous.state==='fulfilled',stateVersion:checkout.state_version})]);}
      await sql.query("update webhook_deliveries set status='delivered',attempts=$2,error_code=null where id=$1",[id,job.attempts]);
    });return;
  }
  const config=await deps.config(db,delivery.merchant_id);
  const event:PaymentEvent={...state,event_id:delivery.id,event_type:delivery.event_type,created_at:delivery.created_at.toISOString(),confirmation_stage:'included_2_blocks'};
  const raw=JSON.stringify(event);const timestamp=Math.floor(Date.now()/1000).toString();const signature=createHmac('sha256',config.webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
  const fenced=await db.pool.query("update webhook_deliveries set attempts=$2,status='processing',error_code=null where id=$1 and exists(select 1 from outbox_jobs where id=$3 and lease_token=$4 and status='processing' and lease_until>now()) returning id",[id,job.attempts,job.id,job.lease_token]);
  if(fenced.rowCount!==1)throw new Error('DELIVERY_LEASE_LOST');
  await deps.post(new URL(config.webhook_url),{approvedOrigin:config.website_origin,allowLocal:runtimeConfig().allowLocal,method:'POST',headers:{'x-settlekit-timestamp':timestamp,'x-settlekit-signature':`v1=${signature}`},body:event});
  await finishDelivery(db,job,id,'delivered');
}
async function finishDelivery(db:Database,job:ClaimedJob,id:string,status:string) {
  // A stale worker cannot overwrite newer delivery state after lease loss.
  await transaction(db,async sql=>{
    const changed=await sql.query("update webhook_deliveries set status=$3,error_code=null where id=$1 and exists(select 1 from outbox_jobs where id=$2 and lease_token=$4 and status='processing' and lease_until>now()) returning merchant_id",[id,job.id,status,job.lease_token]);
    if(changed.rowCount===1&&status==='delivered'&&job.payload.recoveryActor==='cre'&&typeof job.payload.recoveryKey==='string'){
      const recovered=await sql.query("update recovery_intents set delivered_at=now() where stable_key=$1 and delivery_id=$2 and status='scheduled' and delivered_at is null returning id",[job.payload.recoveryKey,id]);
      if(recovered.rowCount)await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'recovery.delivered',$2)",[job.merchant_id,JSON.stringify({actor:'cre',deliveryId:id,recoveryKey:job.payload.recoveryKey})]);
    }
  });
}
export async function recordDeliveryFailure(db:Database,job:ClaimedJob) {
  if(job.kind!=='payment.webhook')return;
  await db.pool.query("update webhook_deliveries set status=$3,attempts=$4,error_code='DELIVERY_FAILED' where id=$1 and exists(select 1 from outbox_jobs where id=$2 and lease_token=$5 and status='processing' and lease_until>now())",[job.payload.deliveryId,job.id,job.attempts>=job.max_attempts?'dead':'pending',job.attempts,job.lease_token]);
}
