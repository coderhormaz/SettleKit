import { randomUUID } from 'node:crypto';
import { decodeEventLog, keccak256, TransactionReceiptNotFoundError, type Hex } from 'viem';
import { routerAbi } from '@settlekit/core/router';
import { AppError, USDT_ADDRESS } from '@settlekit/core';
import { transaction, type Database } from './client.ts';
import { enqueue } from './jobs.ts';
import { chainClient, checkPaymentPolicy, routerConfiguration, type CheckedPolicy } from './policy.ts';
import { evaluateWallet, OFAC_SOURCE_ID } from '@settlekit/screening';
import {runtimeConfig} from '@settlekit/core/server';
import {queueMappedCorrections,queuePublicCorrection,queuePublicReceipt} from './projection.ts';
import type { CheckoutRow } from './payments.ts';

export interface PaymentObservation {router:string;txHash:string;logIndex:number;blockNumber:string;blockHash:string;blockTime:number;invoiceId:string;payer:string;merchant:string;token:string;amount:string;evidence:string;epoch:string;deadline:string;refundId?:string}
export async function insertDelivery(sql:import('pg').PoolClient,paymentId:string,merchantId:string,version:number,type:'payment.accepted'|'payment.review') {
  const id=randomUUID();
  const row=await sql.query<{id:string}>('insert into webhook_deliveries(id,payment_id,merchant_id,state_version,event_type) values($1,$2,$3,$4,$5) on conflict(payment_id,state_version) do nothing returning id',[id,paymentId,merchantId,version,type]);
  if(row.rows[0]){
    await enqueue(sql,'payment.webhook',`delivery:${id}`,{deliveryId:id},merchantId);
    if(type==='payment.accepted'&&process.env.ALLOW_DEVELOPMENT_FAILURES==='true'&&process.env.DEVELOPMENT_DELIVERY_ATTEMPTS==='1'&&process.env.DEMO_MERCHANT_ID===merchantId&&runtimeConfig().allowLocal){
      const mode=(await sql.query<{mode:string}>('select c.mode from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1',[paymentId])).rows[0]?.mode;
      if(mode==='store'){await sql.query("update outbox_jobs set max_attempts=1,payload=payload||jsonb_build_object('developmentFailureFixture',true) where dedupe_key=$1",[`delivery:${id}`]);await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'development.delivery_budget',$2)",[merchantId,JSON.stringify({deliveryId:id,maxAttempts:1,localOnly:true})]);}
    }
  }
}
export async function persistObservation(db:Database,event:PaymentObservation) {
  const tenant=(await db.pool.query<{merchant_id:string}>('select merchant_id from checkout_sessions where invoice_id=$1',[event.invoiceId])).rows[0];if(!tenant)return false;
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[tenant.merchant_id]);
    const row=(await sql.query<CheckoutRow&{authorization_id:string;payload:Record<string,string>;router:string}>('select c.*,a.id as authorization_id,a.payload,a.router from checkout_sessions c join payment_authorizations a on a.checkout_id=c.id where c.invoice_id=$1 and a.evidence=$2 for update of c',[event.invoiceId,event.evidence])).rows[0];
    if(!row)return false;
    const p=row.payload;
    if(event.router.toLowerCase()!==row.router||event.token.toLowerCase()!==USDT_ADDRESS.toLowerCase()||event.invoiceId!==row.invoice_id||event.payer.toLowerCase()!==p.payer.toLowerCase()||event.merchant.toLowerCase()!==row.merchant_wallet||event.amount!==row.amount||event.epoch!==p.epoch||event.deadline!==p.deadline||event.blockTime>Number(p.deadline))throw new AppError('EVENT_MISMATCH',409,'Payment evidence does not match its authorization.');
    const existing=(await sql.query<{id:string;tx_hash:string;block_hash:string;canonical:boolean}>('select id,tx_hash,block_hash,canonical from payments where checkout_id=$1',[row.id])).rows[0];
    if(existing?.canonical&&existing.tx_hash===event.txHash&&existing.block_hash===event.blockHash){await sql.query('update payments set block_time=to_timestamp($2) where id=$1 and block_time is null',[existing.id,event.blockTime]);return false;}
    const id=existing?.id??randomUUID();let status=row.status==='open'&&!row.refund_hold&&row.refund_amount==='0'?'accepted':'review';const version=row.state_version+1;
    try{await (await import('./operations.ts')).assertCollectionPayable(sql,row);}catch(error){if(error instanceof AppError)status='review';else throw error;}
    await sql.query('insert into payments(id,checkout_id,authorization_id,tx_hash,log_index,block_number,block_hash,payer,block_time) values($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9)) on conflict(checkout_id) do update set authorization_id=excluded.authorization_id,tx_hash=excluded.tx_hash,log_index=excluded.log_index,block_number=excluded.block_number,block_hash=excluded.block_hash,payer=excluded.payer,block_time=excluded.block_time,canonical=true',[id,row.id,row.authorization_id,event.txHash,event.logIndex,event.blockNumber,event.blockHash,event.payer.toLowerCase(),event.blockTime]);
    await sql.query('update checkout_sessions set status=$2,state_version=$3 where id=$1',[row.id,status,version]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'payment.observed',$2)",[row.merchant_id,JSON.stringify({paymentId:id,txHash:event.txHash,blockHash:event.blockHash,stateVersion:version,status})]);
    await insertDelivery(sql,id,row.merchant_id,version,status==='accepted'?'payment.accepted':'payment.review');
    await queuePublicReceipt(sql,row.merchant_id,{schemaVersion:1,kind:'payment',chainId:1874,router:event.router as Hex,token:USDT_ADDRESS,invoiceId:event.invoiceId as Hex,payer:event.payer as Hex,merchant:event.merchant as Hex,amountBaseUnits:event.amount,txHash:event.txHash as Hex,logIndex:event.logIndex,blockNumber:event.blockNumber,blockHash:event.blockHash as Hex,sourceTimestamp:event.blockTime});return true;
  });
}
export async function holdPayment(db:Database,paymentId:string,reason:'CHAIN_ORPHANED'|'SCREENING_REVIEW'|'CHAIN_STATE_MISMATCH',replacementTimestamp?:number,expectedBlockHash?:string) {
  const tenant=(await db.pool.query<{merchant_id:string}>('select c.merchant_id from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1',[paymentId])).rows[0];if(!tenant)return;
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[tenant.merchant_id]);
    const row=(await sql.query<CheckoutRow&{canonical:boolean;tx_hash:Hex;log_index:number;block_number:string;block_hash:Hex;payer:Hex;configured_router:Hex}>('select c.*,p.canonical,p.tx_hash,p.log_index,p.block_number,p.block_hash,p.payer,a.router as configured_router from payments p join checkout_sessions c on c.id=p.checkout_id join payment_authorizations a on a.id=p.authorization_id where p.id=$1 for update of c,p',[paymentId])).rows[0];
    if(!row)return;
    if(reason==='CHAIN_ORPHANED'){
      if(expectedBlockHash&&row.block_hash.toLowerCase()!==expectedBlockHash.toLowerCase()){
        await queueMappedCorrections(sql,row.merchant_id,'payment',row.invoice_id,expectedBlockHash.toLowerCase(),replacementTimestamp);
        await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'payment.stale_reorg_observation',$2)",[row.merchant_id,JSON.stringify({paymentId,oldBlockHash:expectedBlockHash,currentBlockHash:row.block_hash})]);return;
      }
      await sql.query('update payments set canonical=false where id=$1',[paymentId]);
      // Queue independently of the review status: an earlier private review or
      // duplicate poll must not erase the public correction/repair work.
      await queuePublicCorrection(sql,row.merchant_id,{schemaVersion:1,chainId:1874,router:row.configured_router,token:USDT_ADDRESS,invoiceId:row.invoice_id,payer:row.payer,merchant:row.merchant_wallet,txHash:row.tx_hash,logIndex:row.log_index,blockNumber:row.block_number,blockHash:row.block_hash},replacementTimestamp);
    }
    const status=reason==='CHAIN_ORPHANED'?'orphaned':'review';if(row.status===status)return;
    const version=row.state_version+1;
    await sql.query("update checkout_sessions set status=$2,state_version=$3,risk_state='review_required' where id=$1",[row.id,status,version]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'payment.review',$2)",[row.merchant_id,JSON.stringify({paymentId,reason,stateVersion:version,deliveredGoodsCannotBeReversed:true})]);
    await insertDelivery(sql,paymentId,row.merchant_id,version,'payment.review');
  });
}
export async function verifiedReceipt(txHash:Hex,logIndex:number,eventName:'PaymentAccepted'|'RefundExecuted'='PaymentAccepted'):Promise<PaymentObservation> {
  const config=routerConfiguration();const client=chainClient();
  if(await client.getChainId()!==1874)throw new AppError('CHAIN_MISMATCH',503,'Payment verification is unavailable.');
  const receipt=await client.getTransactionReceipt({hash:txHash});
  const log=receipt.logs.find(l=>l.logIndex===logIndex);
  if(receipt.status!=='success'||receipt.transactionHash.toLowerCase()!==txHash.toLowerCase()||!log||log.address.toLowerCase()!==config.router||log.removed||log.transactionHash!==receipt.transactionHash||log.blockHash!==receipt.blockHash||log.blockNumber!==receipt.blockNumber)throw new AppError('RECEIPT_INVALID',409,'Payment receipt is not accepted.');
  const [block,head,code,token]=await Promise.all([client.getBlock({blockNumber:receipt.blockNumber}),client.getBlockNumber(),client.getCode({address:config.router,blockNumber:receipt.blockNumber}),client.readContract({address:config.router,abi:routerAbi,functionName:'token',blockNumber:receipt.blockNumber})]);
  const confirmedBlock=await client.getBlock({blockNumber:receipt.blockNumber});
  if(block.hash!==receipt.blockHash||confirmedBlock.hash!==receipt.blockHash)throw new AppError('CHAIN_ORPHANED',409,'This payment requires review after a chain correction.');
  if(!code||keccak256(code).toLowerCase()!==config.codeHash.toLowerCase()||token.toLowerCase()!==USDT_ADDRESS.toLowerCase())throw new AppError('ROUTER_MISMATCH',503,'Payment verification configuration needs attention.');
  if(head<receipt.blockNumber+1n)throw new AppError('CONFIRMATION_PENDING',409,'The payment is still confirming.');
  const decoded=decodeEventLog({abi:routerAbi,eventName,data:log.data,topics:log.topics});const a=decoded.args;
  return {router:log.address.toLowerCase(),txHash,logIndex,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,blockTime:Number(block.timestamp),invoiceId:a.invoiceId,payer:a.payer.toLowerCase(),merchant:a.merchant.toLowerCase(),token:a.token.toLowerCase(),amount:a.amount.toString(),evidence:a.evidence,epoch:a.epoch.toString(),deadline:a.deadline.toString(),...('refundId'in a?{refundId:a.refundId}:{})};
}
async function recordObservedRefund(db:Database,paymentId:string,refunded:bigint) {
  const tenant=(await db.pool.query<{merchant_id:string}>('select c.merchant_id from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1',[paymentId])).rows[0];if(!tenant)return;
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[tenant.merchant_id]);
    const row=(await sql.query<CheckoutRow>('select c.* from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 for update of c,p',[paymentId])).rows[0];
    if(!row)return;
    if(refunded<0n||refunded>BigInt(row.amount))throw new AppError('CHAIN_STATE_MISMATCH',503,'Payment state requires review.');
    if(row.refund_hold&&row.status==='review')return;
    const version=row.state_version+1;
    await sql.query("update checkout_sessions set refund_hold=true,status='review',state_version=$2 where id=$1",[row.id,version]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'payment.refund_observed',$2)",[row.merchant_id,JSON.stringify({paymentId,refundAmountBaseUnits:refunded.toString(),stateVersion:version,deliveredGoodsCannotBeReversed:true})]);
    await insertDelivery(sql,paymentId,row.merchant_id,version,'payment.review');
  });
}
export async function paymentState(db:Database,merchantId:string,paymentId:string) {
  const row=(await db.pool.query<CheckoutRow&{payment_id:string;payer:string;tx_hash:Hex;log_index:number;block_number:string;block_hash:string;canonical:boolean}>('select c.*,p.id as payment_id,p.payer,p.tx_hash,p.log_index,p.block_number,p.block_hash,p.canonical from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2',[paymentId,merchantId])).rows[0];
  if(!row)throw new AppError('PAYMENT_NOT_FOUND',404,'This payment was not found.');
  let eligible=row.status==='accepted'&&row.canonical&&!row.refund_hold&&BigInt(row.refund_amount)===0n;
  let checkedPolicy:CheckedPolicy|undefined;
  if(eligible){
    const client=chainClient();const config=routerConfiguration();
    // Check the previously accepted height first. A missing receipt on a
    // healthy canonical block is provider unavailability, not proof of a reorg.
    const canonical=await client.getBlock({blockNumber:BigInt(row.block_number)});
    if(canonical.hash!==row.block_hash){await holdPayment(db,paymentId,'CHAIN_ORPHANED',Number(canonical.timestamp),row.block_hash);eligible=false;}
    if(eligible){
      try {
        const evidence=await verifiedReceipt(row.tx_hash,row.log_index);
        if(evidence.blockHash!==row.block_hash){await holdPayment(db,paymentId,'CHAIN_ORPHANED',undefined,row.block_hash);eligible=false;}
      } catch(error) {
        if(error instanceof AppError&&error.code==='CHAIN_ORPHANED'){await holdPayment(db,paymentId,'CHAIN_ORPHANED',undefined,row.block_hash);eligible=false;}
        else if(error instanceof TransactionReceiptNotFoundError)throw new AppError('RECEIPT_UNAVAILABLE',503,'Payment verification is temporarily unavailable. Please retry.');
        else throw error;
      }
    }
    if(eligible){
      const anchor=await client.getBlock({blockTag:'latest'});
      if(anchor.number===null||anchor.hash===null)throw new AppError('CHAIN_STATE_UNAVAILABLE',503,'Payment verification is temporarily unavailable.');
      const settlement=await client.readContract({address:config.router,abi:routerAbi,functionName:'payments',args:[row.invoice_id],blockNumber:anchor.number});
      const confirmed=await client.getBlock({blockNumber:anchor.number});
      if(confirmed.hash!==anchor.hash)throw new AppError('CHAIN_STATE_UNAVAILABLE',503,'Payment verification changed. Please retry.');
      if(settlement[0].toLowerCase()!==row.payer.toLowerCase()||settlement[1].toLowerCase()!==row.merchant_wallet.toLowerCase()||settlement[2]!==BigInt(row.amount)){await holdPayment(db,paymentId,'CHAIN_STATE_MISMATCH');eligible=false;}
      else if(settlement[3]>0n){await recordObservedRefund(db,paymentId,settlement[3]);eligible=false;}
    }
    if(eligible){try{checkedPolicy=await checkPaymentPolicy(db,[row.payer,row.merchant_wallet]);}catch(error){if(error instanceof AppError&&error.code==='SCREENING_DENIED'){await holdPayment(db,paymentId,'SCREENING_REVIEW');eligible=false;}else throw error;}}
  }
  // Grant issuance is a final transaction boundary: no expired or replaced
  // source/policy can acquire a fresh ten-second lifetime after slow RPC reads.
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[merchantId]);
    const current=(await sql.query<{status:string;state_version:number;refund_hold:boolean;refund_amount:string}>('select status,state_version,refund_hold,refund_amount from checkout_sessions where id=$1 for share',[row.id])).rows[0];
    eligible=eligible&&current.status==='accepted'&&!current.refund_hold&&BigInt(current.refund_amount)===0n&&current.state_version===row.state_version;
    if(eligible){try{await (await import('./operations.ts')).assertCollectionPayable(sql,row);}catch(error){if(error instanceof AppError)eligible=false;else throw error;}}
    let grantEnd=Date.now()+10_000;
    if(eligible){
      const source=(await sql.query('select snapshot,health from screening_sources where source_id=$1 for share',[OFAC_SOURCE_ID])).rows[0];
      const decisions=[row.payer,row.merchant_wallet].map(address=>evaluateWallet({address,snapshot:source?.snapshot??null,providerHealth:source?.health??{state:'unavailable',checkedAt:new Date().toISOString()}}));
      if(!checkedPolicy||source?.snapshot?.sha256!==checkedPolicy.sourceHash||source?.snapshot?.fetchedAt!==checkedPolicy.sourceFetchedAt||decisions.some(d=>d.state!=='allowed'))throw new AppError('SCREENING_CHANGED',503,'Current payment checks changed. Please retry.');
      grantEnd=Math.min(grantEnd,checkedPolicy.expiresAt,...decisions.map(d=>Date.parse(d.expiresAt)));
      if(grantEnd<=Date.now()+1000)throw new AppError('SCREENING_EXPIRED',503,'Current payment checks expired. Please retry.');
    }
    return {payment_id:paymentId,checkout_reference:row.reference,merchant_order_id:row.order_id,state_version:current.state_version,amount_base_units:row.amount,token:USDT_ADDRESS,chain_id:1874,payer:row.payer,merchant:row.merchant_wallet,confirmation_stage:'included_2_blocks',eligible,status:current.status,refund_hold:current.refund_hold,refund_amount_base_units:current.refund_amount,grant_expires_at:new Date(grantEnd).toISOString()};
  });
}
