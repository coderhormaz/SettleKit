import { createPublicClient, decodeEventLog, http, keccak256, type Address, type Hex } from 'viem';
import { whitechainSepolia } from 'viem/chains';
import { ZodError } from 'zod';
import { routerAbi } from '@settlekit/core/router';
import { logicalEventId, parseReceipt, ReceiptError, TOKEN, validateSourceConfig, type PublicReceipt, type ReceiptEntity, type SourceConfig } from './schema.ts';
import { boundedRpcFetch } from './rpc.ts';

export interface SourceLog {address:Address;data:Hex;topics:readonly Hex[];logIndex:number|null;transactionHash:Hex|null;blockHash:Hex|null;blockNumber:bigint|null;removed?:boolean}
export interface SourceReader {
  chainId():Promise<number>;head():Promise<bigint>;block(number:bigint):Promise<{hash:Hex|null;timestamp:bigint}>;
  code(router:Address,block:bigint):Promise<Hex|undefined>;token(router:Address,block:bigint):Promise<Address>;
  receipt(hash:Hex):Promise<{status:string;transactionHash:Hex;blockNumber:bigint;blockHash:Hex;logs:readonly SourceLog[]}>;
  logs(router:Address,kind:'payment'|'refund',from:bigint,to:bigint):Promise<SourceLog[]>;
}
export function sourceReader(config:SourceConfig,deadline?:number):SourceReader {
  const source=validateSourceConfig(config);const client=createPublicClient({chain:whitechainSepolia,transport:http(source.whitechainRpcUrl,{timeout:12_000,retryCount:0,fetchFn:boundedRpcFetch(deadline)})});
  return {
    chainId:()=>client.getChainId(),head:()=>client.getBlockNumber({cacheTime:0}),block:async number=>client.getBlock({blockNumber:number}),
    code:(router,block)=>client.getCode({address:router,blockNumber:block}),token:(router,block)=>client.readContract({address:router,abi:routerAbi,functionName:'token',blockNumber:block}),
    receipt:hash=>client.getTransactionReceipt({hash}),
    logs:async(router,kind,from,to)=>client.getLogs({address:router,event:routerAbi.find(item=>item.type==='event'&&item.name===(kind==='payment'?'PaymentAccepted':'RefundExecuted')) as Extract<typeof routerAbi[number],{type:'event'}>,fromBlock:from,toBlock:to}),
  };
}
function requireFact(valid:unknown,code:string):asserts valid {if(!valid)throw new ReceiptError(code);}
export async function verifySourceReceipt(receipt:PublicReceipt,config:SourceConfig,reader=sourceReader(config)):Promise<void>{
  const source=validateSourceConfig(config);const blockNumber=BigInt(receipt.blockNumber);
  requireFact(receipt.router===source.router&&receipt.token===TOKEN&&blockNumber>=BigInt(source.deploymentBlock),'SOURCE_CONFIGURATION_MISMATCH');
  const [chainId,head,block]=await Promise.all([reader.chainId(),reader.head(),reader.block(blockNumber)]);
  requireFact(chainId===1874,'SOURCE_CHAIN_MISMATCH');requireFact(head>=blockNumber+1n,'SOURCE_CONFIRMATION_PENDING');
  requireFact(block.hash!==null&&Number(block.timestamp)===receipt.sourceTimestamp,'SOURCE_TIMESTAMP_MISMATCH');
  if(receipt.kind==='correction'){
    requireFact(block.hash!.toLowerCase()!==receipt.blockHash,'CORRECTION_NOT_ESTABLISHED');
    const [code,token]=await Promise.all([reader.code(source.router,blockNumber),reader.token(source.router,blockNumber)]);
    requireFact(code&&keccak256(code).toLowerCase()===source.routerCodeHash&&token.toLowerCase()===TOKEN,'SOURCE_ROUTER_MISMATCH');
    requireFact((await reader.block(blockNumber)).hash===block.hash,'SOURCE_ORPHANED');
    return;
  }
  requireFact(block.hash!.toLowerCase()===receipt.blockHash,'SOURCE_ORPHANED');
  const [transaction,code,token]=await Promise.all([reader.receipt(receipt.txHash),reader.code(source.router,blockNumber),reader.token(source.router,blockNumber)]);
  requireFact(code&&keccak256(code).toLowerCase()===source.routerCodeHash&&token.toLowerCase()===TOKEN,'SOURCE_ROUTER_MISMATCH');
  requireFact(transaction.status==='success'&&transaction.transactionHash.toLowerCase()===receipt.txHash&&transaction.blockHash.toLowerCase()===receipt.blockHash&&transaction.blockNumber===blockNumber,'SOURCE_RECEIPT_MISMATCH');
  const log=transaction.logs.find(item=>item.logIndex===receipt.logIndex);
  requireFact(log&&!log.removed&&log.address.toLowerCase()===source.router&&log.transactionHash?.toLowerCase()===receipt.txHash&&log.blockHash?.toLowerCase()===receipt.blockHash&&log.blockNumber===blockNumber,'SOURCE_LOG_MISMATCH');
  const eventName=receipt.kind==='payment'?'PaymentAccepted':'RefundExecuted';
  const decoded=decodeEventLog({abi:routerAbi,eventName,data:log.data,topics:log.topics as [Hex,...Hex[]]});const args=decoded.args;
  requireFact(args.invoiceId.toLowerCase()===receipt.invoiceId&&args.payer.toLowerCase()===receipt.payer&&args.merchant.toLowerCase()===receipt.merchant&&args.token.toLowerCase()===TOKEN&&args.amount.toString()===receipt.amountBaseUnits,'SOURCE_EVENT_MISMATCH');
  if(receipt.kind==='refund')requireFact('refundId'in args&&args.refundId.toLowerCase()===receipt.refundId,'SOURCE_REFUND_MISMATCH');
  requireFact((await reader.block(blockNumber)).hash?.toLowerCase()===receipt.blockHash,'SOURCE_ORPHANED');
}
export interface VerifiedEntity {entity:ReceiptEntity;status:'verified'|'rejected'|'unavailable';reason:string}
export async function verifyReceipt(entity:ReceiptEntity,config:SourceConfig&{writer:Address},reader?:SourceReader):Promise<VerifiedEntity>{
  try{
    requireFact(entity.owner.toLowerCase()===config.writer.toLowerCase()&&entity.creator.toLowerCase()===config.writer.toLowerCase(),'UNTRUSTED_WRITER');
    requireFact(BigInt(entity.expiresAt)>BigInt(entity.readAtBlock),'ENTITY_EXPIRED');
    const receipt=parseReceipt(entity.receipt);await verifySourceReceipt(receipt,config,reader);
    return {entity:{...entity,receipt},status:'verified',reason:receipt.kind==='correction'?'ORPHANED_BLOCK_CORRECTION_VERIFIED':'CANONICAL_SOURCE_VERIFIED'};
  }catch(error){return {entity,status:error instanceof ReceiptError||error instanceof ZodError?'rejected':'unavailable',reason:error instanceof ReceiptError?error.code:error instanceof ZodError?'RECEIPT_SCHEMA_INVALID':'SOURCE_RPC_UNAVAILABLE'};}
}
export function summarizeVerified(results:readonly VerifiedEntity[]){
  // Verification happens before logical deduplication. An expired/orphaned copy
  // cannot hide a later valid entity carrying the same logical source event.
  const unique=new Map<string,ReceiptEntity>();
  for(const result of results)if(result.status==='verified'){
    const id=logicalEventId(result.entity.receipt);const prior=unique.get(id);
    if(!prior||BigInt(result.entity.expiresAt)>BigInt(prior.expiresAt))unique.set(id,result.entity);
  }
  let gross=0n;let refunded=0n;
  for(const {receipt}of unique.values()){if(receipt.kind==='payment')gross+=BigInt(receipt.amountBaseUnits);if(receipt.kind==='refund')refunded+=BigInt(receipt.amountBaseUnits);}
  return {grossBaseUnits:gross.toString(),refundedBaseUnits:refunded.toString(),netBaseUnits:(gross-refunded).toString(),records:[...unique.values()],rejected:results.filter(result=>result.status==='rejected').length,unavailable:results.filter(result=>result.status==='unavailable').length,duplicateCount:results.filter(result=>result.status==='verified').length-unique.size};
}
export function accountingCsv(entities:readonly ReceiptEntity[]):string {
  const cell=(value:string)=>`"${(/^[=+\-@\t\r]/.test(value)?"'":'')+value.replaceAll('"','""')}"`;
  const rows=[['kind','source_timestamp_utc','amount_base_units','chain_id','merchant','payer','transaction_hash','log_index','block_number','block_hash','entity_key']];
  for(const {receipt,entityKey}of entities)rows.push([receipt.kind,new Date(receipt.sourceTimestamp*1000).toISOString(),receipt.amountBaseUnits,String(receipt.chainId),receipt.merchant,receipt.payer,receipt.txHash,String(receipt.logIndex),receipt.blockNumber,receipt.blockHash,entityKey]);
  return rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
