import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSiweMessage } from 'viem/siwe';
import { createWalletClient, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainSepolia } from 'viem/chains';
import { AppError, addressSchema, baseUnitsSchema, USDT_ADDRESS, WHITECHAIN_CHAIN_ID } from '@settlekit/core';
import { paymentTypes, routerAbi, routerDomain } from '@settlekit/core/router';
import { hashToken, randomToken, runtimeConfig } from '@settlekit/core/server';
import { transaction, type Database } from './client.ts';
import { chainClient, checkPaymentPolicy, sourceState, type CheckedPolicy } from './policy.ts';
import { evaluateWallet } from '@settlekit/screening';
import { readStoreOrder } from './integration.ts';

export const createCheckoutInput=z.object({order_id:z.string().min(1).max(120),amount_base_units:baseUnitsSchema.refine(v=>BigInt(v)>0n),return_url:z.string().url().max(500)}).strict();
export interface CheckoutRow {id:string;reference:string;merchant_id:string;order_id:string;invoice_id:Hex;merchant_wallet:Hex;amount:string;return_url:string;status:string;state_version:number;refund_hold:boolean;refund_amount:string;risk_state:string;submitted_tx_hash:string|null;mode:'store'|'collection';collection_order_id:string|null;expires_at:Date;created_at:Date}
export async function authenticateApiKey(db:Database,bearer:string|null,scope:'checkout:create'|'payment:read'='checkout:create'):Promise<string> {
  return (await import('./operations.ts')).authenticateOperationKey(db,bearer,scope);
}
export async function createCheckout(db:Database,merchantId:string,key:string|null,input:unknown,orderRead=readStoreOrder,collectionOrderId?:string) {
  const data=createCheckoutInput.parse(input);
  if(!key||!/^[a-zA-Z0-9_.:-]{8,128}$/.test(key))throw new AppError('IDEMPOTENCY_REQUIRED',400,'Use a unique Idempotency-Key for this order.');
  const order=await orderRead(db,merchantId,data.order_id,data.amount_base_units);
  const requestHash=hashToken(JSON.stringify(data));
  return transaction(db,async sql=>{
    const merchant=await sql.query<{settlement_wallet:string;website_origin:string;display_name:string}>('select settlement_wallet,website_origin,display_name from merchants where id=$1 for update',[merchantId]);
    const m=merchant.rows[0];if(!m?.display_name||!m.website_origin)throw new AppError('SETUP_REQUIRED',409,'Complete the merchant profile before creating a checkout.');
    await (await import('./operations.ts')).assertCollectionPayable(sql,{merchant_id:merchantId,amount:data.amount_base_units,mode:collectionOrderId?'collection':'store',collection_order_id:collectionOrderId??null});
    const url=new URL(data.return_url);
    if(url.origin!==(collectionOrderId?runtimeConfig().origin:m.website_origin)||url.username||url.password||url.hash)throw new AppError('RETURN_URL_DENIED',400,'Use a return URL on the approved merchant origin.');
    const existing=await sql.query<CheckoutRow&{request_hash:string;idempotency_key:string}>('select * from checkout_sessions where merchant_id=$1 and (idempotency_key=$2 or order_id=$3)',[merchantId,key,data.order_id]);
    if(existing.rows[0]){const row=existing.rows[0];if(row.request_hash!==requestHash||row.idempotency_key!==key)throw new AppError('IDEMPOTENCY_CONFLICT',409,'This order or key was already used with a different request.');return {reference:row.reference,checkout_url:`${runtimeConfig().origin}/checkout/${row.reference}`};}
    if(order.state!=='pending')throw new AppError('ORDER_CLOSED',409,'This merchant order is no longer payable.');
    const reference=randomToken();const invoice=keccak256(toHex(randomToken()));
    if(collectionOrderId)z.string().uuid().parse(collectionOrderId);
    await sql.query("insert into checkout_sessions(reference,merchant_id,order_id,idempotency_key,request_hash,invoice_id,merchant_wallet,amount,return_url,mode,collection_order_id,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '30 minutes')",[reference,merchantId,data.order_id,key,requestHash,invoice,m.settlement_wallet,data.amount_base_units,url.href,collectionOrderId?'collection':'store',collectionOrderId??null]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'checkout.created',$2)",[merchantId,JSON.stringify({invoiceId:invoice,amount:data.amount_base_units})]);
    return {reference,checkout_url:`${runtimeConfig().origin}/checkout/${reference}`};
  });
}
export async function checkoutRow(db:Database,reference:string):Promise<CheckoutRow> {
  if(!/^[a-f0-9]{64}$/.test(reference))throw new AppError('CHECKOUT_NOT_FOUND',404,'This checkout could not be found.');
  const row=(await db.pool.query<CheckoutRow>('select * from checkout_sessions where reference=$1',[reference])).rows[0];if(!row)throw new AppError('CHECKOUT_NOT_FOUND',404,'This checkout could not be found.');return row;
}
export async function publicCheckout(db:Database,reference:string) {
  const row=await checkoutRow(db,reference);
  const detail=(await db.pool.query<{display_name:string;payment_id:string|null;delivery_status:string|null}>(`select m.display_name,p.id as payment_id,(select status from webhook_deliveries where payment_id=p.id order by state_version desc limit 1) as delivery_status from merchants m left join payments p on p.checkout_id=$2 where m.id=$1`,[row.merchant_id,row.id])).rows[0];
  const sponsorBuyerGas = process.env.SPONSOR_BUYER_GAS==='true' && /^0x[0-9a-fA-F]{64}$/.test(process.env.SPONSOR_RELAYER_PRIVATE_KEY ?? '');
  return {reference,mode:row.mode,amount_base_units:row.amount,merchant_name:detail.display_name,merchant_wallet:row.merchant_wallet,status:row.status==='open'&&row.expires_at.getTime()<=Date.now()?'expired':row.status,payment_id:detail.payment_id,confirmation_stage:'included_2_blocks',router:process.env.WHITECHAIN_ROUTER_ADDRESS??null,token:USDT_ADDRESS,chain_id:1874,expires_at:row.expires_at.toISOString(),return_url:row.return_url,delivery_status:detail.delivery_status,tx_hash:row.submitted_tx_hash,sponsor_buyer_gas:sponsorBuyerGas};
}
function payable(row:CheckoutRow) {if(row.status!=='open'||row.refund_hold||row.expires_at.getTime()<=Date.now())throw new AppError('CHECKOUT_CLOSED',409,'This checkout is no longer available for a new payment.');}
export async function requestPayerChallenge(db:Database,reference:string,addressInput:string,browserToken:string) {
  const row=await checkoutRow(db,reference);payable(row);const address=addressSchema.parse(addressInput);
  const config=runtimeConfig();const id=randomUUID();const expiresAt=new Date(Math.min(Date.now()+300_000,row.expires_at.getTime()));
  const message=createSiweMessage({address:address as Hex,chainId:1874,domain:config.domain,uri:`${config.origin}/checkout/${reference}`,version:'1',nonce:randomToken(),issuedAt:new Date(),expirationTime:expiresAt,statement:'Prove this payment wallet to SettleKit. This signature does not transfer tokens.',resources:[`urn:settlekit:checkout:${row.invoice_id}`]});
  await transaction(db,async sql=>{
    const budget=await sql.query<{count:number}>(`insert into request_budgets(key,count,reset_at) values($1,1,now()+interval '1 minute') on conflict(key) do update set count=case when request_budgets.reset_at<=now() then 1 else request_budgets.count+1 end,reset_at=case when request_budgets.reset_at<=now() then now()+interval '1 minute' else request_budgets.reset_at end returning count`,[`payer:${row.id}`]);
    if(budget.rows[0].count>12)throw new AppError('RATE_LIMITED',429,'Please wait a minute before trying again.');
    await sql.query('insert into payer_challenges(id,checkout_id,payer,browser_hash,message,expires_at) values($1,$2,$3,$4,$5,$6)',[id,row.id,address,hashToken(browserToken),message,expiresAt]);
  });return {id,message};
}
export async function authorizeCheckout(db:Database,reference:string,input:{id:string;signature:Hex;browserToken:string},policyCheck=checkPaymentPolicy) {
  const row=await checkoutRow(db,reference);payable(row);
  const order=row.mode==='collection'?await (await import('./operations.ts')).readInternalOrder(db,row.merchant_id,row.order_id,row.amount):await readStoreOrder(db,row.merchant_id,row.order_id,row.amount);
  if(!order||order.state!=='pending')throw new AppError('ORDER_CLOSED',409,'This merchant order is no longer payable.');
  const challenge=(await db.pool.query<{payer:Hex;message:string;browser_hash:string;expires_at:Date;consumed_at:Date|null}>('select * from payer_challenges where id=$1 and checkout_id=$2',[input.id,row.id])).rows[0];
  if(!challenge||challenge.consumed_at||challenge.expires_at.getTime()<=Date.now()||challenge.browser_hash!==hashToken(input.browserToken))throw new AppError('PAYER_PROOF_INVALID',400,'This payment wallet request expired. Connect and sign again.');
  const valid=await chainClient().verifySiweMessage({address:challenge.payer,message:challenge.message,signature:input.signature,domain:runtimeConfig().domain,time:new Date()});
  if(!valid)throw new AppError('PAYER_PROOF_INVALID',400,'The signature did not prove this payment wallet.');
  const policy=await policyCheck(db,[challenge.payer,row.merchant_wallet]);
  return transaction(db,async sql=>{
    await sql.query('select id from merchants where id=$1 for update',[row.merchant_id]);
    const current=(await sql.query<CheckoutRow>('select * from checkout_sessions where id=$1 for update',[row.id])).rows[0];payable(current);
    await (await import('./operations.ts')).assertCollectionPayable(sql,current);
    // Lock the source to prevent an importer from replacing/failing it between check and commit.
    const source=(await sql.query('select snapshot,health from screening_sources where source_id=$1 for share',['ofac-sdn-ethereum-addresses'])).rows[0];
    if(!source||source.snapshot?.sha256!==policy.sourceHash||source.snapshot?.fetchedAt!==policy.sourceFetchedAt||[challenge.payer,row.merchant_wallet].some(address=>evaluateWallet({address,snapshot:source.snapshot,providerHealth:source.health}).state!=='allowed')||Date.now()-policy.checkedAt>15_000)throw new AppError('SCREENING_CHANGED',409,'Payment checks changed. Please check again.');
    const consumed=await sql.query('update payer_challenges set consumed_at=now() where id=$1 and consumed_at is null and expires_at>now() returning id',[input.id]);if(consumed.rowCount!==1)throw new AppError('PAYER_PROOF_USED',409,'This wallet request was already used. Connect and sign again.');
    const deadline=BigInt(Math.floor(Math.min(Date.now()+60_000,policy.expiresAt,current.expires_at.getTime())/1000));if(deadline*1000n<=BigInt(Date.now()+3000))throw new AppError('SCREENING_EXPIRED',409,'Payment checks expired. Please try again.');
    const evidence=keccak256(toHex(JSON.stringify({nonce:randomToken(),sourceHash:policy.sourceHash,sourceFetchedAt:policy.sourceFetchedAt,epoch:policy.epoch.toString(),version:current.state_version})));
    const authorization={invoiceId:current.invoice_id,payer:challenge.payer,merchant:current.merchant_wallet,token:USDT_ADDRESS,amount:current.amount,evidence,epoch:policy.epoch.toString(),deadline:deadline.toString()};
    const signature=await privateKeyToAccount(process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY as Hex).signTypedData({domain:routerDomain(WHITECHAIN_CHAIN_ID,policy.router),types:paymentTypes,primaryType:'Payment',message:{...authorization,amount:BigInt(authorization.amount),epoch:policy.epoch,deadline}});
    await sql.query('insert into payment_authorizations(checkout_id,payer,router,evidence,epoch,deadline,payload,signature) values($1,$2,$3,$4,$5,to_timestamp($6),$7,$8)',[row.id,challenge.payer.toLowerCase(),policy.router.toLowerCase(),evidence,policy.epoch.toString(),deadline.toString(),JSON.stringify(authorization),signature]);
    await sql.query("update checkout_sessions set risk_state='allowed' where id=$1",[row.id]);
    return {authorization,signature,router:policy.router};
  });
}
export async function listPayments(db:Database,merchantId:string,id?:string) {
  const result=await db.pool.query(`select p.id,c.reference,c.order_id,c.amount::text as amount_base_units,c.status,'included_2_blocks' as confirmation_stage,c.risk_state,c.state_version,c.created_at,p.payer,p.tx_hash,(select status from webhook_deliveries where payment_id=p.id order by state_version desc limit 1) as delivery_status from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1 ${id?'and p.id=$2':''} order by c.created_at desc limit 100`,id?[merchantId,id]:[merchantId]);
  if(id&&!result.rows[0])throw new AppError('PAYMENT_NOT_FOUND',404,'This payment was not found.');
  return id?{...result.rows[0],timeline:(await db.pool.query('select event_type,status,attempts,error_code,created_at,state_version from webhook_deliveries where payment_id=$1 order by state_version',[id])).rows}:{payments:result.rows};
}

