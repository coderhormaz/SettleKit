import {CronCapability,HTTPClient,Runner,consensusIdenticalAggregation,handler,json,ok,type HTTPSendRequester,type Runtime} from '@chainlink/cre-sdk';
import {decodeEventLog,keccak256,parseAbi,type Hex} from 'viem';

type Config={schedule:string;gatewayOrigin:string;merchantApiBase:string;merchantWallet:string;whitechainRpcUrl:string;router:string;routerCodeHash:string;deploymentBlock:string;localSimulation:boolean};
type Candidate={paymentId:string;deliveryId:string;stateVersion:number;recoveryRound:number;orderId:string;invoiceId:string;merchant:string;payer:string;amountBaseUnits:string;token:string;chainId:number;router:string;txHash:string;logIndex:number;blockNumber:string;blockHash:string;orderApiBase:string};
type Verdict={eligible:boolean;reason:string};
const TOKEN='0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7';
const abi=parseAbi(['event PaymentAccepted(bytes32 indexed invoiceId,address indexed payer,address indexed merchant,address token,uint256 amount,bytes32 evidence,uint256 epoch,uint256 deadline)']);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown):v is Hex=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const address=(v:unknown):v is Hex=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v);
const quantity=(v:unknown,expected?:bigint):v is Hex=>typeof v==='string'&&/^0x[0-9a-f]+$/i.test(v)&&(expected===undefined||BigInt(v)===expected);
function endpoint(value:string,local:boolean,originOnly=false):void{
  // CRE's WASM runtime does not provide Node/browser's WHATWG URL constructor.
  // Configured endpoints need only this deliberately narrow, credential-free
  // HTTPS/explicit-loopback HTTP grammar; request paths are never user supplied.
  const match=typeof value==='string'&&value.length<=2048?value.match(/^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?(\/[^?#\s\\]*)?$/i):null;
  if(!match)throw new Error('RECOVERY_ENDPOINT_INVALID');
  const protocol=match[1].toLowerCase(),host=match[2].toLowerCase(),path=match[4]??'/';
  const loopback=['127.0.0.1','localhost','[::1]'].includes(host);
  if((match[3]&&(Number(match[3])<1||Number(match[3])>65535))||(protocol!=='https'&&!(local&&loopback&&protocol==='http'))||(originOnly&&path!=='/')||/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(path))throw new Error('RECOVERY_ENDPOINT_INVALID');
}
function configCheck(c:Config){
  if(typeof c.schedule!=='string'||typeof c.localSimulation!=='boolean'||!address(c.router)||!address(c.merchantWallet)||!hash(c.routerCodeHash)||!/^\d+$/.test(c.deploymentBlock))throw new Error('RECOVERY_CONFIG_INVALID');
  endpoint(c.gatewayOrigin,c.localSimulation,true);endpoint(c.merchantApiBase,c.localSimulation);endpoint(c.whitechainRpcUrl,c.localSimulation);
}
function send(send:HTTPSendRequester,url:string,method:'GET'|'POST',token?:string,body?:unknown):unknown{
  const response=send.sendRequest({url,method,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{ } ),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:Buffer.from(JSON.stringify(body)).toString('base64')}),cacheSettings:{store:false,maxAge:'0s'}}).result();
  if(!ok(response))throw new Error('RECOVERY_HTTP_UNAVAILABLE');return json(response);
}
function chooseCandidate(sendRequester:HTTPSendRequester,input:{config:Config;token:string;slot:number}):Candidate|null{
  const result=send(sendRequester,`${input.config.gatewayOrigin}/api/recovery/candidates?limit=1&merchant=${input.config.merchantWallet}&slot=${input.slot}`,'GET',input.token);
  if(!record(result)||!Array.isArray(result.items)||result.items.length>1)throw new Error('RECOVERY_CANDIDATES_INVALID');if(!result.items.length)return null;
  const c=result.items[0];if(!record(c)||!uuid(c.paymentId)||!uuid(c.deliveryId)||!Number.isSafeInteger(c.stateVersion)||Number(c.stateVersion)<1||typeof c.orderId!=='string'||c.orderId.length<1||c.orderId.length>120||!hash(c.invoiceId)||!address(c.merchant)||!address(c.payer)||typeof c.amountBaseUnits!=='string'||!/^[1-9]\d{0,77}$/.test(c.amountBaseUnits)||BigInt(c.amountBaseUnits)>=2n**256n||typeof c.token!=='string'||c.token.toLowerCase()!==TOKEN||c.chainId!==1874||String(c.router).toLowerCase()!==input.config.router.toLowerCase()||!hash(c.txHash)||!Number.isInteger(c.logIndex)||Number(c.logIndex)<0||typeof c.blockNumber!=='string'||!/^\d+$/.test(c.blockNumber)||!hash(c.blockHash)||c.orderApiBase!==input.config.merchantApiBase||c.merchant.toLowerCase()!==input.config.merchantWallet.toLowerCase())throw new Error('RECOVERY_CANDIDATE_INVALID');
  if(!Number.isInteger(c.recoveryRound)||Number(c.recoveryRound)<1||Number(c.recoveryRound)>3)throw new Error('RECOVERY_ROUND_INVALID');return c as unknown as Candidate;
}
function verifyCandidate(sendRequester:HTTPSendRequester,input:{config:Config;candidate:Candidate;token:string;orderToken:string;nowMs:number}):Verdict{
  const {config,candidate:c}=input;const block=`0x${BigInt(c.blockNumber).toString(16)}`;
  const values=send(sendRequester,config.whitechainRpcUrl,'POST',undefined,[{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]},{jsonrpc:'2.0',id:2,method:'eth_getTransactionReceipt',params:[c.txHash]},{jsonrpc:'2.0',id:3,method:'eth_getBlockByNumber',params:[block,false]},{jsonrpc:'2.0',id:4,method:'eth_blockNumber',params:[]},{jsonrpc:'2.0',id:5,method:'eth_getCode',params:[config.router,block]}]);
  if(!Array.isArray(values)||values.length!==5)throw new Error('RECOVERY_RPC_INVALID');const result=(id:number)=>{const value=values.find(v=>record(v)&&v.id===id);if(!record(value)||value.error)throw new Error('RECOVERY_RPC_FAILED');return value.result;};
  if(result(1)!=='0x752')throw new Error('RECOVERY_CHAIN_MISMATCH');const receipt=result(2),canonical=result(3),head=result(4),code=result(5);
  if(!record(receipt)||!record(canonical)||!Array.isArray(receipt.logs)||receipt.status!=='0x1'||String(receipt.transactionHash).toLowerCase()!==c.txHash.toLowerCase()||String(receipt.blockHash).toLowerCase()!==c.blockHash.toLowerCase()||!quantity(receipt.blockNumber,BigInt(c.blockNumber))||!quantity(canonical.number,BigInt(c.blockNumber))||String(canonical.hash).toLowerCase()!==c.blockHash.toLowerCase()||!quantity(head)||BigInt(head)<BigInt(c.blockNumber)+1n||typeof code!=='string'||!/^0x[0-9a-f]+$/i.test(code)||keccak256(code as Hex).toLowerCase()!==config.routerCodeHash.toLowerCase()||BigInt(c.blockNumber)<BigInt(config.deploymentBlock))return {eligible:false,reason:'CHAIN_EVIDENCE_NOT_ACCEPTED'};
  const log=receipt.logs.find(v=>record(v)&&Number(BigInt(String(v.logIndex)))===c.logIndex);
  if(!record(log)||String(log.address).toLowerCase()!==config.router.toLowerCase()||String(log.transactionHash).toLowerCase()!==c.txHash.toLowerCase()||String(log.blockHash).toLowerCase()!==c.blockHash.toLowerCase()||!quantity(log.blockNumber,BigInt(c.blockNumber))||log.removed===true||typeof log.data!=='string'||!Array.isArray(log.topics)||log.topics.length!==4||log.topics.some(v=>!hash(v)))return {eligible:false,reason:'ROUTER_EVENT_MISMATCH'};
  const decoded=decodeEventLog({abi,eventName:'PaymentAccepted',data:log.data as Hex,topics:log.topics as [Hex,Hex,Hex,Hex]});const a=decoded.args;
  if(a.invoiceId.toLowerCase()!==c.invoiceId.toLowerCase()||a.payer.toLowerCase()!==c.payer.toLowerCase()||a.merchant.toLowerCase()!==c.merchant.toLowerCase()||a.token.toLowerCase()!==TOKEN||a.amount!==BigInt(c.amountBaseUnits)||typeof canonical.timestamp!=='string'||BigInt(canonical.timestamp)>a.deadline)return {eligible:false,reason:'PAYMENT_ASSOCIATION_MISMATCH'};
  const order=send(sendRequester,`${config.merchantApiBase.replace(/\/$/,'')}/${encodeURIComponent(c.orderId)}`,'GET',input.orderToken);
  if(!record(order)||order.order_ref!==c.orderId||order.amount_base_units!==c.amountBaseUnits||!Number.isSafeInteger(order.state_version)||Number(order.state_version)<1||(order.payment_id!==null&&order.payment_id!==c.paymentId))return {eligible:false,reason:'MERCHANT_ORDER_MISMATCH'};
  if(order.state!=='pending'&&order.state!=='fulfilled')return {eligible:false,reason:'ORDER_NOT_PENDING'};
  const current=send(sendRequester,`${config.gatewayOrigin}/api/recovery/current/${c.paymentId}`,'GET',input.token);
  if(!record(current)||current.payment_id!==c.paymentId||current.merchant_order_id!==c.orderId||current.state_version!==c.stateVersion||current.amount_base_units!==c.amountBaseUnits||String(current.payer).toLowerCase()!==c.payer.toLowerCase()||String(current.merchant).toLowerCase()!==c.merchant.toLowerCase()||String(current.token).toLowerCase()!==TOKEN||current.chain_id!==1874||current.status!=='accepted'||current.eligible!==true||current.refund_hold!==false||current.refund_amount_base_units!=='0'||typeof current.grant_expires_at!=='string'||!Number.isFinite(Date.parse(current.grant_expires_at))||Date.parse(current.grant_expires_at)<=input.nowMs)return {eligible:false,reason:'CURRENT_STATE_REFUSED'};
  return {eligible:true,reason:order.state==='fulfilled'?'ORDER_ALREADY_FULFILLED_ACK_ONLY':'CURRENT_PAYMENT_AND_ORDER_MATCH'};
}
function submitRecovery(sendRequester:HTTPSendRequester,input:{config:Config;candidate:Candidate;token:string}):{status:string}{
  const c=input.candidate;const result=send(sendRequester,`${input.config.gatewayOrigin}/api/recovery/request`,'POST',input.token,{paymentId:c.paymentId,deliveryId:c.deliveryId,stateVersion:c.stateVersion,round:c.recoveryRound,txHash:c.txHash,blockHash:c.blockHash,logIndex:c.logIndex});
  if(!record(result)||!['scheduled','noop','refused'].includes(String(result.status)))throw new Error('RECOVERY_RESULT_INVALID');
  // Duplicate-node responses intentionally normalize to the same result.
  return {status:String(result.status)};
}
function onCron(runtime:Runtime<Config>){
  configCheck(runtime.config);const token=runtime.getSecret({id:'RECOVERY_SERVICE_TOKEN'}).result().value;const orderToken=runtime.getSecret({id:'STORE_ORDER_READ_KEY'}).result().value;
  if(!/^[a-f0-9]{64}$/.test(token)||orderToken.length<32)throw new Error('RECOVERY_SECRETS_INVALID');const http=new HTTPClient();
  const candidate=http.sendRequest(runtime,chooseCandidate,consensusIdenticalAggregation<Candidate|null>())({config:runtime.config,token,slot:Math.floor(runtime.now().getTime()/30000)}).result();
  if(!candidate){runtime.log('No failed eligible notification candidate.');return {scanned:0,scheduled:0,refused:0};}
  // Consensus selection/verification finish before any side-effecting POST.
  const verdict=http.sendRequest(runtime,verifyCandidate,consensusIdenticalAggregation<Verdict>())({config:runtime.config,candidate,token,orderToken,nowMs:runtime.now().getTime()}).result();
  if(!verdict.eligible){runtime.log(`Recovery refused: ${verdict.reason}`);return {scanned:1,scheduled:0,refused:1};}
  const result=http.sendRequest(runtime,submitRecovery,consensusIdenticalAggregation<{status:string}>())({config:runtime.config,candidate,token}).result();
  runtime.log(`Recovery result: ${result.status}. Existing notification only; no money movement.`);return {scanned:1,scheduled:result.status==='scheduled'?1:0,refused:result.status==='refused'?1:0};
}
export async function main(){const runner=await Runner.newRunner<Config>();await runner.run(config=>[handler(new CronCapability().trigger({schedule:config.schedule}),onCron)]);}
