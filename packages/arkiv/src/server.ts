// Server-only entry point. The independent accountant imports only './index.ts'.
import { createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arkivPublicClient, queryReceipts } from './query.ts';
import { ARKIV_CHAIN_ID, parseReceipt, RECEIPT_RETENTION_DAYS, RENEW_THRESHOLD_DAYS, ReceiptError, ReceiptSchema, receiptValues, type PublicReceipt, type ReceiptEntity, type SourceConfig } from './schema.ts';
import { sourceReader, verifySourceReceipt } from './verify.ts';
import { boundedRpcFetch } from './rpc.ts';

export interface PublishConfig extends SourceConfig {privateKey:Hex;arkivRpcUrl?:string;accessKey?:string;publicationTimeoutMs?:number}
export interface PublishResult {entityKey:Hex;expiresAt:string;transactionHash?:Hex}
export interface PublishDependencies {
  verify(receipt:PublicReceipt):Promise<void>;
  find(receipt:PublicReceipt):Promise<ReceiptEntity[]>;
  timing():Promise<{currentBlock:bigint;blockDuration:number}>;
  pending():Promise<boolean>;
  create(receipt:PublicReceipt):Promise<PublishResult>;
  renew(entityKey:Hex):Promise<PublishResult>;
}
export function renewalRequired(expiresAt:string,timing:{currentBlock:bigint;blockDuration:number}):boolean {
  if(!Number.isFinite(timing.blockDuration)||timing.blockDuration<=0)throw new ReceiptError('ARKIV_TIMING_INVALID');
  return BigInt(expiresAt)-timing.currentBlock<=BigInt(Math.ceil(RENEW_THRESHOLD_DAYS*86400/timing.blockDuration));
}
function dependencies(config:PublishConfig,deadline:number):PublishDependencies {
  if(!/^0x[0-9a-f]{64}$/i.test(config.privateKey))throw new ReceiptError('ARKIV_WRITER_CONFIGURATION');
  const account=privateKeyToAccount(config.privateKey);const publicClient=arkivPublicClient({writer:account.address,arkivRpcUrl:config.arkivRpcUrl,deadline});
  const wallet=createWalletClient({account,chain:rabdi({accessKey:config.accessKey??''}),transport:http(config.arkivRpcUrl,{timeout:15_000,retryCount:0,fetchFn:boundedRpcFetch(deadline)})});
  return {
    verify:receipt=>verifySourceReceipt(receipt,config,sourceReader(config,deadline)),
    find:async receipt=>{const page=await queryReceipts({writer:account.address,merchant:receipt.merchant,eventId:receipt.eventId,pageSize:100,arkivRpcUrl:config.arkivRpcUrl,deadline});if(page.nextCursor)throw new ReceiptError('ARKIV_DUPLICATE_LIMIT');return page.entities;},
    timing:()=>publicClient.getBlockTiming(),
    pending:async()=>{if(await publicClient.getChainId()!==ARKIV_CHAIN_ID)throw new ReceiptError('ARKIV_CHAIN_MISMATCH');const [latest,pending]=await Promise.all([publicClient.getTransactionCount({address:account.address,blockTag:'latest'}),publicClient.getTransactionCount({address:account.address,blockTag:'pending'})]);return pending>latest;},
    create:async receipt=>{
      if(await publicClient.getBalance({address:account.address})===0n)throw new ReceiptError('ARKIV_WRITER_UNFUNDED');
      // Consistent salt is additional hygiene; the entity nonce still makes an
      // exact owner/creator/event query essential after a lost mapping commit.
      const result=await wallet.createEntity(ReceiptSchema,receiptValues(receipt),{expiration:ExpirationTime.fromDays(RECEIPT_RETENTION_DAYS),flags:{readonly:true},salt:BigInt(receipt.eventId)&((1n<<128n)-1n)});
      return {entityKey:result.entityKey,expiresAt:result.expiresAt.toString(),transactionHash:result.txHash};
    },
    renew:async entityKey=>{const result=await wallet.extendEntity({entityKey,expiration:ExpirationTime.fromDays(RECEIPT_RETENTION_DAYS)});return {entityKey,expiresAt:result.expiresAt.toString(),transactionHash:result.txHash};},
  };
}
const queues=new Map<string,Promise<unknown>>();
/**
 * Parent durable jobs must serialize this owner across processes and retain
 * ambiguous attempts for bounded query-first retries. Never map/write PII here.
 */
export async function publishReceipt(value:unknown,config:PublishConfig,provided?:PublishDependencies):Promise<PublishResult>{
  const receipt=parseReceipt(value);let owner:string;
  try{owner=privateKeyToAccount(config.privateKey).address.toLowerCase();}catch{throw new ReceiptError('ARKIV_WRITER_CONFIGURATION');}
  const timeout=config.publicationTimeoutMs??45_000;if(!Number.isInteger(timeout)||timeout<50||timeout>60_000)throw new ReceiptError('ARKIV_TIMEOUT_CONFIGURATION');
  const prior=queues.get(owner)??Promise.resolve();
  const work=prior.catch(()=>undefined).then(async()=>{
    const deadline=Date.now()+timeout;let writeStarted=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const task=(async()=>{
    const operations=provided??dependencies(config,deadline);await operations.verify(receipt);
    const matches=await operations.find(receipt);
    if(matches.some(entity=>entity.owner.toLowerCase()!==owner||entity.creator.toLowerCase()!==owner))throw new ReceiptError('ARKIV_UNTRUSTED_EXISTING_ENTITY');
    const exact=matches.filter(entity=>JSON.stringify(parseReceipt(entity.receipt))===JSON.stringify(receipt));
    if(matches.length&&!exact.length)throw new ReceiptError('ARKIV_EVENT_PAYLOAD_CONFLICT');
    if(exact.length){
      const entity=exact.sort((a,b)=>BigInt(a.expiresAt)>BigInt(b.expiresAt)?-1:1)[0];const timing=await operations.timing();
      if(renewalRequired(entity.expiresAt,timing)){writeStarted=true;return operations.renew(entity.entityKey);}
      return {entityKey:entity.entityKey,expiresAt:entity.expiresAt};
    }
    if(await operations.pending())throw new ReceiptError('ARKIV_WRITER_PENDING');
    try{writeStarted=true;return await operations.create(receipt);}catch(error){
      if(error instanceof ReceiptError)throw error;
      // Do not submit another create here after an ambiguous network result.
      // The next bounded job retry must query the exact public event first.
      throw new ReceiptError('ARKIV_WRITE_AMBIGUOUS');
    }})();
    try{return await Promise.race([task,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new ReceiptError(writeStarted?'ARKIV_WRITE_AMBIGUOUS':'ARKIV_PUBLICATION_TIMEOUT')),timeout);})]);}finally{clearTimeout(timer);}
  });
  queues.set(owner,work);try{return await work;}finally{if(queues.get(owner)===work)queues.delete(owner);}
}