const tokenAuthSchema = z.object({
  validAfter: z.string().regex(/^\d+$/), validBefore: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  v: z.number().int().min(0).max(255), r: z.string().regex(/^0x[0-9a-fA-F]{64}$/), s: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).strict();
const relayInputSchema = z.object({
  authorization: z.object({ invoiceId: z.string().regex(/^0x[0-9a-fA-F]{64}$/), payer: addressSchema, merchant: addressSchema, token: addressSchema, amount: baseUnitsSchema, evidence: z.string().regex(/^0x[0-9a-fA-F]{64}$/), epoch: z.string().regex(/^\d+$/), deadline: z.string().regex(/^\d+$/) }).strict(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(4096),
  tokenAuthorization: tokenAuthSchema,
}).strict();

export async function relaySponsoredCheckout(db:Database, reference:string, input:unknown) {
  if(process.env.SPONSOR_BUYER_GAS!=='true') throw new AppError('SPONSOR_UNAVAILABLE',503,'Sponsored gas is not available. You can pay network gas with your wallet.');
  const relayerKey = process.env.SPONSOR_RELAYER_PRIVATE_KEY as Hex | undefined;
  if(!relayerKey || !/^0x[0-9a-fA-F]{64}$/.test(relayerKey)) throw new AppError('SPONSOR_UNAVAILABLE',503,'Sponsored gas is not configured. You can pay network gas with your wallet.');
  const row=await checkoutRow(db,reference); payable(row);
  const data = relayInputSchema.parse(input);
  const auth = data.authorization;
  if(auth.invoiceId.toLowerCase()!==row.invoice_id.toLowerCase() || auth.merchant.toLowerCase()!==row.merchant_wallet.toLowerCase() || auth.token.toLowerCase()!==USDT_ADDRESS.toLowerCase() || auth.amount!==row.amount) throw new AppError('AUTHORIZATION_MISMATCH',400,'This payment authorization does not match the checkout.');
  const stored=(await db.pool.query<{payload:Record<string,string>;signature:string;router:string;payer:string}>('select payload,signature,router,payer from payment_authorizations where checkout_id=$1 and lower(payer)=$2 order by created_at desc limit 1',[row.id,auth.payer.toLowerCase()])).rows[0];
  if(!stored || stored.signature.toLowerCase()!==data.signature.toLowerCase() || String(stored.payload.invoiceId).toLowerCase()!==auth.invoiceId.toLowerCase() || String(stored.payload.evidence).toLowerCase()!==auth.evidence.toLowerCase() || String(stored.payload.epoch)!==auth.epoch || String(stored.payload.deadline)!==auth.deadline) throw new AppError('AUTHORIZATION_INVALID',400,'This payment authorization is not valid for relay. Verify your wallet again.');
  if(BigInt(auth.deadline)*1000n <= BigInt(Date.now()+3000)) throw new AppError('AUTHORIZATION_EXPIRED',409,'This payment authorization expired. Verify your wallet again.');
  const ta = data.tokenAuthorization;
  const now = Math.floor(Date.now()/1000);
  if(BigInt(ta.validBefore) <= BigInt(now) || BigInt(ta.validAfter) > BigInt(now+30)) throw new AppError('TOKEN_AUTHORIZATION_INVALID',400,'The token authorization is expired or not yet valid. Sign again.');
  const router = (process.env.WHITECHAIN_ROUTER_ADDRESS || stored.router) as Address;
  if(!/^0x[0-9a-fA-F]{40}$/.test(router)) throw new AppError('CHECKOUT_UNAVAILABLE',503,'Payment routing is not configured.');
  // Budget sponsor relay attempts.
  await transaction(db, async sql => {
    const budget=await sql.query<{count:number}>(`insert into request_budgets(key,count,reset_at) values($1,1,now()+interval '1 minute') on conflict(key) do update set count=case when request_budgets.reset_at<=now() then 1 else request_budgets.count+1 end,reset_at=case when request_budgets.reset_at<=now() then now()+interval '1 minute' else request_budgets.reset_at end returning count`,[`relay:${row.id}`]);
    if(budget.rows[0].count>8) throw new AppError('RATE_LIMITED',429,'Too many sponsored attempts. Wait a minute or pay network gas with your wallet.');
    const current=(await sql.query<CheckoutRow>('select * from checkout_sessions where id=$1 for update',[row.id])).rows[0]; payable(current);
  });
  const account = privateKeyToAccount(relayerKey);
  const wallet = createWalletClient({ account, chain: whitechainSepolia, transport: http(runtimeConfig().rpc) });
  const authorization = { invoiceId: auth.invoiceId as Hex, payer: auth.payer as Address, merchant: auth.merchant as Address, token: auth.token as Address, amount: BigInt(auth.amount), evidence: auth.evidence as Hex, epoch: BigInt(auth.epoch), deadline: BigInt(auth.deadline) };
  const tokenAuthorization = { validAfter: BigInt(ta.validAfter), validBefore: BigInt(ta.validBefore), nonce: ta.nonce as Hex, v: ta.v, r: ta.r as Hex, s: ta.s as Hex };
  const hash = await wallet.writeContract({ address: router, abi: routerAbi, functionName: 'payWithTransferAuthorization', args: [authorization, data.signature as Hex, tokenAuthorization], chain: whitechainSepolia });
  await db.pool.query("update checkout_sessions set submitted_tx_hash=$2 where id=$1 and status='open' and submitted_tx_hash is null",[row.id,hash]);
  return { submitted: true, sponsored: true, tx_hash: hash };
}
