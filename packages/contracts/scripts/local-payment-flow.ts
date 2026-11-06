/**
 * Explicit local EDR/mock-token + real isolated Neon/production HTTP integration.
 * Run from repo root: node --env-file=.env --import tsx packages/contracts/scripts/local-payment-flow.ts
 * Add --refunds --collections for the Phase 4 refund/public-verifier and
 * separate no-adapter internal-collection scenarios. Those flags also write
 * docs/evidence/phase-4/local-refund-flow.json; Arkiv metadata stays a fixture.
 * Never a Whitechain deployment/payment or sponsor-eligibility claim.
 */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, keccak256, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createDatabase, completeJob, policyCommitment, transaction, type ClaimedJob, type Database } from '../../db/src/index.ts';
import { observePayments, deliverPayment } from '../../worker/src/payments.ts';
import { encryptSecret, hashToken, randomToken } from '../../core/src/server.ts';
import { USDT_ADDRESS } from '../../core/src/index.ts';
import { routerAbi, type PaymentAuthorization, type RefundAuthorization } from '../../core/src/router.ts';
import { OFAC_SDN_URL, OFAC_SOURCE_ID, SCREENING_COVERAGE, type SourceSnapshot } from '../../screening/src/index.ts';
import { createStoreDatabase } from '../../../examples/store/src/store.ts';
import {cleanupTestMerchants} from '../../db/test/cleanup.ts';
import { accountingCsv,parseReceipt,summarizeVerified,verifyReceipt,type ReceiptEntity } from '../../arkiv/src/index.ts';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const script=fileURLToPath(import.meta.url);
const require=createRequire(import.meta.url);
const gatewayOrigin='http://127.0.0.1:3500';
const storeOrigin='http://127.0.0.1:3501';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function claimOwnDelivery(db:Database,merchantId:string,deliveryId:string):Promise<ClaimedJob>{
  return transaction(db,async sql=>{
    const result=await sql.query<ClaimedJob>(`update outbox_jobs set status='processing',attempts=attempts+1,lease_token=$1,lease_until=clock_timestamp()+interval '60 seconds' where id=(select id from outbox_jobs where merchant_id=$2 and kind='payment.webhook' and payload->>'deliveryId'=$3 and ((status='pending' and available_at<=clock_timestamp()) or (status='processing' and lease_until<clock_timestamp())) and attempts<max_attempts for update skip locked limit 1) returning id,merchant_id,kind,payload,lease_token,attempts,max_attempts`,[randomUUID(),merchantId,deliveryId]);
    assert.ok(result.rows[0],'The harness own delivery must be claimable.');return result.rows[0];
  });
}
async function workerOnce(mode:string){
  assert.equal(process.env.LOCAL_PAYMENT_FLOW,'explicit-edr-mock-token');
  assert.equal(process.env.TEST_DATABASE_ISOLATED,'true');
  assert.equal(process.env.DATABASE_URL,process.env.TEST_DATABASE_URL);
  const db=createDatabase(process.env.TEST_DATABASE_URL!);
  try{
    if(mode==='--worker-observe')await observePayments(db);
    else{
      const job=await claimOwnDelivery(db,process.env.HARNESS_MERCHANT_ID!,process.env.HARNESS_DELIVERY_ID!);
      await deliverPayment(db,job);
      // Simulate a real worker process dying after remote acknowledgment but
      // before marking its outbox lease complete; the next process retries.
      if(mode!=='--worker-deliver-noack')assert.equal(await completeJob(db,job),true);
    }
  }finally{await db.pool.end();}
}

function childProcess(args:string[],env:NodeJS.ProcessEnv,cwd=root){
  const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  // Child output can contain opaque session/API material if a dependency fails.
  // Keep it private; the harness reports bounded stage/error codes only.
  child.stdout?.resume();child.stderr?.resume();return child;
}
async function stopChild(child:ChildProcess){
  if(child.exitCode!==null)return;
  const exited=once(child,'exit');child.kill();await Promise.race([exited,delay(5000)]);
  if(child.exitCode===null)child.kill('SIGKILL');
}
async function runChild(args:string[],env:NodeJS.ProcessEnv){
  const child=childProcess(args,env);const timer=setTimeout(()=>child.kill('SIGKILL'),45_000);
  try{const [code]=await once(child,'exit');assert.equal(code,0,'The isolated harness worker must exit successfully.');}finally{clearTimeout(timer);}
}
async function waitReady(url:string,child:ChildProcess){
  for(let n=0;n<50;n++){
    assert.equal(child.exitCode,null,'A child service exited before readiness.');
    try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});if(response.ok)return;}catch{/* Bounded local startup polling. */}
    await delay(300);
  }
  throw new Error('LOCAL_SERVICE_NOT_READY');
}
interface JsonResponse {status:number;value:Record<string,unknown>;cookie:string}
async function json(url:string,method='GET',payload?:unknown,headers:Record<string,string>={}):Promise<JsonResponse>{
  const response=await fetch(url,{method,headers:{...(payload===undefined?{}:{'Content-Type':'application/json'}),...headers},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(20_000)});
  return {status:response.status,value:await response.json() as Record<string,unknown>,cookie:response.headers.getSetCookie().map(cookie=>cookie.split(';')[0]).join('; ')};
}
function expectStatus(result:JsonResponse,status:number){
  const error=result.value.error as {code?:unknown}|undefined;
  assert.equal(result.status,status,`HTTP status mismatch (${typeof error?.code==='string'?error.code:'NO_PUBLIC_CODE'}).`);
}

