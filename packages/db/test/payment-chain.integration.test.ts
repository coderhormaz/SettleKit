import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, numberToHex, zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { USDT_ADDRESS } from '@settlekit/core';
import { randomToken } from '@settlekit/core/server';
import { routerAbi } from '@settlekit/core/router';
import { OFAC_SDN_URL, OFAC_SOURCE_ID, SCREENING_COVERAGE, type SourceSnapshot } from '@settlekit/screening';
import { createDatabase } from '../src/client.ts';
import { checkPaymentPolicy, policyCommitment } from '../src/policy.ts';
import { paymentState, persistObservation, verifiedReceipt, type PaymentObservation } from '../src/observer.ts';
import {cleanupTestMerchants} from './cleanup.ts';

// Actual isolated PostgreSQL transactions, with an explicitly simulated HTTP
// JSON-RPC chain. These fixtures are neither live Whitechain nor EVM execution.
if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Explicit isolated TEST_DATABASE_URL required.');
const db=createDatabase(process.env.TEST_DATABASE_URL,4);
const router='0x2222222222222222222222222222222222222222' as Address;
const code='0x60006000' as Hex;
let txHash=`0x${'a'.repeat(64)}` as Hex;
const acceptedHash=`0x${'b'.repeat(64)}` as Hex;
const headHash=`0x${'c'.repeat(64)}` as Hex;
const otherHash=`0x${'d'.repeat(64)}` as Hex;
const payer=privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;
const merchant=privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;
const signerKey=generatePrivateKey();const signer=privateKeyToAccount(signerKey).address;
const trackedMerchants:string[]=[];
const savedEnv:Record<string,string|undefined>={};
const envNames=['WHITECHAIN_RPC_URL','WHITECHAIN_ROUTER_ADDRESS','WHITECHAIN_ROUTER_CODE_HASH','WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK','PAYMENT_AUTHORIZER_PRIVATE_KEY'] as const;
let savedSource:{snapshot:unknown;health:unknown;fetched_at:Date|null}|undefined;
let server:Server;
let source:SourceSnapshot;
let event:PaymentObservation;
let invoiceId:Hex;
let refunded=0n;
let missingReceipt=false;
let failRpc=false;
let orphan=false;
let changeAnchor=false;
let latestReads=0;
let calls:{method:string;params:unknown[]}[]=[];
let policyWindowSeconds=600;
let lastPolicyValidUntil=0n;
let duringPolicyRead:(()=>Promise<void>)|null=null;

