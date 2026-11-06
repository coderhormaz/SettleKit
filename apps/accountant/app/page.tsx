import { Accountant, type ViewerConfig } from './viewer.tsx';
import { ARKIV_PUBLIC_RPC, WHITECHAIN_PUBLIC_RPC } from '@settlekit/arkiv';
import type { Address, Hex } from 'viem';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  // This whitelist contains public deployment metadata only. Private operator
  // RPC URLs/access keys, database URLs and writer keys never reach the client.
  const router=process.env.WHITECHAIN_ROUTER_ADDRESS;const codeHash=process.env.WHITECHAIN_ROUTER_CODE_HASH;const deploymentBlock=process.env.WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK;
  const writer=process.env.ARKIV_PUBLIC_WRITER_ADDRESS??'0xAB5C7220E7d98D57181346d00D6E7957f42Af486';
  const requested=(await searchParams).merchant;const merchant=typeof requested==='string'&&/^0x[0-9a-f]{40}$/i.test(requested)?requested:'0x1A6d39216bcfCA2a93221aB2ed0e43f6561cf192';
  const config:ViewerConfig={writer:(/^0x[0-9a-f]{40}$/i.test(writer)?writer:'0xAB5C7220E7d98D57181346d00D6E7957f42Af486') as Address,arkivRpcUrl:ARKIV_PUBLIC_RPC,defaultMerchant:merchant as Address,source:router&&/^0x[0-9a-f]{40}$/i.test(router)&&codeHash&&/^0x[0-9a-f]{64}$/i.test(codeHash)&&deploymentBlock&&/^\d+$/.test(deploymentBlock)?{router:router as Address,routerCodeHash:codeHash as Hex,deploymentBlock,whitechainRpcUrl:WHITECHAIN_PUBLIC_RPC}:null};
  return <Accountant config={config}/>;
}
