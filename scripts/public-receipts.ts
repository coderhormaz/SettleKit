/** Private operator repair of projection jobs; never changes monetary facts. */
import {config} from 'dotenv';
import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';
import {arkivPublicClient} from '../packages/arkiv/src/index.ts';
import {database,enqueue,routerConfiguration,transaction} from '../packages/db/src/index.ts';
config({path:new URL('../.env',import.meta.url),quiet:true});
const action=process.argv[2]??'status';
if(!['status','retry'].includes(action))throw new Error('USAGE_STATUS_OR_RETRY');
const db=database();
try{
  if(action==='status'){
    const rows=(await db.pool.query('select status,count(*)::int as count from arkiv_mappings group by status order by status')).rows;
    process.stdout.write(JSON.stringify({kind:'private-projection-status',states:rows,publicWriteProven:false})+'\n');
  }else{
    const key=process.env.ARKIV_WRITER_PRIVATE_KEY;
    if(!/^0x[a-f0-9]{64}$/i.test(key??''))throw new Error('ARKIV_WRITER_UNCONFIGURED');
    routerConfiguration();
    const writer=privateKeyToAccount(key as Hex).address;
    if(await arkivPublicClient({writer,arkivRpcUrl:process.env.ARKIV_RPC_URL}).getBalance({address:writer})===0n)throw new Error('ARKIV_WRITER_UNFUNDED');
    const rows=(await db.pool.query<{event_id:string;merchant_id:string}>("select event_id,merchant_id from arkiv_mappings where status in ('blocked','failed') order by updated_at,event_id limit 100")).rows;
    let queued=0;
    for(const row of rows)await transaction(db,async sql=>{
      await sql.query('select id from merchants where id=$1 for update',[row.merchant_id]);
      const current=await sql.query("select event_id from arkiv_mappings where event_id=$1 and merchant_id=$2 and status in ('blocked','failed') for update",[row.event_id,row.merchant_id]);
      if(!current.rowCount)return;
      const active=await sql.query("select id from outbox_jobs where kind='arkiv.publish' and payload->>'eventId'=$1 and (status='pending' or (status='processing' and lease_until>now())) limit 1",[row.event_id]);
      if(active.rowCount)return;
      await enqueue(sql,'arkiv.publish',`arkiv-operator-retry:${row.event_id}:${randomUUID()}`,{eventId:row.event_id},row.merchant_id);
      await sql.query("update arkiv_mappings set status='pending',error_code=null,updated_at=now() where event_id=$1",[row.event_id]);
      await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'arkiv.retry_queued',$2)",[row.merchant_id,JSON.stringify({actor:'operator',eventId:row.event_id})]);queued++;
    });
    process.stdout.write(JSON.stringify({kind:'private-projection-repair',examined:rows.length,queued,limit:100,publicWriteProven:false})+'\n');
  }
}catch(error){process.stderr.write(`${error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'PUBLIC_RECEIPTS_UNAVAILABLE'}\n`);process.exitCode=1;}finally{await db.pool.end();}
