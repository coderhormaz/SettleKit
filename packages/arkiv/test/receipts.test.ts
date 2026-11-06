import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiParameters, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { routerAbi } from '@settlekit/core/router';
import { accountingCsv, logicalEventId, parseReceipt, reconcileCoverage, scanCoverage, sourceEventId, summarizeVerified, TOKEN, verifyReceipt, type PublicReceipt, type ReceiptEntity, type SourceConfig, type SourceLog, type SourceReader } from '../src/index.ts';
import { publishReceipt, renewalRequired, type PublishDependencies } from '../src/server.ts';

const h=(letter:string)=>('0x'+letter.repeat(64))as Hex;
const a=(letter:string)=>('0x'+letter.repeat(40))as Address;
const writer=a('4');const router=a('3');const payer=a('1');const merchant=a('2');const code='0x60006000'as Hex;
const config:SourceConfig&{writer:Address}={writer,router,routerCodeHash:keccak256(code),deploymentBlock:'10'};
function fixture(){
  const invoiceId=h('a');const refundId=h('b');const evidence=h('c');const block10=h('d');const block11=h('e');const paymentTx=h('1');const refundTx=h('2');
  const paymentLog:SourceLog={address:router,transactionHash:paymentTx,blockHash:block10,blockNumber:10n,logIndex:0,topics:encodeEventTopics({abi:routerAbi,eventName:'PaymentAccepted',args:{invoiceId,payer,merchant}}) as Hex[],data:encodeAbiParameters(parseAbiParameters('address,uint256,bytes32,uint256,uint256'),[TOKEN,25_000_000n,evidence,1n,1700000100n])};
  const refundLog:SourceLog={address:router,transactionHash:refundTx,blockHash:block11,blockNumber:11n,logIndex:0,topics:encodeEventTopics({abi:routerAbi,eventName:'RefundExecuted',args:{refundId,invoiceId}}) as Hex[],data:encodeAbiParameters(parseAbiParameters('address,address,address,uint256,bytes32,uint256,uint256'),[payer,merchant,TOKEN,5_000_000n,evidence,1n,1700000100n])};
  const base={schemaVersion:1 as const,chainId:1874 as const,router,token:TOKEN,invoiceId,payer,merchant,logIndex:0};
  const paymentFields={...base,kind:'payment'as const,amountBaseUnits:'25000000',txHash:paymentTx,blockNumber:'10',blockHash:block10,sourceTimestamp:1700000010};
  const refundFields={...base,kind:'refund'as const,refundId,amountBaseUnits:'5000000',txHash:refundTx,blockNumber:'11',blockHash:block11,sourceTimestamp:1700000011};
  const payment=parseReceipt({...paymentFields,eventId:sourceEventId(paymentFields)});const refund=parseReceipt({...refundFields,eventId:sourceEventId(refundFields)});
  const blocks=new Map<bigint,{hash:Hex;timestamp:bigint}>([[10n,{hash:block10,timestamp:1700000010n}],[11n,{hash:block11,timestamp:1700000011n}]]);
  const logs=[paymentLog,refundLog];
  const reader:SourceReader={chainId:async()=>1874,head:async()=>12n,block:async block=>{const value=blocks.get(block);if(!value)throw new Error('fixture unavailable');return value;},code:async()=>code,token:async()=>TOKEN,receipt:async hash=>{const log=logs.find(log=>log.transactionHash===hash)!;return {status:'success',transactionHash:hash,blockNumber:log.blockNumber!,blockHash:log.blockHash!,logs:[log]};},logs:async(_router,kind,from,to)=>logs.filter(log=>log.blockNumber!>=from&&log.blockNumber!<=to&&((kind==='payment')===(log.transactionHash===paymentTx)))};
  const entity=(receipt:PublicReceipt,key=h('5')):ReceiptEntity=>({entityKey:key,owner:writer,creator:writer,expiresAt:'1000',readAtBlock:'100',receipt});
  return {payment,refund,reader,entity,blocks,logs};
}

