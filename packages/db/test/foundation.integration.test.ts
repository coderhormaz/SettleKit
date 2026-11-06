import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { randomUUID } from 'node:crypto';
import { UINT256_MAX } from '@settlekit/core';
import { hashToken, randomToken } from '@settlekit/core/server';
import { authenticate, claimJob, completeJob, createDatabase, enqueue, failJob, logout, merchantProfile, publishSnapshot, recordSourceFailure, refreshMerchantScreening, requestChallenge, transaction, updateMerchant, verifyChallenge } from '../src/index.ts';
import { OFAC_SDN_URL, OFAC_SOURCE_ID, SCREENING_COVERAGE, type SourceSnapshot } from '@settlekit/screening';

if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Explicit isolated TEST_DATABASE_URL required for real PostgreSQL tests.');
const db=createDatabase(process.env.TEST_DATABASE_URL,4);
const merchants:string[]=[];const jobIds:string[]=[];
async function login(){const account=privateKeyToAccount(generatePrivateKey());const browserToken=randomToken();const challenge=await requestChallenge(db,{address:account.address,browserToken,purpose:'login'});const signature=await account.signMessage({message:challenge.message});const result=await verifyChallenge(db,{id:challenge.id,signature,browserToken,purpose:'login'});merchants.push(result.merchantId);return {account,browserToken,challenge,signature,...result};}
const snapshot=(address:string):SourceSnapshot=>({sourceId:OFAC_SOURCE_ID,sourceUrl:OFAC_SDN_URL,sha256:'a'.repeat(64),fetchedAt:new Date().toISOString(),publishedAt:new Date(Date.now()-60_000).toISOString(),coverage:{...SCREENING_COVERAGE},addresses:[address.toLowerCase()],entryCount:1,recordCount:1});

beforeAll(async()=>{for(let attempt=0;attempt<3;attempt++){try{await db.pool.query('select 1');return;}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}}},60_000);
afterAll(async()=>{
  for(const id of merchants){for(const table of ['audit_events','screening_decisions','outbox_jobs','merchant_sessions','wallet_challenges'])await db.pool.query(`delete from ${table} where merchant_id=$1`,[id]);await db.pool.query('delete from merchants where id=$1',[id]);}
  if(jobIds.length)await db.pool.query('delete from outbox_jobs where id=any($1::uuid[])',[jobIds]);
  await db.pool.end();
});

