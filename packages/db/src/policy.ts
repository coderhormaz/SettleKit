import { createPublicClient, http, keccak256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainSepolia } from 'viem/chains';
import { AppError, addressSchema, USDT_ADDRESS } from '@settlekit/core';
import { routerAbi } from '@settlekit/core/router';
import { evaluateWallet, OFAC_SOURCE_ID, type SourceSnapshot, type ProviderHealth } from '@settlekit/screening';
import { runtimeConfig } from '@settlekit/core/server';
import type { Database } from './client.ts';

export function chainClient() { return createPublicClient({chain:whitechainSepolia,transport:http(runtimeConfig().rpc,{timeout:8000,retryCount:0})}); }
export function routerConfiguration() {
  const router=process.env.WHITECHAIN_ROUTER_ADDRESS;
  const codeHash=process.env.WHITECHAIN_ROUTER_CODE_HASH;
  if(!router||!/^0x[0-9a-f]{64}$/i.test(codeHash??'')||!/^\d+$/.test(process.env.WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK??''))throw new AppError('PAYMENTS_UNAVAILABLE',503,'Payments are awaiting a verified testnet deployment. Please return later.');
  return {router:addressSchema.parse(router) as Address,codeHash:codeHash as Hex,deploymentBlock:BigInt(process.env.WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK!)};
}
export async function sourceState(db:Database) {
  const result=await db.pool.query<{snapshot:SourceSnapshot|null;health:ProviderHealth}>('select snapshot,health from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);
  const row=result.rows[0];
  return {snapshot:row?.snapshot??null,health:row?.health??{state:'unavailable' as const,checkedAt:new Date().toISOString()}};
}
export function policyCommitment(snapshot:SourceSnapshot):Hex { return keccak256(toHex(JSON.stringify({version:'direct-list-v1',hash:snapshot.sha256,fetchedAt:snapshot.fetchedAt,coverage:snapshot.coverage.policy}))); }
export interface CheckedPolicy {router:Address;epoch:bigint;validUntil:bigint;commitment:Hex;sourceHash:string;sourceFetchedAt:string;expiresAt:number;checkedAt:number}
export async function checkPaymentPolicy(db:Database,parties:string[]):Promise<CheckedPolicy> {
  const config=routerConfiguration();const client=chainClient();const source=await sourceState(db);
  const decisions=parties.map(address=>evaluateWallet({address,snapshot:source.snapshot,providerHealth:source.health}));
  if(decisions.some(d=>d.state!=='allowed')||!source.snapshot)throw new AppError('SCREENING_DENIED',409,'Required wallet checks did not pass. Payment is paused; retry after the checks are current.');
  const key=process.env.PAYMENT_AUTHORIZER_PRIVATE_KEY;
  if(!key||!/^0x[0-9a-f]{64}$/i.test(key))throw new AppError('PAYMENTS_UNAVAILABLE',503,'Payments are temporarily unavailable.');
  const anchor=await client.getBlock({blockTag:'latest'});
  if(anchor.number===null||anchor.hash===null)throw new AppError('POLICY_UNCONFIRMED',503,'Current payment checks are not confirmed. Please retry later.');
  const read=<N extends 'token'|'authorizationSigner'|'policyEpoch'|'policyValidUntil'|'policyCommitment'|'paused'>(functionName:N)=>client.readContract({address:config.router,abi:routerAbi,functionName,blockNumber:anchor.number!});
  const [chainId,code,token,signer,epoch,validUntil,commitment,paused,...denials]=await Promise.all([client.getChainId(),client.getCode({address:config.router,blockNumber:anchor.number}),read('token'),read('authorizationSigner'),read('policyEpoch'),read('policyValidUntil'),read('policyCommitment'),read('paused'),...parties.map(address=>client.readContract({address:config.router,abi:routerAbi,functionName:'denied',args:[address as Address],blockNumber:anchor.number!}))]);
  const canonical=await client.getBlock({blockNumber:anchor.number});
  const checkedAt=Date.now();
  if(canonical.hash!==anchor.hash||chainId!==1874||!code||keccak256(code).toLowerCase()!==config.codeHash.toLowerCase()||String(token).toLowerCase()!==USDT_ADDRESS.toLowerCase()||String(signer).toLowerCase()!==privateKeyToAccount(key as Hex).address.toLowerCase()||paused||denials.some(Boolean)||commitment!==policyCommitment(source.snapshot)||BigInt(validUntil as bigint)*1000n<=BigInt(checkedAt+5000))throw new AppError('POLICY_UNCONFIRMED',503,'Current payment checks are not confirmed. Please retry later.');
  return {router:config.router,epoch:BigInt(epoch as bigint),validUntil:BigInt(validUntil as bigint),commitment:commitment as Hex,sourceHash:source.snapshot.sha256,sourceFetchedAt:source.snapshot.fetchedAt,expiresAt:Math.min(...decisions.map(d=>Date.parse(d.expiresAt)),Number(validUntil)*1000),checkedAt};
}
