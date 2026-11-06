import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {keccak256,toHex,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {AppError,baseUnitsSchema,USDT_ADDRESS} from '@settlekit/core';
import {refundTypes,routerDomain} from '@settlekit/core/router';
import {hashToken,randomToken} from '@settlekit/core/server';
import {evaluateWallet,OFAC_SOURCE_ID} from '@settlekit/screening';
import {transaction,type Database} from './client.ts';
import {chainClient,checkPaymentPolicy,routerConfiguration} from './policy.ts';
import {holdPayment,insertDelivery,verifiedReceipt} from './observer.ts';

const createInput=z.object({paymentId:z.string().uuid(),amountBaseUnits:baseUnitsSchema.refine(v=>BigInt(v)>0n),idempotencyKey:z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/)}).strict();
interface MonetaryPayment {id:string;merchant_id:string;checkout_id:string;invoice_id:Hex;merchant_wallet:Hex;payer:Hex;amount:string;block_number:string;block_hash:Hex;tx_hash:Hex;log_index:number;canonical:boolean;state_version:number}
interface Intent {id:string;merchant_id:string;payment_id:string;refund_id:Hex;idempotency_key:string;request_hash:string;amount:string;status:string;version:number;submitted_tx_hash:string|null;created_at:Date;updated_at:Date;reason_code:string|null}
const reserving="('requested','authorized','submitted','cancel_pending','review')";