async function main(){
  const includeRefunds=process.argv.includes('--refunds');const includeCollections=process.argv.includes('--collections');
  assert.equal(process.env.TEST_DATABASE_ISOLATED,'true','Explicit isolated test configuration is mandatory.');
  const gatewayUrl=process.env.TEST_DATABASE_URL;const storeUrl=process.env.TEST_STORE_DATABASE_URL;
  assert.ok(gatewayUrl&&storeUrl&&gatewayUrl!==process.env.DATABASE_URL&&storeUrl!==process.env.STORE_DATABASE_URL,'Separate isolated runtime databases are mandatory.');
  const db=createDatabase(gatewayUrl,4);const storeDb=createStoreDatabase(storeUrl);
  const childServices:ChildProcess[]=[];let rpcServer:Server|undefined;
  let connection:{close():Promise<void>}|undefined;let merchantId:string|undefined;let routerAddress:string|undefined;
  const loginChallenges:string[]=[];
  const testMerchantIds:string[]=[];
  let oldSource:Record<string,unknown>|undefined;let sourceReplaced=false;const orderIds:string[]=[];
  const environmentBackup={...process.env};let stage='INITIALIZE';
  const evidence:Record<string,unknown>={kind:'local-EDR-mock-USDT-actual-isolated-Neon-and-production-HTTP',liveWhitechain:false,mockToken:true,fixtureScreeningSource:true,status:'running'};
  const refundEvidence:Record<string,unknown>={kind:'local-EDR-mock-token-refund-and-explicit-public-entity-fixtures',liveWhitechain:false,actualArkivWrite:false,mockToken:true,fixtureScreeningSource:true,chainId:1874,tokenAddress:USDT_ADDRESS,status:'not_requested'};
  try{
    stage='LOCAL_EDR';process.chdir(resolve(root,'packages/contracts'));
    const hre=(await import('hardhat')).default;
    const network=await hre.network.create('localIntegration');connection=network;
    const client=await network.viem.getPublicClient();const [admin]=await network.viem.getWalletClients();
    const signerKey=generatePrivateKey();const signer=privateKeyToAccount(signerKey);
    const payer=privateKeyToAccount(generatePrivateKey());const merchant=privateKeyToAccount(generatePrivateKey());
    assert.equal(await client.getChainId(),1874);
    const localMock=await network.viem.deployContract('MockUsdt');
    const runtime=await client.getCode({address:localMock.address});assert.ok(runtime);
    await network.provider.request({method:'hardhat_setCode',params:[USDT_ADDRESS,runtime]});
    await network.provider.request({method:'hardhat_setBalance',params:[payer.address,'0x56bc75e2d63100000']});
    await network.provider.request({method:'hardhat_setBalance',params:[merchant.address,'0x56bc75e2d63100000']});
    const router=await network.viem.deployContract('SettleKitRouter',[USDT_ADDRESS,admin.account.address,signer.address]);
    routerAddress=router.address.toLowerCase();const deploymentBlock=await client.getBlockNumber();
    const code=await client.getCode({address:router.address});assert.ok(code);
    const tokenArtifact=await hre.artifacts.readArtifact('MockUsdt');
    await admin.writeContract({address:USDT_ADDRESS,abi:tokenArtifact.abi,functionName:'mint',args:[payer.address,100_000_000n]});

    // Only this ephemeral loopback server sees the EDR provider. It never
    // forwards any JSON-RPC request to a real network.
    rpcServer=createServer(async(req,res)=>{
      try{
        if(req.method!=='POST'){res.writeHead(405);res.end();return;}
        let raw='';for await(const part of req){raw+=part.toString();if(Buffer.byteLength(raw)>1_048_576){res.writeHead(413);res.end();return;}}
        const input=JSON.parse(raw) as {id:unknown;method:string;params?:unknown[]}|{id:unknown;method:string;params?:unknown[]}[];
        const handle=async(request:{id:unknown;method:string;params?:unknown[]})=>{
          try{return {jsonrpc:'2.0',id:request.id,result:await network.provider.request({method:request.method,params:request.params??[]})};}
          catch{return {jsonrpc:'2.0',id:request.id,error:{code:-32000,message:'LOCAL_EDR_REQUEST_FAILED'}};}
        };
        const result=Array.isArray(input)?await Promise.all(input.map(handle)):await handle(input);
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
      }catch{res.writeHead(400);res.end();}
    });
    rpcServer.requestTimeout=10_000;rpcServer.headersTimeout=10_000;
    await new Promise<void>(resolve=>rpcServer!.listen(0,'127.0.0.1',resolve));
    const rpcAddress=rpcServer.address();assert.ok(rpcAddress&&typeof rpcAddress!=='string');
    const rpc=`http://127.0.0.1:${rpcAddress.port}`;
    const chain=defineChain({id:1874,name:'Explicit local EDR mock-token integration',nativeCurrency:{name:'Local test gas',symbol:'TEST',decimals:18},rpcUrls:{default:{http:[rpc]}},testnet:true});
    const payerClient=createWalletClient({account:payer,chain,transport:http(rpc,{retryCount:0})});
    const publicClient=createPublicClient({chain,transport:http(rpc,{retryCount:0})});

    stage='ISOLATED_SOURCE_FIXTURE';
    oldSource=(await db.pool.query('select * from screening_sources where source_id=$1',[OFAC_SOURCE_ID])).rows[0];
    const snapshot:SourceSnapshot={sourceId:OFAC_SOURCE_ID,sourceUrl:OFAC_SDN_URL,sha256:createHash('sha256').update('EXPLICIT LOCAL SCREENING FIXTURE '+randomUUID()).digest('hex'),fetchedAt:new Date().toISOString(),publishedAt:new Date(Date.now()-60_000).toISOString(),coverage:{...SCREENING_COVERAGE},addresses:['0x8888888888888888888888888888888888888888'],entryCount:1,recordCount:1};
    await db.pool.query('insert into screening_sources(source_id,snapshot,health,fetched_at) values($1,$2,$3,$4) on conflict(source_id) do update set snapshot=excluded.snapshot,health=excluded.health,fetched_at=excluded.fetched_at,updated_at=now()',[OFAC_SOURCE_ID,JSON.stringify(snapshot),JSON.stringify({state:'available',checkedAt:snapshot.fetchedAt}),snapshot.fetchedAt]);sourceReplaced=true;
    const block=await client.getBlock();await router.write.syncPolicy([1n,block.timestamp+3600n,policyCommitment(snapshot),[],[]]);

    const apiKey=`sk_${randomToken()}`;const webhookSecret=randomToken();const orderReadKey=randomToken();
    const encryptionKey=process.env.DATA_ENCRYPTION_KEY||randomToken();
    const env:NodeJS.ProcessEnv={...process.env,LOCAL_PAYMENT_FLOW:'explicit-edr-mock-token',DATABASE_URL:gatewayUrl,STORE_DATABASE_URL:storeUrl,APP_ORIGIN:gatewayOrigin,STORE_ORIGIN:storeOrigin,STORE_PORT:'3501',ALLOW_LOCAL_HTTP:'true',WHITECHAIN_RPC_URL:rpc,WHITECHAIN_ROUTER_ADDRESS:router.address,WHITECHAIN_ROUTER_CODE_HASH:keccak256(code),WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK:deploymentBlock.toString(),PAYMENT_AUTHORIZER_PRIVATE_KEY:signerKey,DATA_ENCRYPTION_KEY:encryptionKey,STORE_GATEWAY_API_KEY:apiKey,STORE_WEBHOOK_SECRET:webhookSecret,STORE_ORDER_READ_KEY:orderReadKey};
    Object.assign(process.env,env);
    stage='PRODUCTION_HTTP_START';
    const next=require.resolve('next/dist/bin/next',{paths:[resolve(root,'apps/gateway')]});
    const gateway=childProcess([next,'start','--hostname','127.0.0.1','--port','3500'],env,resolve(root,'apps/gateway'));childServices.push(gateway);
    const store=childProcess(['--import','tsx',resolve(root,'examples/store/src/server.ts')],env);childServices.push(store);
    await Promise.all([waitReady(gatewayOrigin,gateway),waitReady(storeOrigin,store)]);

    stage='MERCHANT_HTTP_SIWE';
    const challenge=await json(`${gatewayOrigin}/api/auth/challenge`,'POST',{address:merchant.address},{Origin:gatewayOrigin});expectStatus(challenge,200);
    loginChallenges.push(String(challenge.value.id));
    const login=await json(`${gatewayOrigin}/api/auth/verify`,'POST',{id:challenge.value.id,signature:await merchant.signMessage({message:String(challenge.value.message)})},{Origin:gatewayOrigin,Cookie:challenge.cookie});expectStatus(login,200);
    merchantId=(login.value.merchant as {id:string}).id;
    testMerchantIds.push(merchantId);
    const profile=await json(`${gatewayOrigin}/api/merchant`,'PATCH',{displayName:'Explicit local integration merchant',websiteOrigin:storeOrigin},{Origin:gatewayOrigin,Cookie:login.cookie});expectStatus(profile,200);
    await db.pool.query('insert into merchant_integrations(merchant_id,key_hash,webhook_url,order_api_url,webhook_secret,order_read_secret) values($1,$2,$3,$4,$5,$6)',[merchantId,hashToken(apiKey),`${storeOrigin}/api/webhooks/settlekit`,`${storeOrigin}/api/orders`,encryptSecret(webhookSecret,encryptionKey,`webhook:${merchantId}`),encryptSecret(orderReadKey,encryptionKey,`orders:${merchantId}`)]);

    stage='ACTUAL_STORE_CHECKOUT';
    const order=await json(`${storeOrigin}/api/orders`,'POST',{amount_base_units:'1'},{Origin:storeOrigin});
    if(typeof order.value.id==='string'&&/^[0-9a-f-]{36}$/.test(order.value.id))orderIds.push(order.value.id);
    expectStatus(order,201);
    const orderId=String(order.value.id);const reference=String(order.value.reference);
    assert.equal(order.value.amount_base_units,'25000000');
    const stored=(await storeDb.query('select state,fulfillment_count from store_orders where id=$1',[orderId])).rows[0];assert.equal(stored.fulfillment_count,0);

    stage='PAYER_HTTP_SIWE_AND_AUTHORIZATION';
    const payerChallenge=await json(`${gatewayOrigin}/api/checkout/${reference}/challenge`,'POST',{address:payer.address},{Origin:gatewayOrigin});expectStatus(payerChallenge,200);
    const authorization=await json(`${gatewayOrigin}/api/checkout/${reference}/authorize`,'POST',{id:payerChallenge.value.id,signature:await payer.signMessage({message:String(payerChallenge.value.message)})},{Origin:gatewayOrigin,Cookie:payerChallenge.cookie});expectStatus(authorization,200);
    const rawAuthorization=authorization.value.authorization as Record<string,string>;
    const message={...rawAuthorization,amount:BigInt(rawAuthorization.amount),epoch:BigInt(rawAuthorization.epoch),deadline:BigInt(rawAuthorization.deadline)} as unknown as PaymentAuthorization;
    assert.equal(message.amount,25_000_000n);assert.equal(message.payer.toLowerCase(),payer.address.toLowerCase());assert.equal(message.merchant.toLowerCase(),merchant.address.toLowerCase());assert.equal(message.token.toLowerCase(),USDT_ADDRESS.toLowerCase());

    stage='EXACT_LOCAL_APPROVAL_AND_PAYMENT';
    const approval=await payerClient.writeContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'approve',args:[router.address,message.amount]});
    assert.equal((await publicClient.waitForTransactionReceipt({hash:approval})).status,'success');
    const payment=await payerClient.writeContract({address:router.address,abi:routerAbi,functionName:'pay',args:[message,authorization.value.signature as Hex]});
    const receipt=await publicClient.waitForTransactionReceipt({hash:payment});assert.equal(receipt.status,'success');
    const hint=await json(`${gatewayOrigin}/api/checkout/${reference}/submitted`,'POST',{tx_hash:payment},{Origin:gatewayOrigin});expectStatus(hint,200);
    assert.equal((await json(`${gatewayOrigin}/api/checkout/${reference}`)).value.status,'open');
    assert.equal((await storeDb.query('select fulfillment_count from store_orders where id=$1',[orderId])).rows[0].fulfillment_count,0);
    await network.provider.request({method:'evm_mine',params:[]});
    const balances={payer:await publicClient.readContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'balanceOf',args:[payer.address]}),merchant:await publicClient.readContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'balanceOf',args:[merchant.address]}),router:await publicClient.readContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'balanceOf',args:[router.address]})};
    assert.deepEqual(balances,{payer:75_000_000n,merchant:25_000_000n,router:0n});
    assert.equal(await publicClient.readContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'allowance',args:[payer.address,router.address]}),0n);

    stage='OBSERVER_PROCESS_RESTART_AND_LOG_REPLAY';
    env.HARNESS_MERCHANT_ID=merchantId;
    await runChild(['--import','tsx',script,'--worker-observe'],env);
    await runChild(['--import','tsx',script,'--worker-observe'],env);
    const payments=(await db.pool.query('select p.id,c.state_version from payments p join checkout_sessions c on c.id=p.checkout_id where c.merchant_id=$1',[merchantId])).rows;assert.equal(payments.length,1);
    const paymentId=String(payments[0].id);
    const deliveries=(await db.pool.query('select id from webhook_deliveries where payment_id=$1',[paymentId])).rows;assert.equal(deliveries.length,1);env.HARNESS_DELIVERY_ID=String(deliveries[0].id);

    stage='HMAC_HTTP_DELIVERY_AND_LOST_ACK_RESTART';
    await runChild(['--import','tsx',script,'--worker-deliver-noack'],env);
    assert.equal((await storeDb.query('select fulfillment_count from store_orders where id=$1',[orderId])).rows[0].fulfillment_count,1);
    // Accelerate this own lease expiry only; no shared/default jobs are touched.
    await db.pool.query("update outbox_jobs set lease_until=clock_timestamp()-interval '1 second' where merchant_id=$1 and payload->>'deliveryId'=$2 and status='processing'",[merchantId,env.HARNESS_DELIVERY_ID]);
    await runChild(['--import','tsx',script,'--worker-deliver'],env);
    await runChild(['--import','tsx',script,'--worker-observe'],env);
    const finalOrder=(await storeDb.query('select state,fulfillment_count,payment_id from store_orders where id=$1',[orderId])).rows[0];assert.deepEqual(finalOrder,{state:'fulfilled',fulfillment_count:1,payment_id:paymentId});
    assert.equal((await storeDb.query('select count(*)::integer as count from store_receipts where order_id=$1',[orderId])).rows[0].count,1);
    const finalJob=(await db.pool.query("select status,attempts from outbox_jobs where merchant_id=$1 and payload->>'deliveryId'=$2",[merchantId,env.HARNESS_DELIVERY_ID])).rows[0];assert.deepEqual(finalJob,{status:'completed',attempts:2});
    const publicStatus=await json(`${storeOrigin}/api/orders/${orderId}/status`);expectStatus(publicStatus,200);assert.equal(publicStatus.value.state,'fulfilled');
    const download=await fetch(`${storeOrigin}/api/orders/${orderId}/download`,{headers:{Authorization:`Bearer ${String(order.value.cancel_token)}`},signal:AbortSignal.timeout(8000)});assert.equal(download.status,200);assert.match(await download.text(),/Fieldwork/);

    if(includeRefunds){
      refundEvidence.status='running';
      const merchantHeaders={Origin:gatewayOrigin,Cookie:login.cookie};
      stage='REFUND_INTENT_AND_IMMEDIATE_HOLD';
      const request={paymentId,amountBaseUnits:'5000000',idempotencyKey:`local-refund:${randomUUID()}`};
      const intent=await json(`${gatewayOrigin}/api/refunds`,'POST',request,merchantHeaders);expectStatus(intent,200);const intentId=String(intent.value.id);
      const repeated=await json(`${gatewayOrigin}/api/refunds`,'POST',request,merchantHeaders);expectStatus(repeated,200);assert.equal(repeated.value.id,intentId);
      const hold=(await db.pool.query('select c.refund_hold,c.refund_amount,c.state_version from payments p join checkout_sessions c on c.id=p.checkout_id where p.id=$1',[paymentId])).rows[0];assert.equal(hold.refund_hold,true);assert.equal(hold.refund_amount,'0');assert.ok(hold.state_version>payments[0].state_version);
      stage='REFUND_FRESH_SERVER_AUTHORIZATION';
      const authorized=await json(`${gatewayOrigin}/api/refunds/${intentId}/authorize`,'POST',{},merchantHeaders);expectStatus(authorized,200);
      const terms=authorized.value.authorization as Record<string,string>;
      const refund={...terms,amount:BigInt(terms.amount),epoch:BigInt(terms.epoch),deadline:BigInt(terms.deadline)} as unknown as RefundAuthorization;
      assert.equal(refund.amount,5_000_000n);assert.equal(refund.payer.toLowerCase(),payer.address.toLowerCase());assert.equal(refund.merchant.toLowerCase(),merchant.address.toLowerCase());assert.equal(refund.invoiceId,message.invoiceId);assert.equal(refund.token.toLowerCase(),USDT_ADDRESS.toLowerCase());
      stage='REFUND_ORIGINAL_MERCHANT_EXECUTION';
      const merchantClient=createWalletClient({account:merchant,chain,transport:http(rpc,{retryCount:0})});
      const refundApproval=await merchantClient.writeContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'approve',args:[router.address,refund.amount]});assert.equal((await publicClient.waitForTransactionReceipt({hash:refundApproval})).status,'success');
      const refundTx=await merchantClient.writeContract({address:router.address,abi:routerAbi,functionName:'refund',args:[refund,authorized.value.signature as Hex]});const refundReceipt=await publicClient.waitForTransactionReceipt({hash:refundTx});assert.equal(refundReceipt.status,'success');
      const submitted=await json(`${gatewayOrigin}/api/refunds/${intentId}/submitted`,'POST',{txHash:refundTx},merchantHeaders);expectStatus(submitted,200);
      assert.equal((await db.pool.query('select refund_amount from checkout_sessions where reference=$1',[reference])).rows[0].refund_amount,'0');
      await network.provider.request({method:'evm_mine',params:[]});
      await runChild(['--import','tsx',script,'--worker-observe'],env);await runChild(['--import','tsx',script,'--worker-observe'],env);
      const refundEvents=(await db.pool.query('select amount::text,canonical from refund_events where payment_id=$1',[paymentId])).rows;assert.deepEqual(refundEvents,[{amount:'5000000',canonical:true}]);
      const detail=await json(`${gatewayOrigin}/api/refunds/${intentId}`,'GET',undefined,{Cookie:login.cookie});expectStatus(detail,200);assert.equal(detail.value.status,'confirmed');assert.equal(detail.value.canonicalRefundedBaseUnits,'5000000');
      const afterRefund={payer:await publicClient.readContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'balanceOf',args:[payer.address]}),merchant:await publicClient.readContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'balanceOf',args:[merchant.address]}),router:await publicClient.readContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'balanceOf',args:[router.address]})};assert.deepEqual(afterRefund,{payer:80_000_000n,merchant:20_000_000n,router:0n});
      stage='REFUND_OVERVIEW_AND_EXACT_CSV';
      const period=new Date(Number((await publicClient.getBlock({blockNumber:refundReceipt.blockNumber})).timestamp)*1000).toISOString().slice(0,10);
      const overview=await json(`${gatewayOrigin}/api/operations/overview?from=${period}&to=${period}`,'GET',undefined,{Cookie:login.cookie});expectStatus(overview,200);assert.equal(overview.value.grossBaseUnits,'25000000');assert.equal(overview.value.refundedBaseUnits,'5000000');assert.equal(overview.value.netBaseUnits,'20000000');assert.equal(overview.value.paymentCount,1);assert.equal(overview.value.unverifiedTimestampCount,0);
      const csvResponse=await fetch(`${gatewayOrigin}/api/operations/reports.csv?from=${period}&to=${period}`,{headers:{Cookie:login.cookie},signal:AbortSignal.timeout(15000)});assert.equal(csvResponse.status,200);const privateReport=await csvResponse.text();assert.match(privateReport,/"payment"[^\r\n]*"25000000","25"/);assert.match(privateReport,/"refund"[^\r\n]*"-5000000","-5"/);
      stage='REFUND_PUBLIC_VERIFIER_WITH_EXPLICIT_ENTITY_FIXTURES';
      const projections=(await db.pool.query<{payload:unknown}>('select payload from arkiv_mappings where merchant_id=$1 and kind in (\'payment\',\'refund\')',[merchantId])).rows;assert.equal(projections.length,2);
      const publicEntities:ReceiptEntity[]=projections.map(row=>{const receipt=parseReceipt(row.payload);return {entityKey:keccak256(new TextEncoder().encode(`EXPLICIT_LOCAL_ENTITY_FIXTURE:${receipt.eventId}`)),owner:signer.address,creator:signer.address,expiresAt:'1000000',readAtBlock:'100',receipt};});
      const verified=await Promise.all(publicEntities.map(entity=>verifyReceipt(entity,{writer:signer.address,router:router.address,routerCodeHash:keccak256(code),deploymentBlock:deploymentBlock.toString(),whitechainRpcUrl:rpc})));
      assert.ok(verified.every(item=>item.status==='verified'));const totals=summarizeVerified(verified);assert.deepEqual({gross:totals.grossBaseUnits,refunded:totals.refundedBaseUnits,net:totals.netBaseUnits},{gross:'25000000',refunded:'5000000',net:'20000000'});const publicCsv=accountingCsv(totals.records);assert.match(publicCsv,/"25000000"/);assert.match(publicCsv,/"5000000"/);
      stage='REFUND_REVIEW_NOTIFICATION_AND_NO_SECOND_FULFILLMENT';
      const corrective=(await db.pool.query<{id:string}>('select id from webhook_deliveries where payment_id=$1 and event_type=\'payment.review\' order by state_version desc limit 1',[paymentId])).rows[0];assert.ok(corrective);env.HARNESS_DELIVERY_ID=corrective.id;await runChild(['--import','tsx',script,'--worker-deliver'],env);
      const correctedOrder=(await storeDb.query('select state,fulfillment_count from store_orders where id=$1',[orderId])).rows[0];assert.deepEqual(correctedOrder,{state:'review',fulfillment_count:1});
      assert.equal((await storeDb.query("select count(*)::integer as n from store_review_events where order_id=$1 and code='CORRECTION_AFTER_FULFILLMENT'",[orderId])).rows[0].n,1);
      const originalDelivery=String(deliveries[0].id);await db.pool.query("update outbox_jobs set status='pending',available_at=now(),lease_token=null,lease_until=null where merchant_id=$1 and payload->>'deliveryId'=$2",[merchantId,originalDelivery]);env.HARNESS_DELIVERY_ID=originalDelivery;await runChild(['--import','tsx',script,'--worker-deliver'],env);assert.equal((await storeDb.query('select fulfillment_count from store_orders where id=$1',[orderId])).rows[0].fulfillment_count,1);
      Object.assign(refundEvidence,{status:'passed',checkedAt:new Date().toISOString(),paymentTxHash:payment,refundTxHash:refundTx,refundBlock:refundReceipt.blockNumber.toString(),refundBlockHash:refundReceipt.blockHash,refundAmountBaseUnits:'5000000',originalPayer:payer.address,originalMerchant:merchant.address,router:router.address,refundExecutedBy:'Original merchant Node-held throwaway local account only',balancesBaseUnits:Object.fromEntries(Object.entries(afterRefund).map(([key,value])=>[key,value.toString()])),gatewayTotalsBaseUnits:{gross:'25000000',refunded:'5000000',net:'20000000'},dashboardCsvVerified:true,publicVerifierRows:2,publicVerifierEntities:'Explicitly simulated Arkiv entity metadata wrapping actual local EDR/observer receipt payloads; not actual Arkiv writes',publicVerifierTotalsBaseUnits:{gross:totals.grossBaseUnits,refunded:totals.refundedBaseUnits,net:totals.netBaseUnits},publicCsvVerified:true,storeFulfillmentCount:1,storeCorrectionExposureAuditCount:1,oldAcceptedEventReplayDidNotFulfill:true});
    }

    if(includeCollections){
      stage='COLLECTION_FRESH_MERCHANT_NO_EXTERNAL_INTEGRATION';
      const owner=privateKeyToAccount(generatePrivateKey());const ownChallenge=await json(`${gatewayOrigin}/api/auth/challenge`,'POST',{address:owner.address},{Origin:gatewayOrigin});expectStatus(ownChallenge,200);loginChallenges.push(String(ownChallenge.value.id));
      const ownLogin=await json(`${gatewayOrigin}/api/auth/verify`,'POST',{id:ownChallenge.value.id,signature:await owner.signMessage({message:String(ownChallenge.value.message)})},{Origin:gatewayOrigin,Cookie:ownChallenge.cookie});expectStatus(ownLogin,200);const ownerId=(ownLogin.value.merchant as {id:string}).id;testMerchantIds.push(ownerId);const headers={Origin:gatewayOrigin,Cookie:ownLogin.cookie};
      const setup=await json(`${gatewayOrigin}/api/merchant`,'PATCH',{displayName:'Local collection merchant without store adapter',websiteOrigin:gatewayOrigin},headers);expectStatus(setup,200);assert.equal((await db.pool.query('select count(*)::integer as n from merchant_integrations where merchant_id=$1',[ownerId])).rows[0].n,0);
      const localCollectionEnv={...env,HARNESS_MERCHANT_ID:ownerId};const paidCollections:Record<string,unknown>[]=[];
      const challengeFor=async(ref:string)=>{const result=await json(`${gatewayOrigin}/api/checkout/${ref}/challenge`,'POST',{address:payer.address},{Origin:gatewayOrigin});expectStatus(result,200);return result;};
      const authorizeFor=async(ref:string,proof:JsonResponse)=>json(`${gatewayOrigin}/api/checkout/${ref}/authorize`,'POST',{id:proof.value.id,signature:await payer.signMessage({message:String(proof.value.message)})},{Origin:gatewayOrigin,Cookie:proof.cookie});
      const payInternal=async(kind:'link'|'invoice',collectionReference:string,ref:string)=>{
        const quote=await authorizeFor(ref,await challengeFor(ref));expectStatus(quote,200);const terms=quote.value.authorization as Record<string,string>;const auth={...terms,amount:BigInt(terms.amount),epoch:BigInt(terms.epoch),deadline:BigInt(terms.deadline)} as unknown as PaymentAuthorization;assert.equal(auth.amount,1n);assert.equal(auth.merchant.toLowerCase(),owner.address.toLowerCase());
        const approved=await payerClient.writeContract({address:USDT_ADDRESS,abi:erc20Abi,functionName:'approve',args:[router.address,1n]});await publicClient.waitForTransactionReceipt({hash:approved});const hash=await payerClient.writeContract({address:router.address,abi:routerAbi,functionName:'pay',args:[auth,quote.value.signature as Hex]});assert.equal((await publicClient.waitForTransactionReceipt({hash})).status,'success');await network.provider.request({method:'evm_mine',params:[]});
        await runChild(['--import','tsx',script,'--worker-observe'],localCollectionEnv);
        const found=(await db.pool.query<{payment_id:string;order_id:string;state:string;version:number;mode:string}>('select p.id as payment_id,o.id as order_id,o.state,o.version,c.mode from payments p join checkout_sessions c on c.id=p.checkout_id join internal_collection_orders o on o.id=c.collection_order_id where c.reference=$1 and c.merchant_id=$2',[ref,ownerId])).rows[0];assert.equal(found.mode,'collection');assert.equal(found.state,'pending');
        const delivery=(await db.pool.query<{id:string}>('select id from webhook_deliveries where payment_id=$1 order by state_version desc limit 1',[found.payment_id])).rows[0];const deliveryEnv={...localCollectionEnv,HARNESS_DELIVERY_ID:delivery.id};await runChild(['--import','tsx',script,'--worker-deliver'],deliveryEnv);
        const fulfilled=(await db.pool.query('select state,version from internal_collection_orders where id=$1',[found.order_id])).rows[0];assert.equal(fulfilled.state,'fulfilled');
        await db.pool.query("update outbox_jobs set status='pending',available_at=now(),lease_token=null,lease_until=null where merchant_id=$1 and payload->>'deliveryId'=$2",[ownerId,delivery.id]);await runChild(['--import','tsx',script,'--worker-deliver'],deliveryEnv);assert.deepEqual((await db.pool.query('select state,version from internal_collection_orders where id=$1',[found.order_id])).rows[0],fulfilled);
        paidCollections.push({kind,amountBaseUnits:'1',txHash:hash,internalFulfillment:'fulfilled',repeatDeliveryDidNotRepeatEffect:true});
      };
      stage='COLLECTION_DEACTIVATION_BLOCKS_EXISTING_PROOF';
      const inactiveLink=await json(`${gatewayOrigin}/api/operations/links`,'POST',{title:'Deactivate before quote',amountBaseUnits:'1'},headers);expectStatus(inactiveLink,200);const inactive=inactiveLink.value.item as {id:string;reference:string;version:number};
      const beforeDeactivate=await json(`${gatewayOrigin}/api/collection/link/${inactive.reference}`,'POST',{}, {Origin:gatewayOrigin});expectStatus(beforeDeactivate,200);const existingProof=await challengeFor(String(beforeDeactivate.value.reference));
      expectStatus(await json(`${gatewayOrigin}/api/operations/links/${inactive.id}/deactivate`,'POST',{version:inactive.version},headers),200);expectStatus(await json(`${gatewayOrigin}/api/collection/link/${inactive.reference}`,'POST',{}, {Origin:gatewayOrigin}),409);expectStatus(await authorizeFor(String(beforeDeactivate.value.reference),existingProof),409);
      stage='COLLECTION_REAL_ONE_BASE_UNIT_LINK';
      const activeLink=await json(`${gatewayOrigin}/api/operations/links`,'POST',{title:'Local one-base-unit payment link',amountBaseUnits:'1'},headers);expectStatus(activeLink,200);const link=activeLink.value.item as {reference:string};const linkSession=await json(`${gatewayOrigin}/api/collection/link/${link.reference}`,'POST',{}, {Origin:gatewayOrigin});expectStatus(linkSession,200);await payInternal('link',link.reference,String(linkSession.value.reference));
      stage='COLLECTION_PAUSE_BLOCKS_INVOICE_SESSION_AND_PROOF';
      const invoiceCreated=await json(`${gatewayOrigin}/api/operations/invoices`,'POST',{title:'Local one-base-unit invoice',amountBaseUnits:'1'},headers);expectStatus(invoiceCreated,200);const invoiceDetail=await json(`${gatewayOrigin}/api/operations/invoices/${String(invoiceCreated.value.id)}`,'GET',undefined,{Cookie:ownLogin.cookie});expectStatus(invoiceDetail,200);const invoice=(invoiceDetail.value.item as {reference:string});
      const invoiceSession=await json(`${gatewayOrigin}/api/collection/invoice/${invoice.reference}`,'POST',{}, {Origin:gatewayOrigin});expectStatus(invoiceSession,200);const invoiceRef=String(invoiceSession.value.reference);const invoiceProof=await challengeFor(invoiceRef);
      const settings=await json(`${gatewayOrigin}/api/operations/settings`,'GET',undefined,{Cookie:ownLogin.cookie});expectStatus(settings,200);const version=(settings.value.settings as {version:number}).version;
      const paused=await json(`${gatewayOrigin}/api/operations/settings`,'PATCH',{paused:true,version},headers);expectStatus(paused,200);expectStatus(await json(`${gatewayOrigin}/api/collection/invoice/${invoice.reference}`,'POST',{}, {Origin:gatewayOrigin}),409);expectStatus(await authorizeFor(invoiceRef,invoiceProof),409);
      const resumed=await json(`${gatewayOrigin}/api/operations/settings`,'PATCH',{paused:false,version:(paused.value.settings as {version:number}).version},headers);expectStatus(resumed,200);
      stage='COLLECTION_REAL_ONE_BASE_UNIT_INVOICE';
      const sameSession=await json(`${gatewayOrigin}/api/collection/invoice/${invoice.reference}`,'POST',{}, {Origin:gatewayOrigin});expectStatus(sameSession,200);assert.equal(sameSession.value.reference,invoiceRef);await payInternal('invoice',invoice.reference,invoiceRef);
      const paidInvoice=await json(`${gatewayOrigin}/api/collection/invoice/${invoice.reference}`);expectStatus(paidInvoice,200);assert.equal(paidInvoice.value.status,'paid');expectStatus(await json(`${gatewayOrigin}/api/collection/invoice/${invoice.reference}`,'POST',{}, {Origin:gatewayOrigin}),409);assert.equal((await db.pool.query('select count(*)::integer as n from merchant_integrations where merchant_id=$1',[ownerId])).rows[0].n,0);
      Object.assign(refundEvidence,{collections:{status:'passed',freshMerchantWithoutExternalIntegration:true,deactivatedLinkBlockedNewSessionAndExistingProof:true,pausedMerchantBlockedInvoiceSessionAndExistingProof:true,invoiceReloadIdempotent:true,paidInvoiceRejectsNewCheckout:true,payments:paidCollections}});
    }
    Object.assign(evidence,{status:'passed',checkedAt:new Date().toISOString(),chainId:1874,tokenAddress:USDT_ADDRESS,tokenImplementation:'MockUsdt runtime copied by hardhat_setCode at sponsor address on local EDR only',router:router.address,routerCodeHash:keccak256(code),deploymentBlock:deploymentBlock.toString(),paymentTxHash:payment,paymentBlock:receipt.blockNumber.toString(),paymentBlockHash:receipt.blockHash,amountBaseUnits:'25000000',balancesBaseUnits:Object.fromEntries(Object.entries(balances).map(([key,value])=>[key,value.toString()])),gateway:'production Next.js HTTP on loopback3500',store:'actual standalone store HTTP on loopback3501',merchantSiwe:true,payerSiwe:true,serverAuthorization:true,observerProcessStarts:3,duplicateLogReplays:true,deliveryProcessStarts:2,acknowledgmentLossFixture:'Worker stopped after HTTP acknowledgment before outbox completion; own lease expiry accelerated explicitly',outboxAttempts:2,storeReceiptCount:1,storeFulfillmentCount:1,downloadVerified:true,cleanup:'Own merchant/orders/jobs/cursor deleted; original isolated screening source restored in finally.'});
    process.stdout.write('Explicit local EDR/mock-token full payment flow passed with actual isolated Neon/HTTP, worker restart and one store fulfillment. Not live Whitechain evidence.\n');
  }catch(error){
    Object.assign(evidence,{status:'failed',failedStage:stage,errorCode:typeof(error as {code?:unknown})?.code==='string'&&/^[A-Z_]{1,64}$/.test(String((error as {code:string}).code))?(error as {code:string}).code:'LOCAL_FLOW_CHECK_FAILED'});
    if(includeRefunds&&refundEvidence.status!=='passed')Object.assign(refundEvidence,{status:'failed',failedStage:stage});
    if(includeCollections&&stage.startsWith('COLLECTION_'))refundEvidence.collections={status:'failed',failedStage:stage};
    process.stderr.write(`Local payment harness failed at ${stage}; no live-network claim.\n`);throw new Error(`LOCAL_PAYMENT_FLOW_FAILED_${stage}`);
  }finally{
    for(const child of childServices.reverse())await stopChild(child);
    if(rpcServer){rpcServer.closeAllConnections();await new Promise<void>(resolve=>rpcServer!.close(()=>resolve()));}
    await connection?.close();
    if(orderIds.length){await storeDb.query('delete from store_review_events where order_id=any($1::uuid[])',[orderIds]);await storeDb.query('delete from store_receipts where order_id=any($1::uuid[])',[orderIds]);await storeDb.query('delete from store_orders where id=any($1::uuid[])',[orderIds]);}
    // The helper additionally checks the original default/runtime target differs
    // from TEST_DATABASE_URL. All child services have stopped before restoring it.
    process.env.DATABASE_URL=environmentBackup.DATABASE_URL;
    if(testMerchantIds.length)await cleanupTestMerchants(db,testMerchantIds);
    if(routerAddress)await db.pool.query('delete from chain_cursors where router=$1',[routerAddress]);
    if(loginChallenges.length)await db.pool.query('delete from wallet_challenges where id=any($1::uuid[])',[loginChallenges]);
    if(sourceReplaced){if(oldSource)await db.pool.query('update screening_sources set snapshot=$2,health=$3,fetched_at=$4,updated_at=$5 where source_id=$1',[OFAC_SOURCE_ID,JSON.stringify(oldSource.snapshot),JSON.stringify(oldSource.health),oldSource.fetched_at,oldSource.updated_at]);else await db.pool.query('delete from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);}
    await db.pool.end();await storeDb.end();
    for(const key of Object.keys(process.env))if(!(key in environmentBackup))delete process.env[key];Object.assign(process.env,environmentBackup);process.chdir(root);
    await mkdir(resolve(root,'docs/evidence/phase-2'),{recursive:true});await writeFile(resolve(root,'docs/evidence/phase-2/local-payment-flow.json'),JSON.stringify(evidence,null,2)+'\n');
    if(includeRefunds||includeCollections){await mkdir(resolve(root,'docs/evidence/phase-4'),{recursive:true});await writeFile(resolve(root,'docs/evidence/phase-4/local-refund-flow.json'),JSON.stringify(refundEvidence,null,2)+'\n');}
  }
}

const workerMode=process.argv.find(value=>['--worker-observe','--worker-deliver','--worker-deliver-noack'].includes(value));
if(workerMode)await workerOnce(workerMode);else await main();
