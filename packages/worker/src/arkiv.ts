import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import type {Hex} from 'viem';
import {arkivPublicClient,parseReceipt,RENEW_THRESHOLD_DAYS} from '@settlekit/arkiv';
import {publishReceipt} from '@settlekit/arkiv/server';
import {enqueue,routerConfiguration,transaction,type ClaimedJob,type Database} from '@settlekit/db';
import {runtimeConfig} from '@settlekit/core/server';

export async function publishArkiv(db:Database,job:ClaimedJob):Promise<'completed'|'deferred'>{
  const eventId=typeof job.payload.eventId==='string'?job.payload.eventId:'';
  const mapping=(await db.pool.query<{payload:unknown;merchant_id:string}>('select payload,merchant_id from arkiv_mappings where event_id=$1',[eventId])).rows[0];
  if(!mapping||mapping.merchant_id!==job.merchant_id)throw new Error('ARKIV_JOB_INVALID');
  const key=process.env.ARKIV_WRITER_PRIVATE_KEY;
  if(!/^0x[0-9a-f]{64}$/i.test(key??'')){await markFailure(db,eventId,'ARKIV_WRITER_UNCONFIGURED');throw new Error('ARKIV_WRITER_UNCONFIGURED');}
  const account=privateKeyToAccount(key as Hex);const lease=randomUUID();
  const claimed=await db.pool.query(`insert into arkiv_writer_leases(writer,lease_token,lease_until) values($1,$2,now()+interval '120 seconds') on conflict(writer) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until where arkiv_writer_leases.lease_until<now() returning writer`,[account.address.toLowerCase(),lease]);
  if(!claimed.rowCount){await db.pool.query("update outbox_jobs set status='pending',attempts=greatest(0,attempts-1),available_at=now()+interval '10 seconds',lease_token=null,lease_until=null where id=$1 and lease_token=$2 and lease_until>now()",[job.id,job.lease_token]);return 'deferred';}
  try{
    const client=arkivPublicClient({writer:account.address,arkivRpcUrl:process.env.ARKIV_RPC_URL});
    if(await client.getBalance({address:account.address})===0n)throw new Error('ARKIV_WRITER_UNFUNDED');
    const config=routerConfiguration();const receipt=parseReceipt(mapping.payload);
    const result=await publishReceipt(receipt,{privateKey:key as Hex,arkivRpcUrl:process.env.ARKIV_RPC_URL,accessKey:process.env.ARKIV_ACCESS_KEY,router:config.router,routerCodeHash:config.codeHash,deploymentBlock:config.deploymentBlock.toString(),whitechainRpcUrl:runtimeConfig().rpc});
    const updated=await db.pool.query("update arkiv_mappings set status='published',entity_key=$2,expires_at_block=$3,transaction_hash=$4,error_code=null,updated_at=now() where event_id=$1 and exists(select 1 from arkiv_writer_leases where writer=$5 and lease_token=$6 and lease_until>now()) returning event_id",[eventId,result.entityKey,result.expiresAt,result.transactionHash??null,account.address.toLowerCase(),lease]);
    if(!updated.rowCount)throw new Error('ARKIV_WRITER_LEASE_LOST');
    return 'completed';
  }catch(error){const code=error instanceof Error&&/^[A-Z_]{1,64}$/.test(error.message)?error.message:'ARKIV_PUBLICATION_UNAVAILABLE';await markFailure(db,eventId,code);throw new Error(code);}
  finally{await db.pool.query('delete from arkiv_writer_leases where writer=$1 and lease_token=$2',[account.address.toLowerCase(),lease]);}
}
async function markFailure(db:Database,eventId:string,code:string){await db.pool.query("update arkiv_mappings set status=case when $2 in ('ARKIV_WRITER_UNFUNDED','ARKIV_WRITER_UNCONFIGURED') then 'blocked' else 'failed' end,error_code=$2,updated_at=now() where event_id=$1",[eventId,code]);}

export async function scheduleArkivRenewals(db:Database){
  const key=process.env.ARKIV_WRITER_PRIVATE_KEY;if(!/^0x[0-9a-f]{64}$/i.test(key??''))return;
  const account=privateKeyToAccount(key as Hex);const client=arkivPublicClient({writer:account.address,arkivRpcUrl:process.env.ARKIV_RPC_URL});
  const timing=await client.getBlockTiming();if(!Number.isFinite(timing.blockDuration)||timing.blockDuration<=0)throw new Error('ARKIV_TIMING_INVALID');
  const threshold=timing.currentBlock+BigInt(Math.ceil(RENEW_THRESHOLD_DAYS*86400/timing.blockDuration));
  await transaction(db,async sql=>{const rows=await sql.query<{event_id:string;merchant_id:string;expires_at_block:string}>("select event_id,merchant_id,expires_at_block from arkiv_mappings where status='published' and expires_at_block<=$1 order by expires_at_block limit 50",[threshold.toString()]);for(const row of rows.rows)await enqueue(sql,'arkiv.publish',`arkiv-renew:${row.event_id}:${row.expires_at_block}`,{eventId:row.event_id},row.merchant_id);});
}
