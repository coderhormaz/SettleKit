import { decodeEventLog, type Address, type Hex } from 'viem';
import { routerAbi } from '@settlekit/core/router';
import { logicalEventId, parseReceipt, ReceiptError, sourceEventId, TOKEN, validateSourceConfig, type PublicReceipt, type ReceiptEntity, type SourceConfig } from './schema.ts';
import { sourceReader, verifySourceReceipt, type SourceReader } from './verify.ts';

export interface CoverageCursor {fromBlock:string;toBlock:string;nextBlock:string;anchorHash:Hex}
export interface CoverageBatch {cursor:CoverageCursor;complete:boolean;scannedBlocks:string;events:PublicReceipt[]}
export async function scanCoverage(config:SourceConfig,options:{merchant:Address;fromBlock?:string;toBlock?:string;cursor?:CoverageCursor;maxBlocks?:number;fromDate?:number;toDate?:number},reader:SourceReader=sourceReader(config)):Promise<CoverageBatch>{
  const source=validateSourceConfig(config);const head=await reader.head();if(await reader.chainId()!==1874)throw new ReceiptError('SOURCE_CHAIN_MISMATCH');
  const requestedStart=BigInt(options.fromBlock??source.deploymentBlock);const from=requestedStart<BigInt(source.deploymentBlock)?BigInt(source.deploymentBlock):requestedStart;
  const to=options.cursor?BigInt(options.cursor.toBlock):options.toBlock===undefined?head-1n:BigInt(options.toBlock)<head?BigInt(options.toBlock):head-1n;
  if(from<0n||to<from)throw new ReceiptError('COVERAGE_RANGE_INVALID');
  const anchor=await reader.block(to);if(!anchor.hash)throw new ReceiptError('COVERAGE_ANCHOR_UNAVAILABLE');
  const cursor=options.cursor??{fromBlock:from.toString(),toBlock:to.toString(),nextBlock:from.toString(),anchorHash:anchor.hash};
  if(cursor.fromBlock!==from.toString()||cursor.toBlock!==to.toString()||cursor.anchorHash!==anchor.hash)throw new ReceiptError('COVERAGE_ANCHOR_CHANGED');
  const maxBlocks=options.maxBlocks??200;if(!Number.isInteger(maxBlocks)||maxBlocks<1||maxBlocks>500)throw new ReceiptError('COVERAGE_LIMIT_INVALID');
  const start=BigInt(cursor.nextBlock);const end=start+BigInt(maxBlocks)-1n<to?start+BigInt(maxBlocks)-1n:to;
  if(start<from||start>to+1n)throw new ReceiptError('COVERAGE_CURSOR_INVALID');
  if(start>to)return {cursor,complete:true,scannedBlocks:(to-from+1n).toString(),events:[]};
  const events:PublicReceipt[]=[];
  for(const kind of ['payment','refund']as const){
    const logs=await reader.logs(source.router,kind,start,end);if(logs.length>1000)throw new ReceiptError('COVERAGE_EVENT_LIMIT');
    for(const log of logs){
      if(log.removed||log.logIndex===null||log.blockNumber===null||!log.blockHash||!log.transactionHash)continue;
      const decoded=decodeEventLog({abi:routerAbi,eventName:kind==='payment'?'PaymentAccepted':'RefundExecuted',data:log.data,topics:log.topics as [Hex,...Hex[]]});const args=decoded.args;
      if(args.merchant.toLowerCase()!==options.merchant.toLowerCase())continue;
      const block=await reader.block(log.blockNumber);const timestamp=Number(block.timestamp);
      if((options.fromDate!==undefined&&timestamp<options.fromDate)||(options.toDate!==undefined&&timestamp>options.toDate))continue;
      const fields={schemaVersion:1 as const,kind,chainId:1874 as const,router:source.router,token:TOKEN,invoiceId:args.invoiceId,...('refundId'in args?{refundId:args.refundId}:{}),payer:args.payer,merchant:args.merchant,amountBaseUnits:args.amount.toString(),txHash:log.transactionHash,logIndex:log.logIndex,blockNumber:log.blockNumber.toString(),blockHash:log.blockHash,sourceTimestamp:timestamp};
      const receipt=parseReceipt({...fields,eventId:sourceEventId(fields)});await verifySourceReceipt(receipt,source,reader);events.push(receipt);
    }
  }
  if((await reader.block(to)).hash!==cursor.anchorHash)throw new ReceiptError('COVERAGE_ANCHOR_CHANGED');
  return {cursor:{...cursor,nextBlock:(end+1n).toString()},complete:end===to,scannedBlocks:(end-from+1n).toString(),events};
}
export function reconcileCoverage(events:readonly PublicReceipt[],available:readonly ReceiptEntity[],scanComplete:boolean,queryComplete:boolean){
  const expected=new Map(events.map(receipt=>[logicalEventId(receipt),receipt]));const found=new Set(available.filter(entity=>entity.receipt.kind!=='correction').map(entity=>logicalEventId(entity.receipt)));
  const missing=[...expected].filter(([id])=>!found.has(id)).map(([,receipt])=>receipt);
  const unexpected=[...found].filter(id=>!expected.has(id));
  return {sourceEvents:expected.size,availableVerifiedRecords:found.size,missing,unexpected,complete:scanComplete&&queryComplete&&missing.length===0&&unexpected.length===0,scanComplete,queryComplete};
}
