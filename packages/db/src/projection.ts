import type {PoolClient} from 'pg';
import {keccak256,toHex} from 'viem';
import {parseReceipt,sourceEventId,type ReceiptInput} from '@settlekit/arkiv';
import {enqueue} from './jobs.ts';
import {transaction,type Database} from './client.ts';
import {chainClient} from './policy.ts';
export async function queuePublicReceipt(sql:PoolClient,merchantId:string,input:ReceiptInput){
  const receipt=parseReceipt({...input,eventId:sourceEventId(input)});
  await sql.query('insert into arkiv_mappings(event_id,merchant_id,kind,payload) values($1,$2,$3,$4) on conflict(event_id) do nothing',[receipt.eventId,merchantId,receipt.kind,JSON.stringify(receipt)]);
  await enqueue(sql,'arkiv.publish',`arkiv:${receipt.eventId}`,{eventId:receipt.eventId},merchantId);
}

/** Original orphaned identity, never an order/customer identifier. */
export type CorrectionSource=Omit<ReceiptInput,'kind'|'amountBaseUnits'|'sourceTimestamp'>;
function pendingCorrectionId(source:CorrectionSource){return keccak256(toHex(JSON.stringify(['settlekit:correction-source-pending',source.chainId,source.router.toLowerCase(),source.txHash.toLowerCase(),source.logIndex,source.blockNumber,source.blockHash.toLowerCase()])));}

/**
 * A correction names the original orphaned block but must carry the current
 * replacement block's timestamp. An unknown timestamp is durable private work,
 * never a fabricated public receipt or an immediately publishable job.
 */
export async function queuePublicCorrection(sql:PoolClient,merchantId:string,source:CorrectionSource,replacementTimestamp?:number){
  const pendingId=pendingCorrectionId(source);
  if(typeof replacementTimestamp!=='number'||!Number.isSafeInteger(replacementTimestamp)||replacementTimestamp<=0){
    await sql.query("insert into arkiv_mappings(event_id,merchant_id,kind,payload,status,error_code) values($1,$2,'correction',$3,'awaiting_source','CORRECTION_TIMESTAMP_REQUIRED') on conflict(event_id) do nothing",[pendingId,merchantId,JSON.stringify({...source,kind:'correction',amountBaseUnits:'0',sourceTimestamp:null})]);
    return;
  }
  await queuePublicReceipt(sql,merchantId,{...source,kind:'correction',amountBaseUnits:'0',sourceTimestamp:replacementTimestamp});
  // Keep a private repair trail after resolving a provisional item. The public
  // version key includes the actual timestamp and can never be this null item.
  await sql.query("update arkiv_mappings set status='superseded',error_code='CORRECTION_SOURCE_RESOLVED',updated_at=now() where event_id=$1 and merchant_id=$2 and status='awaiting_source'",[pendingId,merchantId]);
}

/** Preserve an older source identity when a stale poll meets a newer DB row. */
export async function queueMappedCorrections(sql:PoolClient,merchantId:string,kind:'payment'|'refund',invoiceId:string,oldBlockHash:string,replacementTimestamp?:number,refundId?:string){
  const rows=await sql.query<{payload:unknown}>("select payload from arkiv_mappings where merchant_id=$1 and kind=$2 and payload->>'invoiceId'=$3 and payload->>'blockHash'=$4 and ($5::text is null or payload->>'refundId'=$5) limit 512",[merchantId,kind,invoiceId,oldBlockHash,refundId??null]);
  for(const row of rows.rows){const {eventId:_id,kind:_kind,amountBaseUnits:_amount,sourceTimestamp:_time,...source}=parseReceipt(row.payload);await queuePublicCorrection(sql,merchantId,source,replacementTimestamp);}
  return rows.rows.length;
}

/** Called by the operator worker; all chain reads happen outside SQL locks. */
export async function backfillPublicCorrections(db:Database,limit=5){
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('CORRECTION_REPAIR_LIMIT');
  const rows=(await db.pool.query<{event_id:string;merchant_id:string;payload:CorrectionSource&{sourceTimestamp:null}}>("select event_id,merchant_id,payload from arkiv_mappings where kind='correction' and status='awaiting_source' order by updated_at,created_at limit $1",[limit])).rows;
  if(!rows.length)return {examined:0,queued:0};
  const client=chainClient();if(await client.getChainId()!==1874)throw new Error('CORRECTION_CHAIN_MISMATCH');let queued=0;
  for(const row of rows){
    try{
      const block=await client.getBlock({blockNumber:BigInt(row.payload.blockNumber)});
      if(!block.hash)throw new Error('CORRECTION_BLOCK_UNAVAILABLE');
      if(block.hash.toLowerCase()===row.payload.blockHash.toLowerCase()){
        await db.pool.query("update arkiv_mappings set status='superseded',error_code='CORRECTION_NOT_CURRENTLY_ESTABLISHED',updated_at=now() where event_id=$1 and status='awaiting_source'",[row.event_id]);continue;
      }
      const confirmed=await client.getBlock({blockNumber:BigInt(row.payload.blockNumber)});if(confirmed.hash!==block.hash)throw new Error('CORRECTION_BLOCK_CHANGED');
      const timestamp=Number(block.timestamp);if(!Number.isSafeInteger(timestamp)||timestamp<=0)throw new Error('CORRECTION_TIMESTAMP_INVALID');
      await transaction(db,async sql=>{await sql.query('select id from merchants where id=$1 for update',[row.merchant_id]);
        const current=await sql.query("select event_id from arkiv_mappings where event_id=$1 and merchant_id=$2 and status='awaiting_source' for update",[row.event_id,row.merchant_id]);if(!current.rowCount)return;
        const {sourceTimestamp:_missing,...source}=row.payload;await queuePublicCorrection(sql,row.merchant_id,source,timestamp);queued++;
      });
    }catch(error){const code=error instanceof Error&&/^[A-Z_]{1,64}$/.test(error.message)?error.message:'CORRECTION_SOURCE_UNAVAILABLE';await db.pool.query("update arkiv_mappings set error_code=$2,updated_at=now() where event_id=$1 and status='awaiting_source'",[row.event_id,code]);}
  }
  return {examined:rows.length,queued};
}
