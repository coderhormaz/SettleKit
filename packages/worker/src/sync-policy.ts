import { createWalletClient,http,type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainSepolia } from 'viem/chains';
import { routerAbi } from '@settlekit/core/router';
import { runtimeConfig } from '@settlekit/core/server';
import { evaluateWallet } from '@settlekit/screening';
import { chainClient,database,policyCommitment,routerConfiguration,sourceState } from '@settlekit/db';

// Protected operator command. Merchant cookies never reach this signer.
async function sync(){
  const db=database();
  try{
    const config=routerConfiguration();const client=chainClient();const source=await sourceState(db);
    const probe=evaluateWallet({address:'0x0000000000000000000000000000000000000001',snapshot:source.snapshot,providerHealth:source.health});
    if(!source.snapshot||!['allowed','blocked'].includes(probe.state))throw new Error('SOURCE_NOT_CURRENT');
    const rawKey=process.env.POLICY_ADMIN_PRIVATE_KEY;if(!/^0x[0-9a-f]{64}$/i.test(rawKey??''))throw new Error('POLICY_KEY_REQUIRED');
    const account=privateKeyToAccount(rawKey as Hex);
    if(await client.getChainId()!==1874||(await client.readContract({address:config.router,abi:routerAbi,functionName:'owner'})).toLowerCase()!==account.address.toLowerCase())throw new Error('POLICY_ADMIN_MISMATCH');
    const epoch=await client.readContract({address:config.router,abi:routerAbi,functionName:'policyEpoch'});
    const validUntil=BigInt(Math.floor(Math.min(Date.parse(source.snapshot.fetchedAt)+7_200_000,Date.now()+7_100_000)/1000));
    const wallets=[...new Set(source.snapshot.addresses)].filter(a=>a!=='0x0000000000000000000000000000000000000000') as Hex[];
    if(wallets.length>512)throw new Error('POLICY_TOO_LARGE_REQUIRES_PAUSED_BATCH');
    const commitment=policyCommitment(source.snapshot);
    if(!process.argv.includes('--broadcast')){process.stdout.write(JSON.stringify({kind:'policy-sync-preflight',chainId:1874,router:config.router,nextEpoch:(epoch+1n).toString(),validUntil:validUntil.toString(),commitment,denials:wallets.length,broadcast:false})+'\n');return;}
    const wallet=createWalletClient({chain:whitechainSepolia,account,transport:http(runtimeConfig().rpc)});
    const {request}=await client.simulateContract({address:config.router,abi:routerAbi,functionName:'syncPolicy',args:[epoch+1n,validUntil,commitment,wallets,wallets.map(()=>true)],account});
    const hash=await wallet.writeContract(request);const receipt=await client.waitForTransactionReceipt({hash,confirmations:2});if(receipt.status!=='success')throw new Error('POLICY_SYNC_FAILED');
    process.stdout.write(JSON.stringify({kind:'confirmed-policy-sync',transactionHash:hash,blockNumber:receipt.blockNumber.toString(),epoch:(epoch+1n).toString(),commitment})+'\n');
    // Removed list entries are deliberately retained as hard denials until explicit reviewed operator release.
  }finally{await db.pool.end();}
}
try{await sync();}catch{process.stderr.write('POLICY_SYNC_UNAVAILABLE\n');process.exitCode=1;}
