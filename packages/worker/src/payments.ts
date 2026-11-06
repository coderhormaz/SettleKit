import { createHmac } from 'node:crypto';
import { type Hex } from 'viem';
import { routerAbi } from '@settlekit/core/router';
import { runtimeConfig } from '@settlekit/core/server';
import { chainClient, holdPayment, merchantIntegration, paymentState, persistObservation, readStoreOrder, routerConfiguration, verifiedReceipt, type Database, type ClaimedJob } from '@settlekit/db';
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
    // CAS prevents a slower overlapping poll from moving the durable cursor backwards.
    await db.pool.query('update chain_cursors set next_block=greatest(next_block,$2),updated_at=now() where router=$1',[config.router,(to+1n).toString()]);
  }
  // Bounded rolling check, oldest-checked first, includes historical accepted rows.
  const known=await db.pool.query<{id:string;block_number:string;block_hash:Hex;tx_hash:Hex;log_index:number}>(`select p.id,p.block_number,p.block_hash,p.tx_hash,p.log_index from payments p join checkout_sessions c on c.id=p.checkout_id where p.canonical=true and c.status='accepted' order by p.checked_at asc limit 50`);
  for(const payment of known.rows){
    const block=await client.getBlock({blockNumber:BigInt(payment.block_number)});
    if(block.hash!==payment.block_hash)await holdPayment(db,payment.id,'CHAIN_ORPHANED');
    // RPC errors propagate; they are never silently treated as an orphan.
    await db.pool.query('update payments set checked_at=now() where id=$1',[payment.id]);
  }
}

const deliveryDependencies={state:paymentState,order:readStoreOrder,config:merchantIntegration,post:safeJsonRequest};
export async function deliverPayment(db:Database,job:ClaimedJob,deps=deliveryDependencies) {
  const id=typeof job.payload.deliveryId==='string'?job.payload.deliveryId:'';
  const delivery=(await db.pool.query<{id:string;payment_id:string;merchant_id:string;state_version:number;event_type:'payment.accepted'|'payment.review';created_at:Date}>('select id,payment_id,merchant_id,state_version,event_type,created_at from webhook_deliveries where id=$1',[id])).rows[0];
  if(!delivery||delivery.merchant_id!==job.merchant_id)throw new Error('DELIVERY_INVALID');
  const state=await deps.state(db,delivery.merchant_id,delivery.payment_id);
  if(state.state_version!==delivery.state_version){await finishDelivery(db,job,id,'superseded');return;}
  const order=await deps.order(db,delivery.merchant_id,state.merchant_order_id,state.amount_base_units);
  if(delivery.event_type==='payment.accepted'&&(!state.eligible||!['pending','fulfilled'].includes(order.state)||(order.payment_id!==null&&order.payment_id!==delivery.payment_id))){await holdPayment(db,delivery.payment_id,'SCREENING_REVIEW');await finishDelivery(db,job,id,'superseded');return;}
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
  await db.pool.query("update webhook_deliveries set status=$3,error_code=null where id=$1 and exists(select 1 from outbox_jobs where id=$2 and lease_token=$4 and status='processing' and lease_until>now())",[id,job.id,status,job.lease_token]);
}
export async function recordDeliveryFailure(db:Database,job:ClaimedJob) {
  if(job.kind!=='payment.webhook')return;
  await db.pool.query("update webhook_deliveries set status=$3,attempts=$4,error_code='DELIVERY_FAILED' where id=$1 and exists(select 1 from outbox_jobs where id=$2 and lease_token=$5 and status='processing' and lease_until>now())",[job.payload.deliveryId,job.id,job.attempts>=job.max_attempts?'dead':'pending',job.attempts,job.lease_token]);
}