const abiAddress=(value:Address)=>encodeAbiParameters([{type:'address'}],[value]);
const abiUint=(value:bigint)=>encodeAbiParameters([{type:'uint256'}],[value]);
function block(number:bigint,hash:Hex) {
  return {number:numberToHex(number),hash,parentHash:zeroHash,nonce:'0x0000000000000000',sha3Uncles:zeroHash,logsBloom:`0x${'0'.repeat(512)}`,transactionsRoot:zeroHash,stateRoot:zeroHash,receiptsRoot:zeroHash,miner:zeroAddress,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:'0x1c9c380',gasUsed:'0x10000',timestamp:numberToHex(event.blockTime),transactions:[],uncles:[],baseFeePerGas:'0x1'};
}
function receipt() {
  const topics=encodeEventTopics({abi:routerAbi,eventName:'PaymentAccepted',args:{invoiceId,payer,merchant}});
  const data=encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'bytes32'},{type:'uint256'},{type:'uint256'}],[USDT_ADDRESS,25_000_000n,event.evidence as Hex,1n,BigInt(event.deadline)]);
  const log={address:router,topics,data,blockNumber:'0x100',transactionHash:txHash,transactionIndex:'0x0',blockHash:acceptedHash,logIndex:'0x0',removed:false};
  return {transactionHash:txHash,transactionIndex:'0x0',blockHash:acceptedHash,blockNumber:'0x100',from:payer,to:router,cumulativeGasUsed:'0x10000',gasUsed:'0x10000',contractAddress:null,logs:[log],logsBloom:`0x${'0'.repeat(512)}`,status:'0x1',effectiveGasPrice:'0x1',type:'0x2'};
}
function rpcResult(method:string,params:unknown[]) {
  if(method==='eth_chainId')return '0x752';
  if(method==='eth_blockNumber')return '0x101';
  if(method==='eth_getCode')return code;
  if(method==='eth_getTransactionReceipt')return missingReceipt?null:receipt();
  if(method==='eth_getBlockByNumber'){
    if(params[0]==='latest'){latestReads++;return block(257n,headHash);}
    const height=BigInt(params[0] as string);
    return block(height,height===256n?(orphan?otherHash:acceptedHash):(changeAnchor&&latestReads>0?otherHash:headHash));
  }
  if(method==='eth_call'){
    const call=params[0] as {data:Hex};const fn=decodeFunctionData({abi:routerAbi,data:call.data}).functionName;
    switch(fn){
      case 'token':return abiAddress(USDT_ADDRESS);
      case 'authorizationSigner':return abiAddress(signer);
      case 'policyEpoch':return abiUint(1n);
      case 'policyValidUntil':lastPolicyValidUntil=BigInt(Math.ceil(Date.now()/1000)+policyWindowSeconds);return abiUint(lastPolicyValidUntil);
      case 'policyCommitment':return encodeAbiParameters([{type:'bytes32'}],[policyCommitment(source)]);
      case 'paused':case 'denied':return encodeAbiParameters([{type:'bool'}],[false]);
      case 'payments':return encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'}],[payer,merchant,25_000_000n,refunded]);
      default:throw new Error('UNEXPECTED_FIXTURE_CALL');
    }
  }
  throw new Error('UNEXPECTED_FIXTURE_METHOD');
}
async function insertAccepted() {
  const merchantId=randomUUID();trackedMerchants.push(merchantId);
  await db.pool.query('insert into merchants(id,owner_wallet,settlement_wallet,settlement_proven_at,display_name,website_origin) values($1,$2,$3,now(),$4,$5)',[merchantId,privateKeyToAccount(generatePrivateKey()).address.toLowerCase(),merchant,'Chain regression store','https://store.example']);
  const checkout=(await db.pool.query<{id:string}>('insert into checkout_sessions(reference,merchant_id,order_id,idempotency_key,request_hash,invoice_id,merchant_wallet,amount,return_url,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval \'30 minutes\') returning id',[randomToken(),merchantId,randomUUID(),randomUUID(),randomToken(),invoiceId,merchant,'25000000','https://store.example/return'])).rows[0];
  const payload={invoiceId,payer,merchant,token:USDT_ADDRESS,amount:'25000000',evidence:event.evidence,epoch:'1',deadline:event.deadline};
  await db.pool.query('insert into payment_authorizations(checkout_id,payer,router,evidence,epoch,deadline,payload,signature) values($1,$2,$3,$4,1,to_timestamp($5),$6,$7)',[checkout.id,payer,router,event.evidence,event.deadline,JSON.stringify(payload),'0x00']);
  await persistObservation(db,event);
  const payment=(await db.pool.query<{id:string}>('select id from payments where checkout_id=$1',[checkout.id])).rows[0];
  return {merchantId,checkoutId:checkout.id,paymentId:payment.id};
}

