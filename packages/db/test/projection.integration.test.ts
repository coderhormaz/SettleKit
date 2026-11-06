import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {numberToHex,type Hex} from 'viem';
import {parseReceipt,sourceEventId,TOKEN} from '@settlekit/arkiv';
import {createDatabase,transaction} from '../src/client.ts';
import {backfillPublicCorrections,queuePublicCorrection,queuePublicReceipt} from '../src/projection.ts';
import {publishArkiv} from '../../worker/src/arkiv.ts';
import type {ClaimedJob} from '../src/jobs.ts';
import {cleanupTestMerchants} from './cleanup.ts';
if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Separate isolated Neon required.');
const db=createDatabase(process.env.TEST_DATABASE_URL,3),merchantId=randomUUID(),writerKey=generatePrivateKey();
const wallet=privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Hex,writer=privateKeyToAccount(writerKey).address.toLowerCase();
const oldRpc=process.env.WHITECHAIN_RPC_URL,oldWriter=process.env.ARKIV_WRITER_PRIVATE_KEY;
const h=(c:string)=>`0x${c.repeat(64)}` as Hex;let rpc:Server;let unavailable=false;let canonicalHash=h('b');
const source={schemaVersion:1 as const,chainId:1874 as const,router:'0x2222222222222222222222222222222222222222' as Hex,token:TOKEN,invoiceId:h('1'),payer:'0x3333333333333333333333333333333333333333' as Hex,merchant:wallet,txHash:h('2'),logIndex:0,blockNumber:'100',blockHash:h('a')};
beforeAll(async()=>{
  // This operator repair scans globally; never let a synthetic RPC touch another
  // tenant's pending repair work, even on the explicitly isolated test branch.
  expect((await db.pool.query("select count(*)::int as n from arkiv_mappings where status='awaiting_source'")).rows[0].n).toBe(0);
  await db.pool.query("insert into merchants(id,owner_wallet,settlement_wallet,settlement_proven_at,display_name) values($1,$2,$2,now(),'Projection repair fixture')",[merchantId,wallet]);
  rpc=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=String(part);const call=JSON.parse(raw) as {id:number;method:string};if(unavailable&&call.method!=='eth_chainId'){res.writeHead(503);res.end();return;}const result=call.method==='eth_chainId'?'0x752':call.method==='eth_getBlockByNumber'?{number:'0x64',hash:canonicalHash,timestamp:numberToHex(1700000100),transactions:[],uncles:[],gasLimit:'0x1',gasUsed:'0x0',size:'0x1',difficulty:'0x0',totalDifficulty:'0x0',baseFeePerGas:'0x1'}:null;res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:call.id,result}));});
  await new Promise<void>(resolve=>rpc.listen(0,'127.0.0.1',resolve));process.env.WHITECHAIN_RPC_URL=`http://127.0.0.1:${(rpc.address() as {port:number}).port}`;
});
afterAll(async()=>{try{await cleanupTestMerchants(db,[merchantId]);await db.pool.query('delete from arkiv_writer_leases where writer=$1',[writer]);}finally{rpc?.closeAllConnections();if(rpc)await new Promise<void>(resolve=>rpc.close(()=>resolve()));await db.pool.end();if(oldRpc===undefined)delete process.env.WHITECHAIN_RPC_URL;else process.env.WHITECHAIN_RPC_URL=oldRpc;if(oldWriter===undefined)delete process.env.ARKIV_WRITER_PRIVATE_KEY;else process.env.ARKIV_WRITER_PRIVATE_KEY=oldWriter;}});
describe('real Neon projection repair with explicit replacement-block RPC fixture, no Arkiv write',()=>{
  it('durably waits for a real replacement timestamp without fabricating a publishable correction',async()=>{
    await transaction(db,sql=>queuePublicCorrection(sql,merchantId,source));const mappings=(await db.pool.query('select status,payload from arkiv_mappings where merchant_id=$1',[merchantId])).rows;expect(mappings).toHaveLength(1);expect(mappings[0]).toMatchObject({status:'awaiting_source',payload:{sourceTimestamp:null,amountBaseUnits:'0'}});expect((await db.pool.query('select count(*)::int as n from outbox_jobs where merchant_id=$1',[merchantId])).rows[0].n).toBe(0);
  });
  it('backfills from canonical replacement evidence, supersedes provisional work and queues one zero-money version',async()=>{
    expect(await backfillPublicCorrections(db)).toEqual({examined:1,queued:1});const rows=(await db.pool.query('select status,payload from arkiv_mappings where merchant_id=$1 order by created_at',[merchantId])).rows;expect(rows.map(row=>row.status)).toEqual(['superseded','pending']);const receipt=parseReceipt(rows[1].payload);expect(receipt).toMatchObject({kind:'correction',amountBaseUnits:'0',blockHash:source.blockHash,sourceTimestamp:1700000100});expect(receipt.eventId).toBe(sourceEventId(receipt));expect(await backfillPublicCorrections(db)).toEqual({examined:0,queued:0});expect((await db.pool.query('select count(*)::int as n from outbox_jobs where merchant_id=$1',[merchantId])).rows[0].n).toBe(1);
  });
  it('retains unavailable repair work and rejects a correction when its original block is canonical again',async()=>{
    const retrySource={...source,txHash:h('3')};await transaction(db,sql=>queuePublicCorrection(sql,merchantId,retrySource));unavailable=true;expect(await backfillPublicCorrections(db)).toEqual({examined:1,queued:0});expect((await db.pool.query("select error_code from arkiv_mappings where merchant_id=$1 and status='awaiting_source'",[merchantId])).rows[0].error_code).toBe('CORRECTION_SOURCE_UNAVAILABLE');unavailable=false;canonicalHash=source.blockHash;expect(await backfillPublicCorrections(db)).toEqual({examined:1,queued:0});expect((await db.pool.query("select count(*)::int as n from arkiv_mappings where merchant_id=$1 and status='awaiting_source'",[merchantId])).rows[0].n).toBe(0);
  });
  it('uses distinct immutable correction identities for changed replacement timestamps',async()=>{
    await transaction(db,sql=>queuePublicCorrection(sql,merchantId,source,1700000101));const values=(await db.pool.query("select payload from arkiv_mappings where merchant_id=$1 and status='pending'",[merchantId])).rows.map(row=>parseReceipt(row.payload));expect(values.map(value=>value.eventId)).toHaveLength(2);expect(new Set(values.map(value=>value.eventId)).size).toBe(2);expect(values.every(value=>value.amountBaseUnits==='0')).toBe(true);
  });
  it('defers a contested global writer lease without spending the job budget or touching RPC',async()=>{
    const payment={...source,kind:'payment' as const,amountBaseUnits:'1',sourceTimestamp:1700000000};await transaction(db,sql=>queuePublicReceipt(sql,merchantId,payment));const eventId=sourceEventId(payment);const job=(await db.pool.query<ClaimedJob>("update outbox_jobs set status='processing',attempts=1,lease_token=$3,lease_until=now()+interval '60 seconds' where merchant_id=$1 and payload->>'eventId'=$2 returning id,merchant_id,kind,payload,lease_token,attempts,max_attempts",[merchantId,eventId,randomUUID()])).rows[0];
    process.env.ARKIV_WRITER_PRIVATE_KEY=writerKey;await db.pool.query("insert into arkiv_writer_leases(writer,lease_token,lease_until) values($1,$2,now()+interval '120 seconds')",[writer,randomUUID()]);unavailable=true;expect(await publishArkiv(db,job)).toBe('deferred');expect((await db.pool.query('select status,attempts,lease_token from outbox_jobs where id=$1',[job.id])).rows[0]).toEqual({status:'pending',attempts:0,lease_token:null});
  });
});