describe('public settlement evidence verification',()=>{
  it('verifies real ABI payment/refund events then totals exact25/5/20 without duplicate money',async()=>{
    const f=fixture();const results=await Promise.all([verifyReceipt(f.entity(f.payment),config,f.reader),verifyReceipt(f.entity(f.refund,h('6')),config,f.reader),verifyReceipt(f.entity(f.payment,h('7')),config,f.reader)]);
    expect(results.every(result=>result.status==='verified')).toBe(true);
    const summary=summarizeVerified(results);expect(summary).toMatchObject({grossBaseUnits:'25000000',refundedBaseUnits:'5000000',netBaseUnits:'20000000',duplicateCount:1});
    const csv=accountingCsv(summary.records);expect(csv).toContain('"25000000"');expect(csv).toContain('"5000000"');expect(csv).not.toContain('merchant_order_id');
  });
  it('rejects copied schema from wrong owner/creator and expired entities before trusting value',async()=>{
    const f=fixture();expect(await verifyReceipt({...f.entity(f.payment),owner:a('9')},config,f.reader)).toMatchObject({status:'rejected',reason:'UNTRUSTED_WRITER'});
    expect(await verifyReceipt({...f.entity(f.payment),creator:a('9')},config,f.reader)).toMatchObject({status:'rejected',reason:'UNTRUSTED_WRITER'});
    expect(await verifyReceipt({...f.entity(f.payment),expiresAt:'99'},config,f.reader)).toMatchObject({status:'rejected',reason:'ENTITY_EXPIRED'});
  });
  it('rejects amount/parties/event/token/code/chain mismatches and exposes provider failure',async()=>{
    const f=fixture();expect(await verifyReceipt(f.entity({...f.payment,amountBaseUnits:'1'}),config,f.reader)).toMatchObject({status:'rejected',reason:'SOURCE_EVENT_MISMATCH'});
    expect(await verifyReceipt(f.entity({...f.payment,payer:a('8')}),config,f.reader)).toMatchObject({status:'rejected'});
    expect(await verifyReceipt(f.entity(f.payment),config,{...f.reader,code:async()=>h('0')})).toMatchObject({status:'rejected',reason:'SOURCE_ROUTER_MISMATCH'});
    expect(await verifyReceipt(f.entity(f.payment),config,{...f.reader,chainId:async()=>1})).toMatchObject({status:'rejected'});
    expect(await verifyReceipt(f.entity(f.payment),config,{...f.reader,receipt:async()=>{throw new Error('RPC unavailable');}})).toMatchObject({status:'unavailable',reason:'SOURCE_RPC_UNAVAILABLE'});
  });
  it('verifies before logical dedupe so an orphaned earlier version cannot suppress re-inclusion',async()=>{
    const f=fixture();f.blocks.set(10n,{hash:h('8'),timestamp:1700000010n});f.blocks.set(12n,{hash:h('9'),timestamp:1700000012n});
    const fields={...f.payment,blockNumber:'12',blockHash:h('9'),sourceTimestamp:1700000012};const canonical=parseReceipt({...fields,eventId:sourceEventId(fields)});
    f.logs[0]={...f.logs[0],blockNumber:12n,blockHash:h('9')};const reader={...f.reader,head:async()=>14n};
    expect(logicalEventId(canonical)).toBe(logicalEventId(f.payment));expect(canonical.eventId).not.toBe(f.payment.eventId);
    const results=await Promise.all([verifyReceipt(f.entity(f.payment),config,reader),verifyReceipt(f.entity(canonical,h('6')),config,reader)]);
    expect(results[0].status).toBe('rejected');expect(results[1].status).toBe('verified');expect(summarizeVerified(results).grossBaseUnits).toBe('25000000');
  });
  it('correction proves the old block is noncanonical and contributes zero money',async()=>{
    const f=fixture();f.blocks.set(10n,{hash:h('8'),timestamp:1700000010n});
    const fields={...f.payment,kind:'correction'as const,amountBaseUnits:'0'};const correction=parseReceipt({...fields,eventId:sourceEventId(fields)});
    const result=await verifyReceipt(f.entity(correction),config,f.reader);expect(result.status).toBe('verified');expect(summarizeVerified([result]).grossBaseUnits).toBe('0');
    expect(()=>parseReceipt({...correction,amountBaseUnits:'25000000'})).toThrow();
  });
  it('private/unexpected fields are refused and fabricated event identity cannot pass',()=>{
    const f=fixture();expect(()=>parseReceipt({...f.payment,email:'private@example.test'})).toThrow();expect(()=>parseReceipt({...f.payment,eventId:h('0')})).toThrow('SOURCE_EVENT_ID_MISMATCH');
  });
});

describe('bounded independent source-range reconciliation',()=>{
  it('keeps an anchored range across batches and finds absent/expired/unqueried receipts',async()=>{
    const f=fixture();const first=await scanCoverage(config,{merchant,fromBlock:'10',toBlock:'11',maxBlocks:1},f.reader);expect(first.complete).toBe(false);expect(first.events).toHaveLength(1);
    const second=await scanCoverage(config,{merchant,fromBlock:'10',toBlock:'11',maxBlocks:1,cursor:first.cursor},f.reader);expect(second.complete).toBe(true);
    const events=[...first.events,...second.events];expect(reconcileCoverage(events,[f.entity(f.payment)],true,true)).toMatchObject({complete:false,sourceEvents:2,missing:[f.refund]});
    expect(reconcileCoverage(events,[f.entity(f.payment),f.entity(f.refund)],true,false).complete).toBe(false);
    expect(reconcileCoverage(events,[f.entity(f.payment),f.entity(f.refund)],true,true).complete).toBe(true);
    expect(reconcileCoverage([], [f.entity(f.payment)],true,true)).toMatchObject({complete:false,unexpected:[logicalEventId(f.payment)]});
  });
  it('refuses a changed anchor rather than combining ranges across a reorg',async()=>{
    const f=fixture();const first=await scanCoverage(config,{merchant,fromBlock:'10',toBlock:'11',maxBlocks:1},f.reader);f.blocks.set(11n,{hash:h('7'),timestamp:1700000011n});
    await expect(scanCoverage(config,{merchant,fromBlock:'10',toBlock:'11',maxBlocks:1,cursor:first.cursor},f.reader)).rejects.toThrow('COVERAGE_ANCHOR_CHANGED');
  });
});