beforeAll(async()=>{
  for(const name of envNames)savedEnv[name]=process.env[name];
  for(let attempt=0;attempt<3;attempt++){try{await db.pool.query('select 1');break;}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}}
  savedSource=(await db.pool.query('select snapshot,health,fetched_at from screening_sources where source_id=$1',[OFAC_SOURCE_ID])).rows[0];
  server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=String(chunk);
    const request=JSON.parse(text) as {id:number;method:string;params:unknown[]};calls.push({method:request.method,params:request.params});
    if(failRpc){res.writeHead(503);res.end('fixture dependency unavailable');return;}
    try{
      if(duringPolicyRead&&request.method==='eth_call'&&decodeFunctionData({abi:routerAbi,data:(request.params[0] as {data:Hex}).data}).functionName==='policyCommitment'){
        const hook=duringPolicyRead;duringPolicyRead=null;await hook();
      }
      res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result:rpcResult(request.method,request.params)}));
    }
    catch{res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'fixture method unavailable'}}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('FIXTURE_BIND_FAILED');
  process.env.WHITECHAIN_RPC_URL=`http://127.0.0.1:${address.port}`;
  process.env.WHITECHAIN_ROUTER_ADDRESS=router;process.env.WHITECHAIN_ROUTER_CODE_HASH=keccak256(code);process.env.WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK='1';process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY=signerKey;
},60_000);
beforeEach(async()=>{
  refunded=0n;missingReceipt=false;failRpc=false;orphan=false;changeAnchor=false;latestReads=0;calls=[];policyWindowSeconds=600;lastPolicyValidUntil=0n;duringPolicyRead=null;
  invoiceId=`0x${randomToken()}` as Hex;
  txHash=`0x${randomToken()}` as Hex;
  event={router,txHash,logIndex:0,blockNumber:'256',blockHash:acceptedHash,blockTime:Math.floor(Date.now()/1000)-10,invoiceId,payer,merchant,token:USDT_ADDRESS,amount:'25000000',evidence:`0x${randomToken()}`,epoch:'1',deadline:String(Math.floor(Date.now()/1000)+60)};
  // Unique source fixture only for this explicitly isolated test branch.
  source={sourceId:OFAC_SOURCE_ID,sourceUrl:OFAC_SDN_URL,sha256:'a'.repeat(64),fetchedAt:new Date().toISOString(),publishedAt:new Date(Date.now()-60_000).toISOString(),coverage:{...SCREENING_COVERAGE},addresses:['0x1111111111111111111111111111111111111111'],entryCount:1,recordCount:1};
  await db.pool.query('insert into screening_sources(source_id,snapshot,health,fetched_at) values($1,$2,$3,$4) on conflict(source_id) do update set snapshot=excluded.snapshot,health=excluded.health,fetched_at=excluded.fetched_at',[OFAC_SOURCE_ID,JSON.stringify(source),JSON.stringify({state:'available',checkedAt:source.fetchedAt}),source.fetchedAt]);
});
afterAll(async()=>{
  await cleanupTestMerchants(db,trackedMerchants);
  if(savedSource)await db.pool.query('update screening_sources set snapshot=$2,health=$3,fetched_at=$4 where source_id=$1',[OFAC_SOURCE_ID,JSON.stringify(savedSource.snapshot),JSON.stringify(savedSource.health),savedSource.fetched_at]);
  else await db.pool.query('delete from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);
  for(const name of envNames){if(savedEnv[name]===undefined)delete process.env[name];else process.env[name]=savedEnv[name];}
  if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await db.pool.end();
},60_000);

describe('actual Neon state with explicitly simulated chain HTTP evidence',()=>{
  it('pins policy, token, code and denials to one block and rejects a changed canonical anchor',async()=>{
    const policy=await checkPaymentPolicy(db,[payer,merchant]);expect(policy.epoch).toBe(1n);
    expect(calls.filter(c=>c.method==='eth_call'||c.method==='eth_getCode').every(c=>c.params[1]==='0x101')).toBe(true);
    changeAnchor=true;
    await expect(checkPaymentPolicy(db,[payer,merchant])).rejects.toMatchObject({code:'POLICY_UNCONFIRMED'});
  });
  it('verifies the complete receipt association and grants eligible unrefunded state',async()=>{
    const p=await insertAccepted();const verified=await verifiedReceipt(txHash,0);expect(verified).toMatchObject({...event,token:USDT_ADDRESS.toLowerCase()});
    const state=await paymentState(db,p.merchantId,p.paymentId);expect(state).toMatchObject({eligible:true,status:'accepted',state_version:2,refund_amount_base_units:'0'});
  });
  it('records one atomic corrective event when a stored accepted block is orphaned, even with a missing receipt',async()=>{
    const p=await insertAccepted();orphan=true;missingReceipt=true;
    const state=await paymentState(db,p.merchantId,p.paymentId);expect(state).toMatchObject({eligible:false,status:'orphaned',state_version:3});
    expect((await db.pool.query('select canonical from payments where id=$1',[p.paymentId])).rows[0].canonical).toBe(false);
    await paymentState(db,p.merchantId,p.paymentId);
    expect((await db.pool.query("select count(*)::int as count from webhook_deliveries where payment_id=$1 and event_type='payment.review'",[p.paymentId])).rows[0].count).toBe(1);
    expect((await db.pool.query("select count(*)::int as count from outbox_jobs where merchant_id=$1 and kind='payment.webhook'",[p.merchantId])).rows[0].count).toBe(2);
  });
  it('fails closed on missing receipt/provider outage without falsely orphaning a canonical payment',async()=>{
    const p=await insertAccepted();missingReceipt=true;
    await expect(paymentState(db,p.merchantId,p.paymentId)).rejects.toMatchObject({code:'RECEIPT_UNAVAILABLE'});
    missingReceipt=false;failRpc=true;await expect(paymentState(db,p.merchantId,p.paymentId)).rejects.toThrow();
    const row=(await db.pool.query('select c.status,c.state_version,p.canonical from checkout_sessions c join payments p on p.checkout_id=c.id where p.id=$1',[p.paymentId])).rows[0];
    expect(row).toEqual({status:'accepted',state_version:2,canonical:true});
  });
  it('observes an onchain partial refund and blocks fulfillment with durable hold/version/outbox',async()=>{
    const p=await insertAccepted();refunded=5_000_000n;
    const state=await paymentState(db,p.merchantId,p.paymentId);expect(state).toMatchObject({eligible:false,status:'review',state_version:3,refund_hold:true,refund_amount_base_units:'0'});
    await paymentState(db,p.merchantId,p.paymentId);
    const correction=(await db.pool.query("select count(*)::int as count from webhook_deliveries where payment_id=$1 and event_type='payment.review'",[p.paymentId])).rows[0];expect(correction.count).toBe(1);
    expect((await db.pool.query("select count(*)::int as count from audit_events where merchant_id=$1 and kind='payment.refund_observed'",[p.merchantId])).rows[0].count).toBe(1);
  });
  it('caps the eligibility grant at a nearly expiring six-second onchain policy',async()=>{
    const p=await insertAccepted();policyWindowSeconds=6;
    const state=await paymentState(db,p.merchantId,p.paymentId);
    expect(state.eligible).toBe(true);
    expect(Date.parse(state.grant_expires_at)).toBeLessThanOrEqual(Number(lastPolicyValidUntil)*1000);
    expect(Date.parse(state.grant_expires_at)-Date.now()).toBeLessThan(8000);
  });
  it('rejects final grant when required source health fails while policy RPC is in flight',async()=>{
    const p=await insertAccepted();
    duringPolicyRead=async()=>{await db.pool.query('update screening_sources set health=$2 where source_id=$1',[OFAC_SOURCE_ID,JSON.stringify({state:'unavailable',checkedAt:new Date().toISOString(),reasonCode:'SOURCE_FETCH_FAILED'})]);};
    await expect(paymentState(db,p.merchantId,p.paymentId)).rejects.toMatchObject({code:'SCREENING_CHANGED'});
    expect(duringPolicyRead).toBeNull();
    expect((await db.pool.query('select state_version from checkout_sessions where id=$1',[p.checkoutId])).rows[0].state_version).toBe(2);
  });
  it('rejects final grant when a newer source snapshot replaces checked evidence during RPC',async()=>{
    const p=await insertAccepted();
    duringPolicyRead=async()=>{
      const replacement={...source,sha256:'e'.repeat(64),fetchedAt:new Date().toISOString()};
      await db.pool.query('update screening_sources set snapshot=$2,health=$3,fetched_at=$4 where source_id=$1',[OFAC_SOURCE_ID,JSON.stringify(replacement),JSON.stringify({state:'available',checkedAt:replacement.fetchedAt}),replacement.fetchedAt]);
    };
    await expect(paymentState(db,p.merchantId,p.paymentId)).rejects.toMatchObject({code:'SCREENING_CHANGED'});
    expect(duringPolicyRead).toBeNull();
  });
});
