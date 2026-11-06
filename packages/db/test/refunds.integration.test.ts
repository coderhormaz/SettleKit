import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {decodeFunctionData,encodeAbiParameters,encodeEventTopics,keccak256,numberToHex,toHex,zeroAddress,zeroHash,type Hex} from 'viem';
import {USDT_ADDRESS} from '@settlekit/core';
import {routerAbi} from '@settlekit/core/router';
import {randomToken} from '@settlekit/core/server';
import {createDatabase} from '../src/client.ts';
import {cancelRefund,createRefundIntent,listRefunds,refundDetail,releaseRefundHold,submitRefundHint} from '../src/refunds.ts';
import {persistRefundObservation,retractRefund} from '../src/refund-observer.ts';
import {cleanupTestMerchants} from './cleanup.ts';
if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Isolated Neon required.');
const db=createDatabase(process.env.TEST_DATABASE_URL,4);const merchantId=randomUUID(),foreignId=randomUUID();
const wallet=privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Hex;const payer=privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Hex;const router='0x2222222222222222222222222222222222222222' as Hex;
let checkoutId='',paymentId='';const invoiceId=keccak256(toHex(randomToken()));const txHash=keccak256(toHex(randomToken()));const blockHash=keccak256(toHex(randomToken()));
const paymentEvidence=`0x${randomToken()}` as Hex;const paymentTime=Math.floor(Date.now()/1000)-120;const paymentDeadline=paymentTime+60;const fixtureCode='0x60006000' as Hex;
const rpcCalls:{method:string;params:unknown[]}[]=[];const executedRefunds=new Set<string>();const savedEnv:Record<string,string|undefined>={};
const envNames=['WHITECHAIN_RPC_URL','WHITECHAIN_ROUTER_ADDRESS','WHITECHAIN_ROUTER_CODE_HASH','WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK'] as const;
let rpc:Server;let rpcUnavailable=false;let acceptedTimestamp=Math.floor(Date.now()/1000);let chainRefunded=0n;
let observedRefund:Parameters<typeof persistRefundObservation>[1]|undefined;
function fixtureBlock(height:bigint){return {number:numberToHex(height),hash:height===100n?blockHash:keccak256(toHex(`refund-test-block-${height}`)),parentHash:zeroHash,nonce:'0x0000000000000000',sha3Uncles:zeroHash,logsBloom:`0x${'0'.repeat(512)}`,transactionsRoot:zeroHash,stateRoot:zeroHash,receiptsRoot:zeroHash,miner:zeroAddress,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:'0x1c9c380',gasUsed:'0x10000',timestamp:numberToHex(height===100n?paymentTime:acceptedTimestamp+Number(height-101n)),transactions:[],uncles:[],baseFeePerGas:'0x1'};}
function fixtureReceipt(){
  const topics=encodeEventTopics({abi:routerAbi,eventName:'PaymentAccepted',args:{invoiceId,payer,merchant:wallet}});
  const data=encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'bytes32'},{type:'uint256'},{type:'uint256'}],[USDT_ADDRESS,25_000_000n,paymentEvidence,1n,BigInt(paymentDeadline)]);
  const log={address:router,topics,data,blockNumber:'0x64',transactionHash:txHash,transactionIndex:'0x0',blockHash,logIndex:'0x0',removed:false};
  return {transactionHash:txHash,transactionIndex:'0x0',blockHash,blockNumber:'0x64',from:payer,to:router,cumulativeGasUsed:'0x10000',gasUsed:'0x10000',contractAddress:null,logs:[log],logsBloom:`0x${'0'.repeat(512)}`,status:'0x1',effectiveGasPrice:'0x1',type:'0x2'};
}
function rpcValue(method:string,params:unknown[]):unknown{
  if(method==='eth_chainId')return '0x752';if(method==='eth_blockNumber')return '0x66';if(method==='eth_getCode')return fixtureCode;
  if(method==='eth_getTransactionReceipt')return fixtureReceipt();if(method==='eth_getBlockByNumber')return fixtureBlock(params[0]==='latest'?102n:BigInt(String(params[0])));
  if(method==='eth_call'){
    const call=decodeFunctionData({abi:routerAbi,data:(params[0] as {data:Hex}).data});
    if(call.functionName==='token')return encodeAbiParameters([{type:'address'}],[USDT_ADDRESS]);
    if(call.functionName==='payments')return encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'}],[payer,wallet,25_000_000n,chainRefunded]);
    if(call.functionName==='usedRefunds')return encodeAbiParameters([{type:'bool'}],[executedRefunds.has(String(call.args[0]))]);
  }
  throw new Error('UNEXPECTED_REFUND_RPC_FIXTURE_CALL');
}
beforeAll(async()=>{
  for(const key of envNames)savedEnv[key]=process.env[key];
  rpc=createServer(async(req,res)=>{if(rpcUnavailable){res.writeHead(503);res.end('test fixture unavailable');return;}let text='';for await(const part of req)text+=String(part);const call=JSON.parse(text) as {id:number;method:string;params:unknown[]};rpcCalls.push({method:call.method,params:call.params});try{res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result:rpcValue(call.method,call.params)}));}catch{res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'Explicit refund fixture rejected the request.'}}));}});
  await new Promise<void>(resolve=>rpc.listen(0,'127.0.0.1',()=>resolve()));process.env.WHITECHAIN_RPC_URL=`http://127.0.0.1:${(rpc.address() as {port:number}).port}`;process.env.WHITECHAIN_ROUTER_ADDRESS=router;process.env.WHITECHAIN_ROUTER_CODE_HASH=keccak256(fixtureCode);process.env.WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK='1';
  for(const [id,address]of[[merchantId,wallet],[foreignId,payer]])await db.pool.query("insert into merchants(id,owner_wallet,settlement_wallet,settlement_proven_at,display_name,website_origin) values($1,$2,$2,now(),'Refund test','https://refund.example')",[id,address]);
  checkoutId=(await db.pool.query<{id:string}>("insert into checkout_sessions(reference,merchant_id,order_id,idempotency_key,request_hash,invoice_id,merchant_wallet,amount,return_url,expires_at,status) values($1,$2,$3,$3,$3,$4,$5,25000000,'https://refund.example/',now()+interval '1 hour','accepted') returning id",[randomToken(),merchantId,randomToken(),invoiceId,wallet])).rows[0].id;
  const authorizationId=(await db.pool.query<{id:string}>("insert into payment_authorizations(checkout_id,payer,router,evidence,epoch,deadline,payload,signature) values($1,$2,$3,$4,1,to_timestamp($5),'{}','0x00') returning id",[checkoutId,payer,router,paymentEvidence,paymentDeadline])).rows[0].id;
  paymentId=(await db.pool.query<{id:string}>("insert into payments(checkout_id,authorization_id,tx_hash,log_index,block_number,block_hash,payer,block_time) values($1,$2,$3,0,100,$4,$5,now()) returning id",[checkoutId,authorizationId,txHash,blockHash,payer])).rows[0].id;
});
afterAll(async()=>{try{await cleanupTestMerchants(db,[merchantId,foreignId]);}finally{await db.pool.end();rpc?.closeAllConnections();if(rpc)await new Promise<void>(resolve=>rpc.close(()=>resolve()));for(const key of envNames)if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];}});
// Explicit chain-state fixture isolates real transactional reservation behavior;
// verified EVM receipts and merchant execution are exercised by the local harness.
const read=async(_db:typeof db,tenant:string,id:string)=>{
  if(tenant!==merchantId||id!==paymentId)throw Object.assign(new Error('Not found'),{code:'PAYMENT_NOT_FOUND',status:404});
  return {payment:{id:paymentId,merchant_id:merchantId,checkout_id:checkoutId,invoice_id:invoiceId,merchant_wallet:wallet,payer,amount:'25000000',block_number:'100',block_hash:blockHash,tx_hash:txHash,log_index:0,canonical:true,state_version:1},refunded:0n,remaining:25000000n,router,blockNumber:101n,blockTime:Math.floor(Date.now()/1000)};
};
describe('actual Neon refund reservations/canonical ledger with explicit chain fixtures',()=>{
  it('serializes concurrent reservations and applies hold/version/outbox before executable authorization',async()=>{
    const requests=[randomUUID(),randomUUID()].map(idempotencyKey=>createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'16000000',idempotencyKey},read));
    const results=await Promise.allSettled(requests);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.code)).toEqual(['REFUND_EXCEEDS_REMAINING']);
    const row=(await db.pool.query('select refund_hold,state_version,refund_amount::text from checkout_sessions where id=$1',[checkoutId])).rows[0];expect(row).toMatchObject({refund_hold:true,state_version:2,refund_amount:'0'});expect((await db.pool.query('select count(*)::int as n from refund_authorizations a join refund_intents r on r.id=a.intent_id where r.merchant_id=$1',[merchantId])).rows[0].n).toBe(0);
    expect((await db.pool.query('select count(*)::int as n from webhook_deliveries where payment_id=$1',[paymentId])).rows[0].n).toBe(1);
    // Safe fixture reset: no authorization ever existed for this reservation.
    await db.pool.query("update refund_intents set status='cancelled' where payment_id=$1",[paymentId]);
  });
  it('idempotent retries retain immutable ID and amount, foreign reads and changed body fail',async()=>{
    const idempotencyKey=randomUUID();const first=await createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'5000000',idempotencyKey},read);const retry=await createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'5000000',idempotencyKey},read);expect(retry.refundId).toBe(first.refundId);expect(retry.id).toBe(first.id);
    await expect(createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'1',idempotencyKey},read)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});await expect(refundDetail(db,foreignId,first.id)).rejects.toMatchObject({status:404});await expect(createRefundIntent(db,foreignId,{paymentId,amountBaseUnits:'1',idempotencyKey:randomUUID()},read)).rejects.toMatchObject({status:404});
    expect((await listRefunds(db,foreignId)).items).toEqual([]);
  });
  it('only matched canonical events change refund totals, duplicate logs do not duplicate money, reorg retains review hold',async()=>{
    const intent=(await db.pool.query<{id:string;refund_id:Hex}>('select id,refund_id from refund_intents where payment_id=$1 and amount=5000000',[paymentId])).rows[0];const evidence=`0x${randomToken()}` as Hex;const deadline=String(Math.floor(Date.now()/1000)+60);
    await db.pool.query("insert into refund_authorizations(intent_id,evidence,epoch,deadline,payload,signature) values($1,$2,1,to_timestamp($3),$4,'0x00')",[intent.id,evidence,deadline,JSON.stringify({epoch:'1',deadline})]);
    const event={router,txHash:keccak256(toHex(randomToken())),logIndex:1,blockNumber:'101',blockHash:keccak256(toHex(randomToken())),blockTime:Math.floor(Date.now()/1000),invoiceId,payer,merchant:wallet,token:USDT_ADDRESS,amount:'5000000',evidence,epoch:'1',deadline,refundId:intent.refund_id};
    observedRefund=event;
    await expect(persistRefundObservation(db,{...event,payer:router})).rejects.toMatchObject({code:'REFUND_EVENT_MISMATCH'});expect(await persistRefundObservation(db,event)).toBe(true);expect(await persistRefundObservation(db,event)).toBe(false);
    expect((await db.pool.query('select refund_amount::text,status,refund_hold from checkout_sessions where id=$1',[checkoutId])).rows[0]).toMatchObject({refund_amount:'5000000',status:'review',refund_hold:true});expect((await refundDetail(db,merchantId,intent.id)).status).toBe('confirmed');
    const entity=(await db.pool.query<{payload:{amountBaseUnits:string;kind:string}}>("select payload from arkiv_mappings where merchant_id=$1 and kind='refund'",[merchantId])).rows[0];expect(entity.payload).toMatchObject({amountBaseUnits:'5000000',kind:'refund'});
    const refund=(await db.pool.query<{id:string}>('select id from refund_events where intent_id=$1',[intent.id])).rows[0];await retractRefund(db,refund.id);await retractRefund(db,refund.id);
    expect((await db.pool.query('select refund_amount::text,refund_hold from checkout_sessions where id=$1',[checkoutId])).rows[0]).toMatchObject({refund_amount:'0',refund_hold:true});expect((await refundDetail(db,merchantId,intent.id)).status).toBe('review');
  });
  it('submitted transaction hashes remain hints and cannot confirm totals or bypass tenant ownership',async()=>{
    const intent=(await db.pool.query<{id:string}>('select id from refund_intents where payment_id=$1 and amount=5000000',[paymentId])).rows[0];await db.pool.query("update refund_intents set status='authorized' where id=$1",[intent.id]);
    await expect(submitRefundHint(db,foreignId,intent.id,`0x${randomToken()}`)).rejects.toMatchObject({status:409});await submitRefundHint(db,merchantId,intent.id,`0x${randomToken()}`);
    expect((await refundDetail(db,merchantId,intent.id)).status).toBe('submitted');expect((await db.pool.query('select refund_amount::text from checkout_sessions where id=$1',[checkoutId])).rows[0].refund_amount).toBe('0');
  });
  it('cancellation retains its reservation through active authorization and accepted-block expiry, preserving other holds',async()=>{
    const intent=await createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'1000000',idempotencyKey:randomUUID()},read);const expires=Math.floor(Date.now()/1000)+60;
    await db.pool.query("insert into refund_authorizations(intent_id,evidence,epoch,deadline,payload,signature) values($1,$2,1,to_timestamp($3),$4,'0x00')",[intent.id,`0x${randomToken()}`,expires,JSON.stringify({epoch:'1',deadline:String(expires)})]);
    expect(await cancelRefund(db,merchantId,intent.id)).toMatchObject({cancelPending:true});expect((await refundDetail(db,merchantId,intent.id)).status).toBe('cancel_pending');
    const expired=Math.floor(Date.now()/1000)-10;await db.pool.query('update refund_authorizations set deadline=to_timestamp($2) where intent_id=$1',[intent.id,expired]);acceptedTimestamp=expired-1;
    expect(await releaseRefundHold(db,merchantId,intent.id)).toMatchObject({cancelPending:true});
    acceptedTimestamp=Math.floor(Date.now()/1000)+1;expect(await releaseRefundHold(db,merchantId,intent.id)).toMatchObject({cancelPending:false,cancelled:true});expect((await refundDetail(db,merchantId,intent.id)).status).toBe('cancelled');
    expect((await db.pool.query('select refund_hold,status from checkout_sessions where id=$1',[checkoutId])).rows[0]).toMatchObject({refund_hold:true,status:'review'});
    const usedCalls=rpcCalls.filter(call=>call.method==='eth_call'&&decodeFunctionData({abi:routerAbi,data:(call.params[0] as {data:Hex}).data}).functionName==='usedRefunds');expect(usedCalls.some(call=>call.params[1]==='0x65')).toBe(true);
  });
  it('executed refunds and RPC outages never optimistically release a pending hold',async()=>{
    const executed=await createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'1000000',idempotencyKey:randomUUID()},read);executedRefunds.add(executed.refundId);
    await expect(cancelRefund(db,merchantId,executed.id)).rejects.toMatchObject({code:'REFUND_ALREADY_EXECUTED'});expect((await refundDetail(db,merchantId,executed.id)).status).toBe('cancel_pending');executedRefunds.clear();
    const unavailable=await createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'1000000',idempotencyKey:randomUUID()},read);rpcUnavailable=true;try{await expect(cancelRefund(db,merchantId,unavailable.id)).rejects.toThrow();}finally{rpcUnavailable=false;}
    expect((await refundDetail(db,merchantId,unavailable.id)).status).toBe('cancel_pending');expect((await db.pool.query('select refund_hold from checkout_sessions where id=$1',[checkoutId])).rows[0].refund_hold).toBe(true);
  });
  it('a stale pre-lock chain balance cannot reserve value already consumed by a canonical refund',async()=>{
    await db.pool.query('update checkout_sessions set refund_amount=10000000 where id=$1',[checkoutId]);try{await expect(createRefundIntent(db,merchantId,{paymentId,amountBaseUnits:'16000000',idempotencyKey:randomUUID()},read)).rejects.toMatchObject({code:'REFUND_EXCEEDS_REMAINING'});}finally{await db.pool.query('update checkout_sessions set refund_amount=0 where id=$1',[checkoutId]);}
  });
  it('re-inclusion after a refund reorg restores one amount and queues a fresh canonical public evidence version',async()=>{
    expect(observedRefund).toBeDefined();const event={...observedRefund!,blockNumber:'102',blockHash:keccak256(toHex(randomToken()))};
    expect(await persistRefundObservation(db,event)).toBe(true);expect(await persistRefundObservation(db,event)).toBe(false);
    expect((await db.pool.query('select refund_amount::text as amount from checkout_sessions where id=$1',[checkoutId])).rows[0].amount).toBe('5000000');expect((await db.pool.query('select count(*)::integer as n from refund_events where payment_id=$1 and canonical=true',[paymentId])).rows[0].n).toBe(1);
    expect((await db.pool.query("select count(*)::integer as n from arkiv_mappings where merchant_id=$1 and kind='refund'",[merchantId])).rows[0].n).toBe(2);
  });
});
