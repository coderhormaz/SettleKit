import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const token=process.env.RECOVERY_SERVICE_TOKEN,orderToken=process.env.STORE_ORDER_READ_KEY;
if(!token||!/^[a-f0-9]{64}$/.test(token)||!orderToken||orderToken.length<32)throw new Error('Private recovery and merchant order credentials are required in .env.');
const router=process.env.WHITECHAIN_ROUTER_ADDRESS,codeHash=process.env.WHITECHAIN_ROUTER_CODE_HASH,block=process.env.WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK,merchant=process.env.CRE_MERCHANT_WALLET??process.env.WHITECHAIN_MERCHANT_WALLET;
if(!/^0x[0-9a-f]{40}$/i.test(router??'')||!/^0x[0-9a-f]{64}$/i.test(codeHash??'')||!/^\d+$/.test(block??'')||!/^0x[0-9a-f]{40}$/i.test(merchant??''))throw new Error('A verified source deployment and configured merchant are required.');
const gateway=new URL(process.env.APP_ORIGIN??'http://127.0.0.1:3000');const store=new URL(process.env.STORE_ORIGIN??'http://127.0.0.1:3200');
const config={schedule:'*/30 * * * * *',gatewayOrigin:gateway.origin,merchantApiBase:`${store.origin}/api/orders`,merchantWallet:merchant,whitechainRpcUrl:process.env.WHITECHAIN_RPC_URL??'https://rpc.testnet.whitechain.io',router,routerCodeHash:codeHash,deploymentBlock:block,localSimulation:gateway.protocol==='http:'};
await mkdir(resolve(root,'data'),{recursive:true});await writeFile(resolve(root,'data/cre-recovery.config.json'),JSON.stringify(config,null,2)+'\n');
let env=await readFile(resolve(root,'data/cre-simulation.env'),'utf8');
for(const [name,value]of Object.entries({CRE_RECOVERY_SERVICE_TOKEN:token,CRE_STORE_ORDER_READ_KEY:orderToken})){const pattern=new RegExp(`^${name}=.*$`,'m');env=pattern.test(env)?env.replace(pattern,()=>`${name}=${value}`):`${env.trimEnd()}\n${name}=${value}\n`;}
await writeFile(resolve(root,'data/cre-recovery.env'),env,{mode:0o600});process.stdout.write('Prepared private recovery configuration and secret environment. No credentials emitted.\n');
