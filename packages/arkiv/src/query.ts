import { createPublicClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { asc, eq, gt, gte, lte } from '@arkiv-network/sdk/query';
import { addr, key, str, u64 } from '@arkiv-network/sdk/schema';
import { http, type Address, type Hex } from 'viem';
import { ARKIV_CHAIN_ID, ARKIV_PUBLIC_RPC, ReceiptError, ReceiptSchema, parseReceipt, type PublicQueryConfig, type PublicReceipt, type ReceiptEntity } from './schema.ts';
import { boundedRpcFetch } from './rpc.ts';

export function arkivPublicClient(config:PublicQueryConfig){return createPublicClient({chain:rabdi({accessKey:''}),transport:http(config.arkivRpcUrl??ARKIV_PUBLIC_RPC,{timeout:12_000,retryCount:0,fetchFn:boundedRpcFetch(config.deadline)})});}
export interface ReceiptQuery extends PublicQueryConfig {merchant:Address;kind?:PublicReceipt['kind'];fromBlock?:string;toBlock?:string;fromDate?:number;toDate?:number;pageSize?:number;cursor?:Hex;eventId?:Hex}
export interface ReceiptPage {entities:ReceiptEntity[];nextCursor:Hex|null;readAtBlock:string;skipped:number}
export async function queryReceipts(options:ReceiptQuery):Promise<ReceiptPage>{
  if(!/^0x[0-9a-f]{40}$/i.test(options.merchant)||!/^0x[0-9a-f]{40}$/i.test(options.writer))throw new ReceiptError('QUERY_ADDRESS_INVALID');
  const limit=options.pageSize??25;if(!Number.isInteger(limit)||limit<1||limit>100)throw new ReceiptError('QUERY_LIMIT_INVALID');
  for(const value of [options.fromBlock,options.toBlock])if(value!==undefined&&!/^(0|[1-9]\d{0,19})$/.test(value))throw new ReceiptError('QUERY_BLOCK_INVALID');
  for(const value of [options.fromDate,options.toDate])if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))throw new ReceiptError('QUERY_DATE_INVALID');
  if(options.cursor&&!/^0x[0-9a-f]{64}$/i.test(options.cursor))throw new ReceiptError('QUERY_CURSOR_INVALID');
  const client=arkivPublicClient(options);if(await client.getChainId()!==ARKIV_CHAIN_ID)throw new ReceiptError('ARKIV_CHAIN_MISMATCH');
  // Keyset paging is stable under new writes. Throw on malformed schema rather
  // than silently skipping a whole page with no continuation key.
  const query=client.select().from(ReceiptSchema,{onMismatch:'throw'}).ownedBy(options.writer).createdBy(options.writer).where(eq('merchant',addr(options.merchant))).orderBy(asc('$key')).limit(limit);
  if(options.kind)query.where(eq('kind',str(options.kind)));
  if(options.fromBlock!==undefined)query.where(gte('blockNumber',u64(options.fromBlock)));
  if(options.toBlock!==undefined)query.where(lte('blockNumber',u64(options.toBlock)));
  if(options.fromDate!==undefined)query.where(gte('sourceTimestamp',u64(options.fromDate)));
  if(options.toDate!==undefined)query.where(lte('sourceTimestamp',u64(options.toDate)));
  if(options.cursor)query.where(gt('$key',key(options.cursor)));
  if(options.eventId)query.where(eq('eventId',key(options.eventId)));
  const page=await query.fetch();
  const entities:ReceiptEntity[]=page.entities.map(row=>{
    const receipt=parseReceipt({schemaVersion:row.schemaVersion.value,eventId:row.eventId.value,kind:row.kind.value,chainId:row.chainId.value,router:row.router.value,token:row.token.value,invoiceId:row.invoiceId.value,...(row.refundId?{refundId:row.refundId.value}:{}),payer:row.payer.value,merchant:row.merchant.value,amountBaseUnits:row.amountBaseUnits.value.toString(),txHash:row.txHash.value,logIndex:row.logIndex.value,blockNumber:row.blockNumber.value.toString(),blockHash:row.blockHash.value,sourceTimestamp:Number(row.sourceTimestamp.value)});
    return {entityKey:row.$key,owner:row.$owner.toLowerCase() as Address,creator:row.$creator.toLowerCase() as Address,expiresAt:row.$expiresAt.toString(),readAtBlock:page.blockNumber.toString(),receipt};
  });
  return {entities,nextCursor:entities.length===limit?entities.at(-1)!.entityKey:null,readAtBlock:page.blockNumber.toString(),skipped:page.skipped};
}
