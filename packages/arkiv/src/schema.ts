import { defineSchema, addr, i32, key, str, u64, u256 } from '@arkiv-network/sdk/schema';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { z } from 'zod';

export const ARKIV_SCHEMA='settlekit.receipt.v1';
export const ARKIV_CHAIN_ID=7794095;
export const ARKIV_PUBLIC_RPC='https://rpc.rabdi.db-chain.testnet.arkiv.network';
export const WHITECHAIN_PUBLIC_RPC='https://rpc.testnet.whitechain.io';
export const RECEIPT_RETENTION_DAYS=90;
export const RENEW_THRESHOLD_DAYS=14;
export const TOKEN='0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7' as Address;
export class ReceiptError extends Error {constructor(readonly code:string){super(code);}}
const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value=>value.toLowerCase() as Address);
const hash=z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value=>value.toLowerCase() as Hex);
const uint=z.string().regex(/^(0|[1-9]\d{0,77})$/).refine(value=>BigInt(value)<2n**256n);
const u64String=z.string().regex(/^(0|[1-9]\d{0,19})$/).refine(value=>BigInt(value)<2n**64n);
export const publicReceiptSchema=z.object({
  schemaVersion:z.literal(1),eventId:hash,kind:z.enum(['payment','refund','correction']),chainId:z.literal(1874),
  router:address,token:address.refine(value=>value===TOKEN),invoiceId:hash,refundId:hash.optional(),payer:address,merchant:address,
  amountBaseUnits:uint,txHash:hash,logIndex:z.number().int().nonnegative().max(2**31-1),blockNumber:u64String,blockHash:hash,
  sourceTimestamp:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value,context)=>{
  if(value.kind==='refund'&&!value.refundId)context.addIssue({code:'custom',message:'Refund evidence requires refundId.'});
  if(value.kind==='payment'&&value.refundId)context.addIssue({code:'custom',message:'Payment evidence cannot carry refundId.'});
  if((value.kind==='correction')!==(value.amountBaseUnits==='0'))context.addIssue({code:'custom',message:'Only corrections have zero amount.'});
});
export type PublicReceipt=z.infer<typeof publicReceiptSchema>;
export type ReceiptInput=Omit<PublicReceipt,'eventId'>;
export function sourceEventId(receipt:Pick<PublicReceipt,'chainId'|'router'|'txHash'|'logIndex'|'kind'|'blockHash'|'sourceTimestamp'>):Hex {
  return keccak256(toHex(JSON.stringify([receipt.chainId,receipt.router.toLowerCase(),receipt.txHash.toLowerCase(),receipt.logIndex,receipt.kind,receipt.blockHash.toLowerCase(),receipt.sourceTimestamp])));
}
export function logicalEventId(receipt:Pick<PublicReceipt,'chainId'|'router'|'txHash'|'logIndex'|'kind'>):Hex {
  return keccak256(toHex(JSON.stringify([receipt.chainId,receipt.router.toLowerCase(),receipt.txHash.toLowerCase(),receipt.logIndex,receipt.kind])));
}
export function parseReceipt(value:unknown):PublicReceipt {
  const receipt=publicReceiptSchema.parse(value);
  if(receipt.eventId!==sourceEventId(receipt))throw new ReceiptError('SOURCE_EVENT_ID_MISMATCH');return receipt;
}
export const ReceiptSchema=defineSchema(ARKIV_SCHEMA,{
  schemaVersion:i32(),eventId:key().indexed(),kind:str().indexed(),chainId:i32().indexed(),router:addr().indexed(),token:addr(),
  invoiceId:key(),refundId:key().optional(),payer:addr(),merchant:addr().indexed(),amountBaseUnits:u256(),txHash:key(),logIndex:i32(),
  blockNumber:u64().indexed(),blockHash:key(),sourceTimestamp:u64().indexed(),
});
export interface ReceiptEntity {entityKey:Hex;owner:Address;creator:Address;expiresAt:string;readAtBlock:string;receipt:PublicReceipt}
export interface PublicQueryConfig {writer:Address;arkivRpcUrl?:string;deadline?:number}
export interface SourceConfig {router:Address;routerCodeHash:Hex;deploymentBlock:string;whitechainRpcUrl?:string}
export function validateSourceConfig(config:SourceConfig):SourceConfig {
  return {router:address.parse(config.router),routerCodeHash:hash.parse(config.routerCodeHash),deploymentBlock:u64String.parse(config.deploymentBlock),whitechainRpcUrl:config.whitechainRpcUrl??WHITECHAIN_PUBLIC_RPC};
}
export const receiptValues=(receipt:PublicReceipt)=>({schemaVersion:i32(receipt.schemaVersion),eventId:key(receipt.eventId),kind:str(receipt.kind),chainId:i32(receipt.chainId),router:addr(receipt.router),token:addr(receipt.token),invoiceId:key(receipt.invoiceId),...(receipt.refundId?{refundId:key(receipt.refundId)}:{}),payer:addr(receipt.payer),merchant:addr(receipt.merchant),amountBaseUnits:u256(receipt.amountBaseUnits),txHash:key(receipt.txHash),logIndex:i32(receipt.logIndex),blockNumber:u64(receipt.blockNumber),blockHash:key(receipt.blockHash),sourceTimestamp:u64(receipt.sourceTimestamp)});
