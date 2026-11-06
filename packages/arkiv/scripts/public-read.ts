import { mkdir, writeFile } from 'node:fs/promises';
import { arkivPublicClient, queryReceipts } from '../src/query.ts';
import { ARKIV_CHAIN_ID, ARKIV_PUBLIC_RPC, ARKIV_SCHEMA } from '../src/schema.ts';

const writer='0xAB5C7220E7d98D57181346d00D6E7957f42Af486';
const merchant='0x1A6d39216bcfCA2a93221aB2ed0e43f6561cf192';
const config={writer,arkivRpcUrl:ARKIV_PUBLIC_RPC} as const;
const client=arkivPublicClient(config);
const page=await queryReceipts({...config,merchant,pageSize:25});
const [timing,balance,chainId]=await Promise.all([client.getBlockTiming(),client.getBalance({address:writer}),client.getChainId()]);
if(chainId!==ARKIV_CHAIN_ID)throw new Error('Unexpected Arkiv network.');
const evidence={kind:'actual-public-Arkiv-SDK-read',checkedAt:new Date().toISOString(),sdk:'@arkiv-network/sdk@1.0.1',rpc:ARKIV_PUBLIC_RPC,chainId,schema:ARKIV_SCHEMA,writer,merchant,returnedRecords:page.entities.length,readAtBlock:page.readAtBlock,nextCursor:page.nextCursor,writerBalanceBaseUnits:balance.toString(),timing:{currentBlock:timing.currentBlock.toString(),currentBlockTime:timing.currentBlockTime,blockDuration:timing.blockDuration},gatewayHistoryApiUsed:false,privateCredentialUsed:false,signedWriteExecuted:false,query:'client.select().from(ReceiptSchema).ownedBy(writer).createdBy(writer).where(eq("merchant",addr(merchant))).orderBy(asc("$key")).limit(25).fetch()',limitation:'Actual public query/read only. Signed receipt writes, funded payments/refunds and source-range completeness are not established by an empty query.'};
await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/public-read.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
process.stdout.write(`Actual public Arkiv SDK query passed; ${page.entities.length} records. No signed write executed.\n`);
