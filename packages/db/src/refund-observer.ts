import {AppError,USDT_ADDRESS} from '@settlekit/core';
import type {Hex} from 'viem';
import type {Database} from './client.ts';
import {transaction} from './client.ts';
import {insertDelivery,verifiedReceipt,type PaymentObservation} from './observer.ts';
import {queueMappedCorrections,queuePublicCorrection,queuePublicReceipt} from './projection.ts';

export async function persistRefundObservation(db:Database,event:PaymentObservation){
  if(!event.refundId)throw new AppError('REFUND_EVENT_INVALID',409,'This log does not identify a refund.');
  const tenant=(await db.pool.query<{merchant_id:string}>('select merchant_id from checkout_sessions where invoice_id=$1',[event.invoiceId])).rows[0];if(!tenant)return false;
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[tenant.merchant_id]);
    const original=(await sql.query<{id:string;checkout_id:string;merchant_id:string;merchant_wallet:string;payer:string;amount:string;state_version:number;invoice_id:Hex;configured_router:string}>('select p.id,c.id as checkout_id,c.merchant_id,c.merchant_wallet,p.payer,c.amount,c.state_version,c.invoice_id,a.router as configured_router from payments p join checkout_sessions c on c.id=p.checkout_id join payment_authorizations a on a.id=p.authorization_id where c.invoice_id=$1 and p.canonical=true for update of c,p',[event.invoiceId])).rows[0];
    if(!original)return false;
    if(event.router.toLowerCase()!==original.configured_router.toLowerCase()||event.payer!==original.payer||event.merchant!==original.merchant_wallet||event.token.toLowerCase()!==USDT_ADDRESS.toLowerCase()||BigInt(event.amount)<=0n||BigInt(event.amount)>BigInt(original.amount)||event.blockTime>Number(event.deadline))throw new AppError('REFUND_EVENT_MISMATCH',409,'Refund evidence does not match the original payment.');
    const intent=(await sql.query<{id:string;amount:string;payment_id:string}>('select id,amount,payment_id from refund_intents where refund_id=$1 for update',[event.refundId])).rows[0];
    if(intent&&(intent.payment_id!==original.id||intent.amount!==event.amount))throw new AppError('REFUND_EVENT_MISMATCH',409,'Refund evidence does not match its immutable intent.');
    let localAuthorizationGap=false;
    if(intent){const authorization=(await sql.query<{payload:Record<string,string>}>('select payload from refund_authorizations where intent_id=$1 and evidence=$2',[intent.id,event.evidence])).rows[0];localAuthorizationGap=!authorization||authorization.payload.epoch!==event.epoch||authorization.payload.deadline!==event.deadline;}
    const existing=(await sql.query<{canonical:boolean;block_hash:string}>('select canonical,block_hash from refund_events where tx_hash=$1 and log_index=$2',[event.txHash,event.logIndex])).rows[0];if(existing?.canonical&&existing.block_hash===event.blockHash)return false;
    await sql.query('insert into refund_events(merchant_id,payment_id,intent_id,refund_id,amount,tx_hash,log_index,block_number,block_hash,block_time) values($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10)) on conflict(tx_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,block_time=excluded.block_time,canonical=true',[original.merchant_id,original.id,intent?.id??null,event.refundId,event.amount,event.txHash,event.logIndex,event.blockNumber,event.blockHash,event.blockTime]);
    const total=(await sql.query<{amount:string}>('select coalesce(sum(amount),0)::text as amount from refund_events where payment_id=$1 and canonical=true',[original.id])).rows[0].amount;
    if(BigInt(total)>BigInt(original.amount))throw new AppError('REFUND_TOTAL_INVALID',409,'Canonical refund totals exceed the original payment.');
    const version=original.state_version+1;
    await sql.query("update checkout_sessions set refund_amount=$2,refund_hold=true,status='review',state_version=$3 where id=$1",[original.checkout_id,total,version]);
    if(intent)await sql.query("update refund_intents set status='confirmed',version=version+1,updated_at=now(),reason_code=$2 where id=$1",[intent.id,localAuthorizationGap?'LOCAL_AUTHORIZATION_EVIDENCE_GAP':null]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'refund.confirmed',$2)",[original.merchant_id,JSON.stringify({paymentId:original.id,intentId:intent?.id??null,refundId:event.refundId,amountBaseUnits:event.amount,txHash:event.txHash,blockHash:event.blockHash,stateVersion:version,localAuthorizationGap})]);
    await insertDelivery(sql,original.id,original.merchant_id,version,'payment.review');
    await queuePublicReceipt(sql,original.merchant_id,{schemaVersion:1,kind:'refund',chainId:1874,router:event.router as Hex,token:USDT_ADDRESS,invoiceId:original.invoice_id,refundId:event.refundId as Hex,payer:event.payer as Hex,merchant:event.merchant as Hex,amountBaseUnits:event.amount,txHash:event.txHash as Hex,logIndex:event.logIndex,blockNumber:event.blockNumber,blockHash:event.blockHash as Hex,sourceTimestamp:event.blockTime});return true;
  });
}
export async function retractRefund(db:Database,id:string,replacementTimestamp?:number,expectedBlockHash?:string){
  const tenant=(await db.pool.query<{merchant_id:string}>('select merchant_id from refund_events where id=$1',[id])).rows[0];if(!tenant)return;
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[tenant.merchant_id]);
    const event=(await sql.query<{payment_id:string;intent_id:string|null;merchant_id:string;amount:string;canonical:boolean;refund_id:Hex;tx_hash:Hex;log_index:number;block_number:string;block_hash:Hex}>('select * from refund_events where id=$1 for update',[id])).rows[0];if(!event)return;
    const checkout=(await sql.query<{id:string;state_version:number;invoice_id:Hex;merchant_wallet:Hex;payer:Hex;configured_router:Hex}>('select c.id,c.state_version,c.invoice_id,c.merchant_wallet,p.payer,a.router as configured_router from payments p join checkout_sessions c on c.id=p.checkout_id join payment_authorizations a on a.id=p.authorization_id where p.id=$1 for update of c',[event.payment_id])).rows[0];
    if(expectedBlockHash&&event.block_hash.toLowerCase()!==expectedBlockHash.toLowerCase()){await queueMappedCorrections(sql,event.merchant_id,'refund',checkout.invoice_id,expectedBlockHash.toLowerCase(),replacementTimestamp,event.refund_id);return;}
    await queuePublicCorrection(sql,event.merchant_id,{schemaVersion:1,chainId:1874,router:checkout.configured_router,token:USDT_ADDRESS,invoiceId:checkout.invoice_id,refundId:event.refund_id,payer:checkout.payer,merchant:checkout.merchant_wallet,txHash:event.tx_hash,logIndex:event.log_index,blockNumber:event.block_number,blockHash:event.block_hash},replacementTimestamp);
    if(!event.canonical)return;
    await sql.query('update refund_events set canonical=false where id=$1',[id]);
    const total=(await sql.query<{amount:string}>('select coalesce(sum(amount),0)::text as amount from refund_events where payment_id=$1 and canonical=true',[event.payment_id])).rows[0].amount;
    const version=checkout.state_version+1;await sql.query("update checkout_sessions set refund_amount=$2,refund_hold=true,status='review',state_version=$3 where id=$1",[checkout.id,total,version]);
    if(event.intent_id)await sql.query("update refund_intents set status='review',reason_code='REFUND_ORPHANED',version=version+1,updated_at=now() where id=$1",[event.intent_id]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'refund.orphaned',$2)",[event.merchant_id,JSON.stringify({refundEventId:id,paymentId:event.payment_id,stateVersion:version,manualReview:true})]);await insertDelivery(sql,event.payment_id,event.merchant_id,version,'payment.review');
  });
}
export const verifiedRefundReceipt=(txHash:Hex,logIndex:number)=>verifiedReceipt(txHash,logIndex,'RefundExecuted');