/** Monetary truth is independent of fulfillment eligibility and deliberate refund holds. */
export async function verifiedMonetaryPayment(db:Database,merchantId:string,paymentId:string) {
  const row=(await db.pool.query<MonetaryPayment>('select p.id,c.merchant_id,c.id as checkout_id,c.invoice_id,c.merchant_wallet,p.payer,c.amount,p.block_number,p.block_hash,p.tx_hash,p.log_index,p.canonical,c.state_version from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2',[paymentId,merchantId])).rows[0];
  if(!row)throw new AppError('PAYMENT_NOT_FOUND',404,'This payment was not found.');
  if(!row.canonical)throw new AppError('PAYMENT_NOT_CANONICAL',409,'This payment requires chain review before a refund.');
  const client=chainClient();const config=routerConfiguration();
  const canonical=await client.getBlock({blockNumber:BigInt(row.block_number)});
  if(canonical.hash!==row.block_hash){await holdPayment(db,row.id,'CHAIN_ORPHANED',Number(canonical.timestamp),row.block_hash);throw new AppError('PAYMENT_NOT_CANONICAL',409,'This payment requires review after a chain correction.');}
  const event=await verifiedReceipt(row.tx_hash,row.log_index);
  if(event.invoiceId!==row.invoice_id||event.payer!==row.payer||event.merchant!==row.merchant_wallet||event.amount!==row.amount||event.blockHash!==row.block_hash)throw new AppError('PAYMENT_EVIDENCE_MISMATCH',409,'Payment evidence needs review.');
  const anchor=await client.getBlock({blockTag:'latest'});if(anchor.number===null||anchor.hash===null)throw new AppError('CHAIN_UNAVAILABLE',503,'Chain state is unavailable. Please retry.');
  const original=await client.readContract({address:config.router,abi:(await import('@settlekit/core/router')).routerAbi,functionName:'payments',args:[row.invoice_id],blockNumber:anchor.number});
  if((await client.getBlock({blockNumber:anchor.number})).hash!==anchor.hash||original[0].toLowerCase()!==row.payer||original[1].toLowerCase()!==row.merchant_wallet||original[2]!==BigInt(row.amount)||original[3]>original[2])throw new AppError('PAYMENT_EVIDENCE_MISMATCH',409,'Current payment state needs review.');
  return {payment:row,refunded:original[3],remaining:original[2]-original[3],router:config.router,blockNumber:anchor.number,blockTime:Number(anchor.timestamp)};
}
export async function createRefundIntent(db:Database,merchantId:string,input:unknown,read=verifiedMonetaryPayment) {
  const data=createInput.parse(input);const requestHash=hashToken(JSON.stringify({paymentId:data.paymentId,amountBaseUnits:data.amountBaseUnits}));
  const previous=(await db.pool.query<Intent>('select * from refund_intents where merchant_id=$1 and idempotency_key=$2',[merchantId,data.idempotencyKey])).rows[0];
  if(previous){if(previous.request_hash!==requestHash)throw new AppError('IDEMPOTENCY_CONFLICT',409,'This refund key was already used for another request.');return refundView(previous);}
  const chain=await read(db,merchantId,data.paymentId);
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[merchantId]);
    const currentMoney=(await sql.query<{amount:string;refund_amount:string;canonical:boolean}>('select c.amount,c.refund_amount,p.canonical from checkout_sessions c join payments p on p.checkout_id=c.id where c.id=$1 for update of c,p',[chain.payment.checkout_id])).rows[0];
    if(!currentMoney?.canonical)throw new AppError('PAYMENT_NOT_CANONICAL',409,'The payment changed before this refund request.');
    const privateRemaining=BigInt(currentMoney.amount)-BigInt(currentMoney.refund_amount);const effectiveRemaining=chain.remaining<privateRemaining?chain.remaining:privateRemaining;
    const exists=(await sql.query<Intent>('select * from refund_intents where merchant_id=$1 and idempotency_key=$2',[merchantId,data.idempotencyKey])).rows[0];
    if(exists){if(exists.request_hash!==requestHash)throw new AppError('IDEMPOTENCY_CONFLICT',409,'This refund key was already used for another request.');return refundView(exists);}
    const reserved=(await sql.query<{amount:string}>(`select coalesce(sum(amount),0)::text as amount from refund_intents where payment_id=$1 and status in ${reserving}`,[data.paymentId])).rows[0].amount;
    if(BigInt(data.amountBaseUnits)+BigInt(reserved)>effectiveRemaining)throw new AppError('REFUND_EXCEEDS_REMAINING',409,'This amount exceeds the unreserved refundable amount.');
    const id=randomUUID();const refundId=keccak256(toHex(randomToken()));
    const row=(await sql.query<Intent>('insert into refund_intents(id,merchant_id,payment_id,refund_id,idempotency_key,request_hash,amount) values($1,$2,$3,$4,$5,$6,$7) returning *',[id,merchantId,data.paymentId,refundId,data.idempotencyKey,requestHash,data.amountBaseUnits])).rows[0];
    const version=(await sql.query<{state_version:number}>('update checkout_sessions set refund_hold=true,state_version=state_version+1 where id=$1 returning state_version',[chain.payment.checkout_id])).rows[0].state_version;
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'refund.requested',$2)",[merchantId,JSON.stringify({intentId:id,paymentId:data.paymentId,amountBaseUnits:data.amountBaseUnits,stateVersion:version})]);
    await insertDelivery(sql,data.paymentId,merchantId,version,'payment.review');
    return refundView(row);
  });
}
function refundView(row:Intent){return {id:row.id,paymentId:row.payment_id,refundId:row.refund_id,amountBaseUnits:row.amount,status:row.status,version:row.version,submittedTxHash:row.submitted_tx_hash,reasonCode:row.reason_code,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()};}
export async function listRefunds(db:Database,merchantId:string,paymentId?:string){
  const rows=(await db.pool.query<Intent>(`select * from refund_intents where merchant_id=$1 ${paymentId?'and payment_id=$2':''} order by created_at desc limit 100`,paymentId?[merchantId,paymentId]:[merchantId])).rows;
  return {items:rows.map(refundView)};
}
export async function refundDetail(db:Database,merchantId:string,id:string){
  const row=(await db.pool.query<Intent>('select * from refund_intents where id=$1 and merchant_id=$2',[id,merchantId])).rows[0];if(!row)throw new AppError('REFUND_NOT_FOUND',404,'This refund was not found.');
  const payment=(await db.pool.query<{payer:string;merchant_wallet:string;amount:string;refund_amount:string;invoice_id:string}>('select p.payer,c.merchant_wallet,c.amount,c.refund_amount,c.invoice_id from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1 and c.merchant_id=$2',[row.payment_id,merchantId])).rows[0];
  const authorizations=(await db.pool.query('select epoch::text,deadline,created_at from refund_authorizations where intent_id=$1 order by created_at desc limit 20',[id])).rows;
  const events=(await db.pool.query('select amount::text as "amountBaseUnits",tx_hash as "txHash",block_number::text as "blockNumber",block_hash as "blockHash",block_time as "sourceAt",canonical from refund_events where intent_id=$1 order by block_number desc',[id])).rows;
  return {...refundView(row),payer:payment.payer,merchantWallet:payment.merchant_wallet,originalAmountBaseUnits:payment.amount,canonicalRefundedBaseUnits:payment.refund_amount,invoiceId:payment.invoice_id,token:USDT_ADDRESS,chainId:1874,authorizations,events};
}
export async function authorizeRefund(db:Database,merchantId:string,id:string) {
  const intent=(await db.pool.query<Intent>('select * from refund_intents where id=$1 and merchant_id=$2',[id,merchantId])).rows[0];if(!intent)throw new AppError('REFUND_NOT_FOUND',404,'This refund was not found.');
  if(!['requested','authorized','review'].includes(intent.status))throw new AppError('REFUND_NOT_AUTHORIZABLE',409,'This refund cannot receive another authorization.');
  const chain=await verifiedMonetaryPayment(db,merchantId,intent.payment_id);const p=chain.payment;
  if(await chainClient().readContract({address:chain.router,abi:(await import('@settlekit/core/router')).routerAbi,functionName:'usedRefunds',args:[intent.refund_id],blockNumber:chain.blockNumber}))throw new AppError('REFUND_ALREADY_EXECUTED',409,'This refund already executed. Waiting for canonical observation.');
  const policy=await checkPaymentPolicy(db,[p.payer,p.merchant_wallet]);
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[merchantId]);
    const currentMoney=(await sql.query<{amount:string;refund_amount:string;canonical:boolean}>('select c.amount,c.refund_amount,p.canonical from checkout_sessions c join payments p on p.checkout_id=c.id where c.id=$1 for update of c,p',[p.checkout_id])).rows[0];
    if(!currentMoney?.canonical)throw new AppError('PAYMENT_NOT_CANONICAL',409,'The payment changed before refund authorization.');
    const privateRemaining=BigInt(currentMoney.amount)-BigInt(currentMoney.refund_amount);const effectiveRemaining=chain.remaining<privateRemaining?chain.remaining:privateRemaining;
    const current=(await sql.query<Intent>('select * from refund_intents where id=$1 for update',[id])).rows[0];
    if(!['requested','authorized','review'].includes(current.status))throw new AppError('REFUND_NOT_AUTHORIZABLE',409,'This refund changed. Reload it before continuing.');
    const reserved=(await sql.query<{amount:string}>(`select coalesce(sum(amount),0)::text as amount from refund_intents where payment_id=$1 and id<>$2 and status in ${reserving}`,[intent.payment_id,id])).rows[0].amount;
    if(BigInt(intent.amount)+BigInt(reserved)>effectiveRemaining)throw new AppError('REFUND_EXCEEDS_REMAINING',409,'Current chain state leaves insufficient refundable value.');
    const source=(await sql.query('select snapshot,health from screening_sources where source_id=$1 for share',[OFAC_SOURCE_ID])).rows[0];
    const decisions=[p.payer,p.merchant_wallet].map(address=>evaluateWallet({address,snapshot:source?.snapshot??null,providerHealth:source?.health??{state:'unavailable',checkedAt:new Date().toISOString()}}));
    if(source?.snapshot?.sha256!==policy.sourceHash||source?.snapshot?.fetchedAt!==policy.sourceFetchedAt||decisions.some(d=>d.state!=='allowed')||Date.now()-policy.checkedAt>15000)throw new AppError('SCREENING_CHANGED',409,'Required refund checks changed. Please try again.');
    const deadline=BigInt(Math.floor(Math.min(Date.now()+60000,policy.expiresAt,...decisions.map(d=>Date.parse(d.expiresAt)))/1000));
    if(deadline*1000n<=BigInt(Date.now()+3000))throw new AppError('SCREENING_EXPIRED',409,'Required refund checks expired. Please retry.');
    const evidence=keccak256(toHex(JSON.stringify({nonce:randomToken(),refundId:current.refund_id,sourceHash:policy.sourceHash,epoch:policy.epoch.toString()})));
    const authorization={refundId:current.refund_id,invoiceId:p.invoice_id,payer:p.payer,merchant:p.merchant_wallet,token:USDT_ADDRESS,amount:current.amount,evidence,epoch:policy.epoch.toString(),deadline:deadline.toString()};
    const signature=await privateKeyToAccount(process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY as Hex).signTypedData({domain:routerDomain(1874,policy.router),types:refundTypes,primaryType:'Refund',message:{...authorization,amount:BigInt(current.amount),epoch:policy.epoch,deadline}});
    await sql.query('insert into refund_authorizations(intent_id,evidence,epoch,deadline,payload,signature) values($1,$2,$3,to_timestamp($4),$5,$6)',[id,evidence,policy.epoch.toString(),deadline.toString(),JSON.stringify(authorization),signature]);
    await sql.query("update refund_intents set status='authorized',version=version+1,updated_at=now(),reason_code=null where id=$1",[id]);
    return {authorization,signature,router:policy.router,screening:{payer:decisions[0],merchant:decisions[1]}};
  });
}
export async function submitRefundHint(db:Database,merchantId:string,id:string,txHash:string){
  if(!/^0x[0-9a-f]{64}$/i.test(txHash))throw new AppError('INVALID_TRANSACTION',400,'Enter a valid transaction hash.');
  return transaction(db,async sql=>{await sql.query('select id from merchants where id=$1 for update',[merchantId]);const row=await sql.query("update refund_intents set submitted_tx_hash=$3,status='submitted',version=version+1,updated_at=now() where id=$1 and merchant_id=$2 and status in ('authorized','submitted') returning id",[id,merchantId,txHash]);
    if(!row.rowCount)throw new AppError('REFUND_NOT_SUBMITTABLE',409,'Reload the refund before recording this submission.');await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'refund.submitted',$2)",[merchantId,JSON.stringify({intentId:id,txHash,untrustedHint:true})]);return {submitted:true};});
}
export async function cancelRefund(db:Database,merchantId:string,id:string){
  await transaction(db,async sql=>{await sql.query('select id from merchants where id=$1 for update',[merchantId]);const row=await sql.query("update refund_intents set status='cancel_pending',version=version+1,updated_at=now() where id=$1 and merchant_id=$2 and status in ('requested','authorized','submitted','review') returning id",[id,merchantId]);
    if(!row.rowCount)throw new AppError('REFUND_NOT_CANCELLABLE',409,'This refund cannot be cancelled.');await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'refund.cancel_requested',$2)",[merchantId,JSON.stringify({intentId:id,holdRetained:true})]);});return releaseRefundHold(db,merchantId,id);
}
export async function releaseRefundHold(db:Database,merchantId:string,id:string){
  const intent=(await db.pool.query<Intent>('select * from refund_intents where id=$1 and merchant_id=$2',[id,merchantId])).rows[0];if(!intent)throw new AppError('REFUND_NOT_FOUND',404,'This refund was not found.');
  if(intent.status!=='cancel_pending')throw new AppError('REFUND_NOT_CANCEL_PENDING',409,'Only a pending cancellation may release its reservation.');
  const chain=await verifiedMonetaryPayment(db,merchantId,intent.payment_id);const client=chainClient();const {routerAbi}=await import('@settlekit/core/router');
  // Never assume cancellation revokes an outstanding signed payload.
  const active=(await db.pool.query<{n:number}>('select count(*)::integer as n from refund_authorizations where intent_id=$1 and deadline>=now()',[id])).rows[0].n;
  if(active)return {cancelPending:true,message:'The hold remains until all signed refund authorizations expire and chain state is checked again.'};
  // Even an expired authorization may already be in an unaccepted recent block.
  const latest=await client.getBlock({blockTag:'latest'});if(latest.number===null||latest.number<1n)throw new AppError('CHAIN_UNAVAILABLE',503,'Accepted chain state is unavailable.');
  const accepted=await client.getBlock({blockNumber:latest.number-1n});if(accepted.number===null||accepted.hash===null)throw new AppError('CHAIN_UNAVAILABLE',503,'Accepted chain state is unavailable.');
  const max=(await db.pool.query<{deadline:Date|null}>('select max(deadline) as deadline from refund_authorizations where intent_id=$1',[id])).rows[0].deadline;
  if(max&&Number(accepted.timestamp)*1000<=max.getTime())return {cancelPending:true,message:'Waiting for the authorization window to pass the accepted block stage.'};
  const [used,settlement]=await Promise.all([client.readContract({address:chain.router,abi:routerAbi,functionName:'usedRefunds',args:[intent.refund_id],blockNumber:accepted.number}),client.readContract({address:chain.router,abi:routerAbi,functionName:'payments',args:[chain.payment.invoice_id],blockNumber:accepted.number})]);
  if((await client.getBlock({blockNumber:accepted.number})).hash!==accepted.hash||settlement[0].toLowerCase()!==chain.payment.payer||settlement[1].toLowerCase()!==chain.payment.merchant_wallet||settlement[2]!==BigInt(chain.payment.amount))throw new AppError('CHAIN_STATE_CHANGED',503,'Accepted chain evidence changed. Please retry.');
  if(used)throw new AppError('REFUND_ALREADY_EXECUTED',409,'This refund executed onchain. Waiting for canonical observation.');
  await transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[merchantId]);
    await sql.query('select id from checkout_sessions where id=$1 for update',[chain.payment.checkout_id]);
    const current=(await sql.query<Intent>('select * from refund_intents where id=$1 for update',[id])).rows[0];if(current.status!=='cancel_pending')throw new AppError('REFUND_CHANGED',409,'Refund state changed. Reload it.');
    if((await sql.query('select 1 from refund_authorizations where intent_id=$1 and deadline>=now()',[id])).rowCount)throw new AppError('AUTHORIZATION_OUTSTANDING',409,'An executable refund authorization remains outstanding.');
    await sql.query("update refund_intents set status='cancelled',version=version+1,updated_at=now() where id=$1",[id]);
    const others=(await sql.query<{n:number}>(`select count(*)::integer as n from refund_intents where payment_id=$1 and id<>$2 and status in ${reserving}`,[intent.payment_id,id])).rows[0].n;
    // Releasing a reservation never resumes fulfillment automatically; current
    // risk/order/canonical review remains explicit after any refund request.
    const version=(await sql.query<{state_version:number}>("update checkout_sessions set refund_hold=$2,status='review',state_version=state_version+1 where id=$1 returning state_version",[chain.payment.checkout_id,others>0||chain.refunded>0n||settlement[3]>0n])).rows[0].state_version;
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'refund.cancelled',$2)",[merchantId,JSON.stringify({intentId:id,paymentId:intent.payment_id,stateVersion:version,fulfillmentRequiresReview:true})]);
    await insertDelivery(sql,intent.payment_id,merchantId,version,'payment.review');
  });return {cancelPending:false,cancelled:true};
}