describe('query-first publication and explicit retention',()=>{
  const privateKey=generatePrivateKey();
  const publisher=privateKeyToAccount(privateKey).address.toLowerCase() as Address;
  const owned=(entity:ReceiptEntity)=>({...entity,owner:publisher,creator:publisher});
  function operations(receipt:PublicReceipt):PublishDependencies {
    const f=fixture();return {verify:vi.fn(async()=>undefined),find:vi.fn(async()=>[]),timing:vi.fn(async()=>({currentBlock:100n,blockDuration:2})),pending:vi.fn(async()=>false),create:vi.fn(async()=>({entityKey:h('5'),expiresAt:'4000000',transactionHash:h('6')})),renew:vi.fn(async key=>({entityKey:key,expiresAt:'5000000',transactionHash:h('7')}))};
  }
  it('recovers a successful write whose private mapping commit was lost without another create',async()=>{
    const f=fixture();const deps=operations(f.payment);deps.find=vi.fn(async()=>[{...owned(f.entity(f.payment)),expiresAt:'4000000'}]);
    await expect(publishReceipt(f.payment,{...config,privateKey},deps)).resolves.toMatchObject({entityKey:h('5'),expiresAt:'4000000'});expect(deps.create).not.toHaveBeenCalled();
  });
  it('does not create when another owner transaction is pending; ambiguous creates require query-first retry',async()=>{
    const f=fixture();const deps=operations(f.payment);deps.pending=vi.fn(async()=>true);await expect(publishReceipt(f.payment,{...config,privateKey},deps)).rejects.toThrow('ARKIV_WRITER_PENDING');expect(deps.create).not.toHaveBeenCalled();
    deps.pending=vi.fn(async()=>false);deps.create=vi.fn(async()=>{throw new Error('network acknowledgment lost');});await expect(publishReceipt(f.payment,{...config,privateKey},deps)).rejects.toThrow('ARKIV_WRITE_AMBIGUOUS');
    deps.find=vi.fn(async()=>[{...owned(f.entity(f.payment)),expiresAt:'4000000'}]);await expect(publishReceipt(f.payment,{...config,privateKey},deps)).resolves.toMatchObject({entityKey:h('5')});expect(deps.create).toHaveBeenCalledTimes(1);
  });
  it('renews when at or under14days and preserves block-based expiration',async()=>{
    expect(renewalRequired(String(100+14*86400/2),{currentBlock:100n,blockDuration:2})).toBe(true);
    const f=fixture();const deps=operations(f.payment);deps.find=vi.fn(async()=>[owned(f.entity(f.payment))]);const result=await publishReceipt(f.payment,{...config,privateKey},deps);expect(result.expiresAt).toBe('5000000');expect(deps.renew).toHaveBeenCalledWith(h('5'));expect(deps.create).not.toHaveBeenCalled();
  });
  it('refuses mismatched payload or writer identity at an existing version key',async()=>{
    const f=fixture();const deps=operations(f.payment);deps.find=vi.fn(async()=>[owned(f.entity({...f.payment,amountBaseUnits:'1'}))]);await expect(publishReceipt(f.payment,{...config,privateKey},deps)).rejects.toThrow('ARKIV_EVENT_PAYLOAD_CONFLICT');expect(deps.create).not.toHaveBeenCalled();
    deps.find=vi.fn(async()=>[f.entity(f.payment)]);await expect(publishReceipt(f.payment,{...config,privateKey},deps)).rejects.toThrow('ARKIV_UNTRUSTED_EXISTING_ENTITY');
  });
  it('bounds an ambiguous write wait and never starts a second create within that attempt',async()=>{
    const f=fixture();const deps=operations(f.payment);deps.create=vi.fn(()=>new Promise<never>(()=>undefined));
    await expect(publishReceipt(f.payment,{...config,privateKey,publicationTimeoutMs:60},deps)).rejects.toThrow('ARKIV_WRITE_AMBIGUOUS');expect(deps.create).toHaveBeenCalledTimes(1);
  });
});