describe('actual isolated Neon PostgreSQL foundation',()=>{
  it('redacts malformed connection configuration before it can reach worker startup logs',()=>{
    let captured:unknown;try{createDatabase('postgres://user:CANARY_CONNECTION_SECRET@');}catch(error){captured=error;}
    expect(captured).toMatchObject({code:'DATABASE_CONFIGURATION'});expect(JSON.stringify(captured)).not.toContain('CANARY_CONNECTION_SECRET');expect(String(captured)).not.toContain('CANARY_CONNECTION_SECRET');
  });
  it('round-trips the uint256 limit and rejects overflow/negative values',async()=>{
    const id=randomUUID();await db.pool.query('insert into monetary_precision_checks(id,amount) values($1,$2)',[id,UINT256_MAX.toString()]);
    try{const result=await db.pool.query<{amount:string}>('select amount from monetary_precision_checks where id=$1',[id]);expect(result.rows[0].amount).toBe(UINT256_MAX.toString());expect(typeof result.rows[0].amount).toBe('string');for(const invalid of [(UINT256_MAX+1n).toString(),'-1','0.5'])await expect(db.pool.query('insert into monetary_precision_checks(amount) values($1)',[invalid])).rejects.toThrow();}finally{await db.pool.query('delete from monetary_precision_checks where id=$1',[id]);}
  });
  it('rolls back a domain mutation together with its outbox record',async()=>{
    const user=await login();const key=`rollback:${randomUUID()}`;
    await expect(transaction(db,async(sql)=>{await sql.query("update merchants set display_name='Must roll back' where id=$1",[user.merchantId]);await enqueue(sql,'merchant.screening',key,{},user.merchantId);throw new Error('injected interruption');})).rejects.toThrow('injected interruption');
    expect((await merchantProfile(db,user.merchantId)).displayName).toBe('');expect((await db.pool.query('select id from outbox_jobs where dedupe_key=$1',[key])).rowCount).toBe(0);
  });
  it('binds SIWE to browser/purpose/expiry and consumes it once under concurrency',async()=>{
    const account=privateKeyToAccount(generatePrivateKey());const browserToken=randomToken();const challenge=await requestChallenge(db,{address:account.address,browserToken,purpose:'login'});const signature=await account.signMessage({message:challenge.message});
    await expect(verifyChallenge(db,{id:challenge.id,signature,browserToken:randomToken(),purpose:'login'})).rejects.toMatchObject({code:'CHALLENGE_INVALID'});
    const results=await Promise.allSettled([verifyChallenge(db,{id:challenge.id,signature,browserToken,purpose:'login'}),verifyChallenge(db,{id:challenge.id,signature,browserToken,purpose:'login'})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);for(const result of results)if(result.status==='fulfilled')merchants.push(result.value.merchantId);
    const expired=await requestChallenge(db,{address:account.address,browserToken,purpose:'login'});await db.pool.query("update wallet_challenges set expires_at=now()-interval '1 second' where id=$1",[expired.id]);await expect(verifyChallenge(db,{id:expired.id,signature,browserToken,purpose:'login'})).rejects.toMatchObject({code:'CHALLENGE_INVALID'});
    await db.pool.query('delete from wallet_challenges where id=any($1::uuid[])',[[challenge.id,expired.id]]);
  });
  it('isolates merchant resources and revokes sessions on logout',async()=>{
    const a=await login();const b=await login();await updateMerchant(db,a.merchantId,{displayName:'Private studio A',websiteOrigin:'https://a.example'});await updateMerchant(db,b.merchantId,{displayName:'Private studio B',websiteOrigin:'https://b.example'});
    expect((await authenticate(db,a.sessionToken!)).id).toBe(a.merchantId);expect((await merchantProfile(db,a.merchantId)).displayName).toBe('Private studio A');expect((await merchantProfile(db,b.merchantId)).displayName).toBe('Private studio B');
    await expect(updateMerchant(db,a.merchantId,{displayName:'Tampered tenant',websiteOrigin:'https://a.example',merchantId:b.merchantId})).rejects.toThrow();
    const proof=await requestChallenge(db,{address:b.account.address,browserToken:b.browserToken,purpose:'settlement',merchantId:b.merchantId});const signature=await b.account.signMessage({message:proof.message});await expect(verifyChallenge(db,{id:proof.id,signature,browserToken:b.browserToken,purpose:'settlement',merchantId:a.merchantId})).rejects.toMatchObject({code:'CHALLENGE_INVALID'});
    await logout(db,a.sessionToken!);await expect(authenticate(db,a.sessionToken!)).rejects.toMatchObject({status:401});expect((await db.pool.query('select token_hash from merchant_sessions where token_hash=$1',[hashToken(a.sessionToken!)])).rowCount).toBe(0);
    await db.pool.query("update merchant_sessions set expires_at=now()-interval '1 second' where token_hash=$1",[hashToken(b.sessionToken!)]);await expect(authenticate(db,b.sessionToken!)).rejects.toMatchObject({code:'SESSION_EXPIRED'});
  });
  it('evaluates current required-source outage and hard match instead of replaying an allowed decision',async()=>{
    const user=await login();const original=snapshot('0x1111111111111111111111111111111111111111');await publishSnapshot(db,original);expect((await refreshMerchantScreening(db,user.merchantId)).state).toBe('allowed');
    await recordSourceFailure(db,'SOURCE_FETCH_FAILED');expect((await merchantProfile(db,user.merchantId)).screening.state).toBe('unavailable');
    await publishSnapshot(db,original);expect((await merchantProfile(db,user.merchantId)).screening.state).toBe('unavailable');
    await publishSnapshot(db,snapshot(user.account.address));expect((await refreshMerchantScreening(db,user.merchantId)).state).toBe('blocked');
  });
  it('claims jobs once, fences stale leases, caps retries and reconnects after a process pool restart',async()=>{
    // This explicitly isolated test branch also holds browser fixtures from prior runs.
    await db.pool.query("update outbox_jobs set status='completed' where kind='merchant.screening' and merchant_id is not null");
    const key=`job:${randomUUID()}`;await transaction(db,async(sql)=>{await enqueue(sql,'merchant.screening',key,{});await enqueue(sql,'merchant.screening',key,{});});
    const row=await db.pool.query<{id:string}>('select id from outbox_jobs where dedupe_key=$1',[key]);jobIds.push(row.rows[0].id);expect(row.rowCount).toBe(1);
    const claimed=await Promise.all([claimJob(db),claimJob(db)]);const job=claimed.find(Boolean)!;expect(claimed.filter(Boolean)).toHaveLength(1);expect(job.id).toBe(row.rows[0].id);
    await db.pool.query("update outbox_jobs set lease_until=now()-interval '1 second' where id=$1",[job.id]);expect(await completeJob(db,job)).toBe(false);
    const reclaimed=await claimJob(db);expect(reclaimed!.lease_token).not.toBe(job.lease_token);expect(await completeJob(db,job)).toBe(false);await db.pool.query('update outbox_jobs set attempts=max_attempts where id=$1',[job.id]);expect(await failJob(db,reclaimed!,'TEST_FAILURE')).toBe(true);expect((await db.pool.query('select status from outbox_jobs where id=$1',[job.id])).rows[0].status).toBe('dead');
    const fresh=createDatabase(process.env.TEST_DATABASE_URL!,1);expect((await fresh.pool.query('select 1 as value')).rows[0].value).toBe(1);await fresh.pool.end();
  });
  it('uses a limited runtime role and recovers a terminated connection without duplicating a durable job',async()=>{
    const role=await db.pool.query<{rolsuper:boolean;rolbypassrls:boolean}>('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
    const key=`uncertain:${randomUUID()}`;await transaction(db,sql=>enqueue(sql,'merchant.screening',key,{}));
    const interrupted=await db.pool.connect();try{await expect(interrupted.query('select pg_terminate_backend(pg_backend_pid())')).rejects.toThrow();}finally{interrupted.release(true);}
    // Retry after losing the response around the durable effect; the logical key survives.
    await transaction(db,sql=>enqueue(sql,'merchant.screening',key,{}));const row=await db.pool.query<{id:string}>('select id from outbox_jobs where dedupe_key=$1',[key]);expect(row.rowCount).toBe(1);jobIds.push(row.rows[0].id);
  });
});
