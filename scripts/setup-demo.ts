import { readFile,writeFile } from 'node:fs/promises';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { database, requestChallenge, verifyChallenge, updateMerchant } from '../packages/db/src/index.ts';
import { encryptSecret,hashToken,randomToken } from '../packages/core/src/server.ts';

// Operator-only local demo provisioning. Never reveals keys or logs sessions.
const envPath=new URL('../.env',import.meta.url);let env=await readFile(envPath,'utf8');
const keys=JSON.parse(await readFile(new URL('../data/phase-1-wallets.json',import.meta.url),'utf8')) as Record<string,{address:string;privateKey:Hex}>;
const config:Record<string,string>={
  PAYMENT_AUTHORIZER_PRIVATE_KEY:keys.quoteSigner.privateKey,
  POLICY_ADMIN_PRIVATE_KEY:keys.policyAdmin.privateKey,
  WHITECHAIN_DEPLOYER_PRIVATE_KEY:keys.deployer.privateKey,
  WHITECHAIN_POLICY_ADMIN:keys.policyAdmin.address,
  WHITECHAIN_AUTHORIZATION_SIGNER:keys.quoteSigner.address,
  POLICY_ADMIN_ADDRESS:keys.policyAdmin.address,
  AUTHORIZATION_SIGNER_ADDRESS:keys.quoteSigner.address,
  STORE_ORIGIN:process.env.STORE_ORIGIN??'http://127.0.0.1:3200',
  STORE_GATEWAY_API_KEY:process.env.STORE_GATEWAY_API_KEY||`sk_${randomToken()}`,
  STORE_WEBHOOK_SECRET:process.env.STORE_WEBHOOK_SECRET||randomToken(),
  STORE_ORDER_READ_KEY:process.env.STORE_ORDER_READ_KEY||randomToken(),
  RECOVERY_SERVICE_TOKEN:process.env.RECOVERY_SERVICE_TOKEN||randomToken(),
  STORE_DEVELOPMENT_FAILURE_TOKEN:process.env.STORE_DEVELOPMENT_FAILURE_TOKEN||randomToken(),
  CRE_MERCHANT_WALLET:keys.merchant.address,
  ARKIV_WRITER_PRIVATE_KEY:process.env.ARKIV_WRITER_PRIVATE_KEY||keys.arkivWriter.privateKey,
  ARKIV_PUBLIC_WRITER_ADDRESS:privateKeyToAccount((process.env.ARKIV_WRITER_PRIVATE_KEY||keys.arkivWriter.privateKey) as Hex).address,
};
const db=database();
try{
  const account=privateKeyToAccount(keys.merchant.privateKey);const browserToken=randomToken();
  const challenge=await requestChallenge(db,{address:account.address,browserToken,purpose:'login'});
  const identity=await verifyChallenge(db,{id:challenge.id,signature:await account.signMessage({message:challenge.message}),browserToken,purpose:'login'});
  const merchantId=identity.merchantId;config.DEMO_MERCHANT_ID=merchantId;
  await updateMerchant(db,merchantId,{displayName:'Fieldwork Studio',websiteOrigin:config.STORE_ORIGIN});
  await db.pool.query('insert into merchant_integrations(merchant_id,key_hash,webhook_url,order_api_url,webhook_secret,order_read_secret) values($1,$2,$3,$4,$5,$6) on conflict(merchant_id) do update set key_hash=excluded.key_hash,webhook_url=excluded.webhook_url,order_api_url=excluded.order_api_url,webhook_secret=excluded.webhook_secret,order_read_secret=excluded.order_read_secret,active=true',[merchantId,hashToken(config.STORE_GATEWAY_API_KEY),`${config.STORE_ORIGIN}/api/webhooks/settlekit`,`${config.STORE_ORIGIN}/api/orders`,encryptSecret(config.STORE_WEBHOOK_SECRET,process.env.DATA_ENCRYPTION_KEY!,`webhook:${merchantId}`),encryptSecret(config.STORE_ORDER_READ_KEY,process.env.DATA_ENCRYPTION_KEY!,`orders:${merchantId}`)]);
  for(const [key,value]of Object.entries(config)){const pattern=new RegExp(`^${key}=.*$`,'m');env=pattern.test(env)?env.replace(pattern,()=>`${key}=${value}`):`${env.trimEnd()}\n${key}=${value}\n`;}
  await writeFile(envPath,env);process.stdout.write('Demo merchant and encrypted server integration configured; private credentials saved locally.\n');
}finally{await db.pool.end();}
