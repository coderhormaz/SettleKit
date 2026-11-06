import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { hashToken,randomToken,encryptSecret } from '@settlekit/core/server';
import { USDT_ADDRESS } from '@settlekit/core';
import { deliverPayment } from '../../worker/src/payments.ts';
import { OFAC_SOURCE_ID,OFAC_SDN_URL,SCREENING_COVERAGE,type SourceSnapshot } from '@settlekit/screening';
import { authenticateApiKey,authorizeCheckout,checkoutRow,createCheckout,createDatabase,holdPayment,listPayments,persistObservation,publishSnapshot,requestPayerChallenge,type CheckedPolicy } from '../src/index.ts';

if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Isolated real Neon test configuration required.');
const db=createDatabase(process.env.TEST_DATABASE_URL,4);const merchantId=randomUUID();const otherId=randomUUID();
const merchant=privateKeyToAccount(generatePrivateKey());const payer=privateKeyToAccount(generatePrivateKey());const signingKey=generatePrivateKey();const key=`sk_${randomToken()}`;
const oldSigner=process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY;let oldSource:Record<string,unknown>|undefined;let state='pending';let port=0;
const orders=new Map<string,string>();
const server=createServer((req,res)=>{const id=req.url?.split('/').at(-1)??'';res.setHeader('content-type','application/json');res.end(JSON.stringify({order_ref:id,amount_base_units:orders.get(id)??'25000000',state,payment_id:null,state_version:1}));});
const source=():SourceSnapshot=>({sourceId:OFAC_SOURCE_ID,sourceUrl:OFAC_SDN_URL,sha256:'f'.repeat(64),fetchedAt:new Date().toISOString(),publishedAt:new Date(Date.now()-60_000).toISOString(),coverage:{...SCREENING_COVERAGE},addresses:['0x0000000000000000000000000000000000000009'],entryCount:1,recordCount:1});
beforeAll(async()=>{
  process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY=signingKey;
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>{port=(server.address() as {port:number}).port;resolve();}));
  oldSource=(await db.pool.query('select * from screening_sources where source_id=$1',[OFAC_SOURCE_ID])).rows[0];
  await db.pool.query('delete from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);await publishSnapshot(db,source());
  for(const [id,address]of [[merchantId,merchant.address],[otherId,payer.address]])await db.pool.query('insert into merchants(id,owner_wallet,settlement_wallet,settlement_proven_at,display_name,website_origin) values($1,$2,$2,now(),$3,$4)',[id,address.toLowerCase(),'Payment test',`http://127.0.0.1:${port}`]);
  await db.pool.query('insert into merchant_integrations(merchant_id,key_hash,webhook_url,order_api_url,webhook_secret,order_read_secret) values($1,$2,$3,$4,$5,$6)',[merchantId,hashToken(key),`http://127.0.0.1:${port}/webhook`,`http://127.0.0.1:${port}/api/orders`,encryptSecret(randomToken(),process.env.DATA_ENCRYPTION_KEY!,`webhook:${merchantId}`),encryptSecret(randomToken(),process.env.DATA_ENCRYPTION_KEY!,`orders:${merchantId}`)]);
});
afterAll(async()=>{
  if(oldSigner===undefined)delete process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY;else process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY=oldSigner;
  for(const table of ['webhook_deliveries','payments','payment_authorizations','payer_challenges'])await db.pool.query(`delete from ${table} where ${table==='webhook_deliveries'?'merchant_id=$1':table==='payments'?'checkout_id in(select id from checkout_sessions where merchant_id=$1)':'checkout_id in(select id from checkout_sessions where merchant_id=$1)'}`,[merchantId]);
  for(const table of ['checkout_sessions','merchant_integrations','audit_events','outbox_jobs'])await db.pool.query(`delete from ${table} where merchant_id=any($1::uuid[])`,[[merchantId,otherId]]);
  await db.pool.query('delete from merchants where id=any($1::uuid[])',[[merchantId,otherId]]);
  await db.pool.query('delete from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);if(oldSource)await db.pool.query('insert into screening_sources(source_id,snapshot,health,fetched_at,updated_at) values($1,$2,$3,$4,$5)',[oldSource.source_id,JSON.stringify(oldSource.snapshot),JSON.stringify(oldSource.health),oldSource.fetched_at,oldSource.updated_at]);
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.pool.end();
});
async function checkout(){const order=randomUUID();orders.set(order,'25000000');return createCheckout(db,merchantId,order,{order_id:order,amount_base_units:'25000000',return_url:`http://127.0.0.1:${port}/?order=${order}`});}
const checked=async():Promise<CheckedPolicy>=>{const s=(await db.pool.query('select snapshot from screening_sources where source_id=$1',[OFAC_SOURCE_ID])).rows[0].snapshot;return {router:'0x3333333333333333333333333333333333333333',epoch:1n,validUntil:BigInt(Math.floor(Date.now()/1000)+300),commitment:`0x${'a'.repeat(64)}`,sourceHash:s.sha256,sourceFetchedAt:s.fetchedAt,expiresAt:Date.now()+90_000,checkedAt:Date.now()};};
describe('Phase 2 actual Neon services with explicit HTTP/policy/chain fixtures',()=>{
  it('scopes hashed server keys and rejects browser/plain/cross-tenant credentials',async()=>{expect(await authenticateApiKey(db,`Bearer ${key}`)).toBe(merchantId);await expect(authenticateApiKey(db,`Bearer ${randomToken()}`)).rejects.toMatchObject({status:401});expect(await listPayments(db,otherId)).toEqual({payments:[]});});
  it('concurrent idempotent creates one immutable invoice, rejects changed request and unsafe return',async()=>{
    const order=randomUUID();orders.set(order,'25000000');const input={order_id:order,amount_base_units:'25000000',return_url:`http://127.0.0.1:${port}/?order=${order}`};
    const a=await Promise.all([createCheckout(db,merchantId,order,input),createCheckout(db,merchantId,order,input)]);expect(a[0]).toEqual(a[1]);
    await expect(createCheckout(db,merchantId,order,{...input,return_url:`http://127.0.0.1:${port}/different`})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    await expect(createCheckout(db,merchantId,randomUUID(),{...input,order_id:randomUUID(),return_url:'https://unapproved.example/'})).rejects.toMatchObject({code:'RETURN_URL_DENIED'});
    await db.pool.query('update merchants set settlement_wallet=$2 where id=$1',[merchantId,payer.address.toLowerCase()]);expect((await checkoutRow(db,a[0].reference)).merchant_wallet).toBe(merchant.address.toLowerCase());await db.pool.query('update merchants set settlement_wallet=$2 where id=$1',[merchantId,merchant.address.toLowerCase()]);
  });
  it('requires browser-bound real payer signature and consumes a nonce once under concurrent authorization',async()=>{
    const c=await checkout();const browserToken=randomToken();const challenge=await requestPayerChallenge(db,c.reference,payer.address,browserToken);const signature=await payer.signMessage({message:challenge.message});
    await expect(authorizeCheckout(db,c.reference,{id:challenge.id,signature,browserToken:randomToken()},checked)).rejects.toMatchObject({code:'PAYER_PROOF_INVALID'});
    const results=await Promise.allSettled([authorizeCheckout(db,c.reference,{id:challenge.id,signature,browserToken},checked),authorizeCheckout(db,c.reference,{id:challenge.id,signature,browserToken},checked)]);
    expect(results.map(r=>r.status==='fulfilled'?'fulfilled':((r.reason as {code?:string}).code??'UNEXPECTED_DEPENDENCY')).sort()).toEqual(['PAYER_PROOF_USED','fulfilled'].sort());
    expect((await db.pool.query('select count(*)::integer as n from payment_authorizations a join checkout_sessions c on c.id=a.checkout_id where c.reference=$1',[c.reference])).rows[0].n).toBe(1);
  });
  it('source outage and cancelled merchant order cannot issue an authorization',async()=>{
    const c=await checkout();const browserToken=randomToken();const challenge=await requestPayerChallenge(db,c.reference,payer.address,browserToken);const signature=await payer.signMessage({message:challenge.message});
    state='cancelled';await expect(authorizeCheckout(db,c.reference,{id:challenge.id,signature,browserToken},checked)).rejects.toMatchObject({code:'ORDER_CLOSED'});state='pending';
    await db.pool.query("update screening_sources set health=$2 where source_id=$1",[OFAC_SOURCE_ID,JSON.stringify({state:'unavailable',checkedAt:new Date().toISOString()})]);
    await expect(authorizeCheckout(db,c.reference,{id:challenge.id,signature,browserToken},checked)).rejects.toMatchObject({code:'SCREENING_CHANGED'});
    await db.pool.query('delete from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);await publishSnapshot(db,source());
  });
  it('binds event fields, accepts once after UI expiry, and atomically creates one stable delivery/corrective outbox',async()=>{
    const c=await checkout();const browserToken=randomToken();const challenge=await requestPayerChallenge(db,c.reference,payer.address,browserToken);const signed=await authorizeCheckout(db,c.reference,{id:challenge.id,signature:await payer.signMessage({message:challenge.message}),browserToken},checked);const a=signed.authorization;
    const event={router:signed.router,txHash:`0x${'b'.repeat(64)}`,logIndex:0,blockNumber:'100',blockHash:`0x${'c'.repeat(64)}`,blockTime:Number(a.deadline)-1,invoiceId:a.invoiceId,payer:a.payer,merchant:a.merchant,token:a.token,amount:a.amount,evidence:a.evidence,epoch:a.epoch,deadline:a.deadline};
    await expect(persistObservation(db,{...event,amount:'1'})).rejects.toMatchObject({code:'EVENT_MISMATCH'});
    await db.pool.query("update checkout_sessions set expires_at=now()-interval '1 minute' where reference=$1",[c.reference]);
    expect(await persistObservation(db,event)).toBe(true);expect(await persistObservation(db,event)).toBe(false);
    const p=(await listPayments(db,merchantId)) as {payments:{id:string;reference:string}[]};const id=p.payments.find(p=>p.reference===c.reference)!.id;
    await expect(listPayments(db,otherId,id)).rejects.toMatchObject({status:404});
    await holdPayment(db,id,'CHAIN_ORPHANED');await holdPayment(db,id,'CHAIN_ORPHANED');
    const deliveries=(await db.pool.query('select event_type,state_version from webhook_deliveries where payment_id=$1 order by state_version',[id])).rows;expect(deliveries).toHaveLength(2);expect(deliveries.map(d=>d.event_type)).toEqual(['payment.accepted','payment.review']);
    const jobs=await db.pool.query("select count(*)::integer as n from outbox_jobs where kind='payment.webhook' and payload->>'deliveryId' in(select id::text from webhook_deliveries where payment_id=$1)",[id]);expect(jobs.rows[0].n).toBe(2);
  });
  it('a paused worker whose lease was replaced cannot reset delivered state or send a webhook',async()=>{
    const delivery=(await db.pool.query('select d.*,c.reference,c.order_id,c.merchant_wallet,p.payer from webhook_deliveries d join payments p on p.id=d.payment_id join checkout_sessions c on c.id=p.checkout_id where d.merchant_id=$1 order by d.state_version desc limit 1',[merchantId])).rows[0];
    const oldLease=randomUUID();const job=(await db.pool.query("update outbox_jobs set status='processing',lease_token=$2,lease_until=now()+interval '60 seconds',attempts=1 where payload->>'deliveryId'=$1 returning id,merchant_id,kind,payload,lease_token,attempts,max_attempts",[delivery.id,oldLease])).rows[0];
    let resume!:()=>void;let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});const paused=new Promise<void>(resolve=>{resume=resolve;});let sends=0;
    const run=deliverPayment(db,job,{
      state:async()=>{entered();await paused;return {payment_id:delivery.payment_id,checkout_reference:delivery.reference,merchant_order_id:delivery.order_id,state_version:delivery.state_version,amount_base_units:'25000000',token:USDT_ADDRESS,chain_id:1874,payer:delivery.payer,merchant:delivery.merchant_wallet,confirmation_stage:'included_2_blocks',eligible:false,status:'orphaned',refund_hold:false,refund_amount_base_units:'0',grant_expires_at:new Date(Date.now()+10_000).toISOString()};},
      order:async()=>({order_ref:delivery.order_id,amount_base_units:'25000000',state:'pending',payment_id:null,state_version:1}),
      config:async()=>({webhook_url:`http://127.0.0.1:${port}/webhook`,order_api_url:'unused',webhook_secret:'protected',order_read_secret:'protected',website_origin:`http://127.0.0.1:${port}`,webhookSecret:randomToken(),orderReadSecret:randomToken()}),
      post:async()=>{sends++;return {};},
    });
    await waiting;await db.pool.query('update outbox_jobs set lease_token=$2 where id=$1',[job.id,randomUUID()]);await db.pool.query("update webhook_deliveries set status='delivered' where id=$1",[delivery.id]);resume();
    await expect(run).rejects.toThrow('DELIVERY_LEASE_LOST');expect(sends).toBe(0);expect((await db.pool.query('select status from webhook_deliveries where id=$1',[delivery.id])).rows[0].status).toBe('delivered');
  });
});
