import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import type {Address} from 'viem';
import {USDT_ADDRESS} from '@settlekit/core';
import {encryptSecret,hashToken,randomToken} from '@settlekit/core/server';
import {OFAC_SOURCE_ID,OFAC_SDN_URL,SCREENING_COVERAGE,type SourceSnapshot} from '@settlekit/screening';
import {createDatabase,transaction} from '../src/client.ts';
import {authenticateRecovery,recoverInput,recoveryCandidates,requestRecovery} from '../src/recovery.ts';
import {deliverPayment} from '../../worker/src/payments.ts';
import type {ClaimedJob} from '../src/jobs.ts';
import {merchantIntegration,type StoreOrder} from '../src/integration.ts';
import {cleanupTestMerchants} from './cleanup.ts';

if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Separate isolated Neon is required.');
const db=createDatabase(process.env.TEST_DATABASE_URL,4),merchantId=randomUUID();
const merchant=privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address,payer=privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;
const router='0x2222222222222222222222222222222222222222',txHash=`0x${randomToken()}`,blockHash=`0x${randomToken()}`;
const orderId=randomUUID(),reference=randomToken();let checkoutId='',paymentId='',deliveryId='';
const priorToken=process.env.RECOVERY_SERVICE_TOKEN;let priorSource:Record<string,unknown>|undefined;
const snapshot=():SourceSnapshot=>{const fetchedAt=new Date().toISOString();return {sourceId:OFAC_SOURCE_ID,sourceUrl:OFAC_SDN_URL,sha256:'a'.repeat(64),fetchedAt,publishedAt:fetchedAt,coverage:{...SCREENING_COVERAGE},addresses:['0x8888888888888888888888888888888888888888'],entryCount:1,recordCount:1};};
const input=(round=1)=>({paymentId,deliveryId,stateVersion:1,round,txHash,blockHash,logIndex:0});
const current=async()=>({payment_id:paymentId,checkout_reference:reference,merchant_order_id:orderId,state_version:1,amount_base_units:'25000000',token:USDT_ADDRESS,chain_id:1874,payer,merchant,confirmation_stage:'included_2_blocks',eligible:true,status:'accepted',refund_hold:false,refund_amount_base_units:'0',grant_expires_at:new Date(Date.now()+15000).toISOString()});
const order=async():Promise<StoreOrder>=>({order_ref:orderId,amount_base_units:'25000000',state:'pending',payment_id:null,state_version:1});
const deps={state:current,order};
beforeAll(async()=>{
  priorSource=(await db.pool.query('select * from screening_sources where source_id=$1',[OFAC_SOURCE_ID])).rows[0];process.env.RECOVERY_SERVICE_TOKEN=randomToken();
  await db.pool.query("insert into merchants(id,owner_wallet,settlement_wallet,settlement_proven_at,display_name,website_origin) values($1,$2,$2,now(),'Recovery fixture','https://recovery.example')",[merchantId,merchant]);
  await db.pool.query("insert into merchant_integrations(merchant_id,key_hash,webhook_url,order_api_url,webhook_secret,order_read_secret) values($1,$2,'https://recovery.example/webhook','https://recovery.example/orders',$3,$4)",[merchantId,hashToken(randomToken()),encryptSecret(randomToken(),process.env.DATA_ENCRYPTION_KEY!,`webhook:${merchantId}`),encryptSecret(randomToken(),process.env.DATA_ENCRYPTION_KEY!,`orders:${merchantId}`)]);
  checkoutId=(await db.pool.query("insert into checkout_sessions(reference,merchant_id,order_id,idempotency_key,request_hash,invoice_id,merchant_wallet,amount,return_url,expires_at,status,risk_state) values($1,$2,$3,$3,$3,$4,$5,25000000,'https://recovery.example/',now()+interval '1 hour','accepted','allowed') returning id",[reference,merchantId,orderId,`0x${randomToken()}`,merchant])).rows[0].id;
  const auth=(await db.pool.query("insert into payment_authorizations(checkout_id,payer,router,evidence,epoch,deadline,payload,signature) values($1,$2,$3,$4,1,now()+interval '1 hour','{}','0x00') returning id",[checkoutId,payer,router,`0x${randomToken()}`])).rows[0].id;
  paymentId=(await db.pool.query('insert into payments(checkout_id,authorization_id,tx_hash,log_index,block_number,block_hash,payer,block_time) values($1,$2,$3,0,100,$4,$5,now()) returning id',[checkoutId,auth,txHash,blockHash,payer])).rows[0].id;
  deliveryId=(await db.pool.query("insert into webhook_deliveries(payment_id,merchant_id,state_version,event_type,status) values($1,$2,1,'payment.accepted','dead') returning id",[paymentId,merchantId])).rows[0].id;
});
beforeEach(async()=>{
  await transaction(db,async sql=>{
    for(const table of ['recovery_intents','recovery_budgets','outbox_jobs','audit_events'])await sql.query(`delete from ${table} where merchant_id=$1`,[merchantId]);
    await sql.query("update checkout_sessions set state_version=1,status='accepted',refund_hold=false,refund_amount=0 where id=$1",[checkoutId]);
    await sql.query("update webhook_deliveries set status='dead',state_version=1,error_code=null where id=$1",[deliveryId]);
    await sql.query('delete from merchant_settings where merchant_id=$1',[merchantId]);
    const source=snapshot();await sql.query("insert into screening_sources(source_id,snapshot,health,fetched_at) values($1,$2,$3,now()) on conflict(source_id) do update set snapshot=excluded.snapshot,health=excluded.health,fetched_at=excluded.fetched_at",[OFAC_SOURCE_ID,JSON.stringify(source),JSON.stringify({state:'available',checkedAt:source.fetchedAt})]);
  });
});
afterAll(async()=>{try{
  await cleanupTestMerchants(db,[merchantId]);
  if(priorSource)await db.pool.query('update screening_sources set snapshot=$2,health=$3,fetched_at=$4,updated_at=$5 where source_id=$1',[OFAC_SOURCE_ID,JSON.stringify(priorSource.snapshot),JSON.stringify(priorSource.health),priorSource.fetched_at,priorSource.updated_at]);else await db.pool.query('delete from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);
}finally{await db.pool.end();if(priorToken===undefined)delete process.env.RECOVERY_SERVICE_TOKEN;else process.env.RECOVERY_SERVICE_TOKEN=priorToken;}});

describe('real isolated Neon recovery ledger with explicit eligibility/order/HTTP fixtures',()=>{
  it('handles a checked-out transport error and discards its client without replaying the transaction',async()=>{
    let failed:unknown;let calls=0;
    await expect(transaction(db,async client=>{failed=client;calls++;client.emit('error',new Error('EXPLICIT_TRANSPORT_ERROR_FIXTURE'));throw new Error('EXPLICIT_OPERATION_ABORT');})).rejects.toThrow('EXPLICIT_OPERATION_ABORT');
    await transaction(db,async client=>{expect(client).not.toBe(failed);expect((await client.query('select 1 as ready')).rows[0].ready).toBe(1);});expect(calls).toBe(1);
  });
  it('requires the independent service token and rejects caller-supplied actor fields',()=>{
    expect(()=>authenticateRecovery(null)).toThrow();expect(()=>authenticateRecovery('Bearer '+randomToken())).toThrow();expect(authenticateRecovery('Bearer '+process.env.RECOVERY_SERVICE_TOKEN)).toBe('cre');expect(()=>recoverInput.parse({...input(),actor:'merchant'})).toThrow();
  });
  it('queries actual candidates, stable cursor pages and deterministic rotated selection',async()=>{
    const query=new URLSearchParams({limit:'1',merchant});expect((await recoveryCandidates(db,query)).items.map(row=>row.paymentId)).toEqual([paymentId]);query.set('slot','100');expect((await recoveryCandidates(db,query)).items[0].recoveryRound).toBe(1);query.set('cursor',deliveryId);await expect(recoveryCandidates(db,query)).rejects.toMatchObject({code:'INVALID_INPUT'});query.delete('slot');expect((await recoveryCandidates(db,query)).items).toHaveLength(0);
  });
  it('serializes concurrent node requests into one intent, budget increment and existing-event job',async()=>{
    const results=await Promise.all([requestRecovery(db,input(),'cre',deps),requestRecovery(db,input(),'cre',deps)]);expect(results.map(r=>r.status)).toEqual(['scheduled','scheduled']);expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
    const rows=(await db.pool.query("select payload from outbox_jobs where merchant_id=$1 and kind='payment.webhook'",[merchantId])).rows;expect(rows).toHaveLength(1);expect(rows[0].payload).toMatchObject({deliveryId,recoveryActor:'cre'});expect((await db.pool.query('select count from recovery_budgets where payment_id=$1',[paymentId])).rows[0].count).toBe(1);
  });
  it('rejects mismatched chain evidence even when its round already exists',async()=>{
    await requestRecovery(db,input(),'cre',deps);await expect(requestRecovery(db,{...input(),blockHash:`0x${randomToken()}`},'cre',deps)).rejects.toMatchObject({code:'RECOVERY_EVIDENCE_MISMATCH'});
  });
  it('holds a refund/version race and performs no recovery side effect',async()=>{
    await expect(requestRecovery(db,input(),'cre',{...deps,state:async()=>{await db.pool.query('update checkout_sessions set refund_hold=true,state_version=2 where id=$1',[checkoutId]);return current();}})).rejects.toMatchObject({code:'RECOVERY_CHANGED'});expect((await db.pool.query('select count(*)::int as n from outbox_jobs where merchant_id=$1',[merchantId])).rows[0].n).toBe(0);
  });
  it('fails closed on required source failure and merchant pause',async()=>{
    await db.pool.query("update screening_sources set health=$2 where source_id=$1",[OFAC_SOURCE_ID,JSON.stringify({state:'unavailable',checkedAt:new Date().toISOString()})]);await expect(requestRecovery(db,input(),'cre',deps)).rejects.toMatchObject({code:'RECOVERY_SCREENING_CHANGED'});
    const source=snapshot();await db.pool.query('update screening_sources set snapshot=$2,health=$3 where source_id=$1',[OFAC_SOURCE_ID,JSON.stringify(source),JSON.stringify({state:'available',checkedAt:source.fetchedAt})]);await db.pool.query('insert into merchant_settings(merchant_id,paused) values($1,true)',[merchantId]);await expect(requestRecovery(db,input(),'cre',deps)).rejects.toMatchObject({code:'MERCHANT_PAUSED'});
  });
  it('acknowledges an already fulfilled matching order without scheduling or consuming budget',async()=>{
    expect((await requestRecovery(db,input(),'cre',{...deps,order:async()=>({...await order(),state:'fulfilled',payment_id:paymentId})})).status).toBe('noop');expect((await db.pool.query('select status from webhook_deliveries where id=$1',[deliveryId])).rows[0].status).toBe('acknowledged');expect((await db.pool.query('select count(*)::int as n from recovery_budgets where payment_id=$1',[paymentId])).rows[0].n).toBe(0);
  });
  it('refuses cancelled or mismatched orders and stale eligibility grants',async()=>{
    expect((await requestRecovery(db,input(),'cre',{...deps,order:async()=>({...await order(),state:'cancelled'})})).status).toBe('refused');
    await db.pool.query('delete from recovery_intents where merchant_id=$1',[merchantId]);await expect(requestRecovery(db,input(),'cre',{...deps,order:async()=>({...await order(),payment_id:randomUUID()})})).rejects.toMatchObject({code:'RECOVERY_ORDER_MISMATCH'});await expect(requestRecovery(db,input(),'cre',{...deps,state:async()=>({...await current(),grant_expires_at:new Date(Date.now()-1000).toISOString()})})).rejects.toMatchObject({code:'RECOVERY_CHANGED'});
  });
  it('enforces cooldown, monotonic rounds and the three-round recovery budget',async()=>{
    await requestRecovery(db,input(),'cre',deps);await db.pool.query("update webhook_deliveries set status='dead' where id=$1",[deliveryId]);await expect(requestRecovery(db,input(2),'cre',deps)).rejects.toMatchObject({code:'RECOVERY_BUDGET'});
    for(const round of [2,3]){await db.pool.query("update recovery_budgets set last_at=now()-interval '61 seconds' where payment_id=$1",[paymentId]);if(round===2)await expect(requestRecovery(db,input(3),'cre',deps)).rejects.toMatchObject({code:'RECOVERY_ROUND_CHANGED'});expect((await requestRecovery(db,input(round),'cre',deps)).status).toBe('scheduled');await db.pool.query("update webhook_deliveries set status='dead' where id=$1",[deliveryId]);}
    expect((await recoveryCandidates(db,new URLSearchParams({merchant}))).items).toHaveLength(0);await expect(requestRecovery(db,input(4),'cre',deps)).rejects.toThrow();
  });
  it('records CRE completion only for a successful current lease and preserves receiver test boundary',async()=>{
    await requestRecovery(db,input(),'cre',deps);const job=(await db.pool.query<ClaimedJob>("update outbox_jobs set status='processing',attempts=1,lease_token=$2,lease_until=now()+interval '60 seconds' where merchant_id=$1 returning id,merchant_id,kind,payload,lease_token,attempts,max_attempts",[merchantId,randomUUID()])).rows[0];let posts=0;
    await deliverPayment(db,job,{state:current,order,config:merchantIntegration,post:async()=>{posts++;return {received:true};}});
    expect(posts).toBe(1);expect((await db.pool.query('select delivered_at from recovery_intents where merchant_id=$1',[merchantId])).rows[0].delivered_at).toBeTruthy();expect((await db.pool.query("select count(*)::int as n from audit_events where merchant_id=$1 and kind='recovery.delivered'",[merchantId])).rows[0].n).toBe(1);
    await db.pool.query("update outbox_jobs set lease_until=now()-interval '1 second' where id=$1",[job.id]);await expect(deliverPayment(db,job,{state:current,order,config:merchantIntegration,post:async()=>{posts++;return {};}})).rejects.toThrow();expect(posts).toBe(1);
  });
});
