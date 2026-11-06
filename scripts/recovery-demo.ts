import {config} from 'dotenv';
import {safeJsonRequest} from '../packages/integration/src/index.ts';
config({path:'.env',quiet:true});
async function main(){
  if(process.env.ALLOW_DEVELOPMENT_FAILURES!=='true'||process.env.ALLOW_LOCAL_HTTP!=='true'||!process.env.DEMO_MERCHANT_ID)throw new Error('EXPLICIT_LOCAL_DEMO_CONFIGURATION_REQUIRED');
  const store=new URL(process.env.STORE_ORIGIN??'http://127.0.0.1:3200');const gateway=new URL(process.env.APP_ORIGIN??'http://127.0.0.1:3000');
  if([store,gateway].some(url=>url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password))throw new Error('LOCAL_DEMO_ORIGINS_REQUIRED');
  const action=process.argv[2]??'inspect';
  if(action==='arm'||action==='disable'){
    const secret=process.env.STORE_DEVELOPMENT_FAILURE_TOKEN;if(!secret||secret.length<32)throw new Error('DEVELOPMENT_FAILURE_TOKEN_REQUIRED');
    await safeJsonRequest(new URL('/api/dev/fail-next',store),{approvedOrigin:store.origin,allowLocal:true,method:'POST',headers:{authorization:`Bearer ${secret}`},body:{remaining:action==='arm'?1:0}});
    process.stdout.write(action==='arm'?'Armed one actual signed financial-webhook failure. Use the configured demo merchant; initial delivery budget must be explicitly set to1. CRE recovery uses its separate bounded normal-delivery job.\n':'Disabled the pending receiver failure. Restore ALLOW_DEVELOPMENT_FAILURES=false and normal delivery budget5 before regular use.\n');
  }else if(action==='inspect'){
    const token=process.env.RECOVERY_SERVICE_TOKEN;if(!token)throw new Error('RECOVERY_SERVICE_TOKEN_REQUIRED');
    const merchant=process.env.CRE_MERCHANT_WALLET;if(!/^0x[0-9a-f]{40}$/i.test(merchant??''))throw new Error('DEMO_MERCHANT_WALLET_REQUIRED');
    const result=await safeJsonRequest(new URL(`/api/recovery/candidates?limit=1&merchant=${merchant}`,gateway),{approvedOrigin:gateway.origin,allowLocal:true,headers:{authorization:`Bearer ${token}`}}) as {items?:{paymentId:string;deliveryId:string;stateVersion:number;recoveryRound:number}[]};
    process.stdout.write(JSON.stringify({kind:'local-recovery-candidate-inspection',items:(result.items??[]).map(row=>({paymentId:row.paymentId,deliveryId:row.deliveryId,stateVersion:row.stateVersion,recoveryRound:row.recoveryRound})),simulationExecuted:false})+'\n');
  }else throw new Error('USAGE_ARM_INSPECT_OR_DISABLE');
}
await main().catch(error=>{process.stderr.write(`${error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RECOVERY_DEMO_UNAVAILABLE'}\n`);process.exitCode=1;});
