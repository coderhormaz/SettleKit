/** Local-only supervisor. It never builds, migrates, deploys or synchronizes policy. */
import { config } from 'dotenv';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, createConnection, type Server } from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';

const root=fileURLToPath(new URL('../',import.meta.url));
const script=fileURLToPath(import.meta.url);const require=createRequire(import.meta.url);
config({path:join(root,'.env'),quiet:true});
type Service='gateway'|'store'|'accountant'|'worker';
const services:Service[]=['gateway','store','accountant','worker'];
const origins={gateway:'http://127.0.0.1:3000',store:'http://127.0.0.1:3200',accountant:'http://127.0.0.1:3400'} as const;
const stateDirectory=join(root,'data','local-stack');const statePath=join(stateDirectory,'state.json');
const pipe=process.platform==='win32'?`\\\\.\\pipe\\settlekit-${createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,16)}`:join(stateDirectory,'control.sock');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
interface StackState {version:1;workspace:string;pid:number;token:string;startedAt:string;pipe:string}
interface ChildState {child:ChildProcess;lastHeartbeat:number;stopping:boolean;exited:boolean}
class StackError extends Error{constructor(readonly code:string){super(code);}}
function within(parent:string,target:string){const value=relative(parent,target);return value===''||(!value.startsWith('..')&&!isAbsolute(value));}
async function safeStateDirectory(){await mkdir(stateDirectory,{recursive:true});if(!within(await realpath(root),await realpath(stateDirectory)))throw new StackError('STATE_PATH_OUTSIDE_WORKSPACE');}
function required(name:string,pattern?:RegExp){const value=process.env[name];if(!value||pattern&&!pattern.test(value))throw new StackError(`CONFIGURATION_${name}`);return value;}
function databaseUrl(name:string){let url:URL;try{url=new URL(required(name));}catch{throw new StackError(`CONFIGURATION_${name}`);}if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||!url.hostname.includes('-pooler')||url.searchParams.get('sslmode')!=='verify-full'||!url.username||!url.password)throw new StackError(`CONFIGURATION_${name}`);}
function validateStart(){
  if(required('APP_ORIGIN')!==origins.gateway||required('STORE_ORIGIN')!==origins.store||process.env.ALLOW_LOCAL_HTTP!=='true')throw new StackError('LOCAL_ORIGINS_REQUIRED');
  databaseUrl('DATABASE_URL');databaseUrl('STORE_DATABASE_URL');required('DATA_ENCRYPTION_KEY',/^[a-f0-9]{64}$/i);required('STORE_GATEWAY_API_KEY',/^sk_[a-f0-9]{64}$/);required('STORE_WEBHOOK_SECRET',/^[A-Za-z0-9_-]{32,256}$/);required('STORE_ORDER_READ_KEY',/^[A-Za-z0-9_-]{32,256}$/);
  const deployment=['WHITECHAIN_ROUTER_ADDRESS','WHITECHAIN_ROUTER_CODE_HASH','WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK'].map(name=>process.env[name]);
  if(deployment.some(Boolean)){required('WHITECHAIN_ROUTER_ADDRESS',/^0x[a-f0-9]{40}$/i);required('WHITECHAIN_ROUTER_CODE_HASH',/^0x[a-f0-9]{64}$/i);required('WHITECHAIN_ROUTER_DEPLOYMENT_BLOCK',/^\d+$/);required('PAYMENT_AUTHORIZER_PRIVATE_KEY',/^0x[a-f0-9]{64}$/i);}
}
async function loadState():Promise<StackState|null>{
  try{const value=JSON.parse(await readFile(statePath,'utf8')) as StackState;if(value.version!==1||value.workspace!==root||value.pipe!==pipe||!Number.isSafeInteger(value.pid)||!/^[a-f0-9]{64}$/.test(value.token))throw new StackError('INVALID_STACK_STATE');return value;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function control(action:'status'|'stop',state:StackState):Promise<Record<string,unknown>>{
  return new Promise((resolve,reject)=>{
    const socket=createConnection(state.pipe);let text='';const timer=setTimeout(()=>{socket.destroy();reject(new StackError('STACK_CONTROL_UNAVAILABLE'));},5000);
    socket.once('connect',()=>socket.write(JSON.stringify({action,token:state.token})+'\n'));
    socket.on('data',part=>{text+=part.toString();if(text.length>16_384){socket.destroy();clearTimeout(timer);reject(new StackError('STACK_CONTROL_INVALID'));}else if(text.includes('\n')){socket.end();clearTimeout(timer);try{resolve(JSON.parse(text.trim()) as Record<string,unknown>);}catch{reject(new StackError('STACK_CONTROL_INVALID'));}}});
    socket.once('error',()=>{clearTimeout(timer);reject(new StackError('STACK_CONTROL_UNAVAILABLE'));});
  });
}
async function httpReady(url:string){try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(2000)});await response.body?.cancel();return response.status===200;}catch{return false;}}
async function portAvailable(port:number){return new Promise<boolean>(resolve=>{const probe=createServer();probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});}

async function childMode(service:Service){
  if(!services.includes(service)||process.env.SETTLEKIT_MANAGED_CHILD!=='true')throw new StackError('INVALID_MANAGED_CHILD');
  let stopping=false;
  process.on('message',message=>{if(message&&typeof message==='object'&&'action'in message&&message.action==='stop'&&!stopping){stopping=true;if(process.listenerCount('SIGTERM'))process.emit('SIGTERM');else process.exit(0);}});
  process.channel?.unref();
  const timer=setInterval(()=>process.send?.({type:'heartbeat',service,at:Date.now(),stopping}),5000);timer.unref();
  try{
    if(service==='worker')await import(pathToFileURL(join(root,'packages/worker/src/run.ts')).href);
    else if(service==='store')await import(pathToFileURL(join(root,'examples/store/src/server.ts')).href);
    else{
      const cwd=join(root,'apps',service);process.chdir(cwd);const executable=require.resolve('next/dist/bin/next',{paths:[cwd]});const port=service==='gateway'?'3000':'3400';
      process.argv=[process.execPath,executable,'start','--hostname','127.0.0.1','--port',port];await import(pathToFileURL(executable).href);
    }
    process.send?.({type:'heartbeat',service,at:Date.now(),stopping});
  }catch{process.send?.({type:'startup-failed',service});process.exitCode=1;}
}

async function start(){
  validateStart();await safeStateDirectory();const prior=await loadState();
  if(prior){try{await control('status',prior);throw new StackError('STACK_ALREADY_RUNNING');}catch(error){if(error instanceof StackError&&error.code==='STACK_ALREADY_RUNNING')throw error;/* No PID is killed from stale metadata. */}}
  for(const port of [3000,3200,3400])if(!await portAvailable(port))throw new StackError(`PORT_IN_USE_${port}`);
  if(process.platform!=='win32')try{await unlink(pipe);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const state:StackState={version:1,workspace:root,pid:process.pid,token:randomBytes(32).toString('hex'),startedAt:new Date().toISOString(),pipe};
  const owned=new Map<Service,ChildState>();let stopping=false;let ready=false;let server:Server|undefined;
  const snapshot=async()=>({managed:true,startedAt:state.startedAt,supervisorAlive:true,services:Object.fromEntries(await Promise.all(services.map(async service=>{const value=owned.get(service);return [service,{processAlive:!!value&&!value.exited,heartbeatFresh:!!value&&Date.now()-value.lastHeartbeat<20_000,...(service==='worker'?{kind:'process-heartbeat-only'}:{url:origins[service],httpReady:await httpReady(origins[service])}),stopping:value?.stopping??false}];})))});
  async function shutdown(){
    if(stopping)return;stopping=true;process.stdout.write('Stopping managed SettleKit services; allowing active jobs to finish.\n');
    for(const value of owned.values()){value.stopping=true;if(value.child.connected)value.child.send({action:'stop'});}
    const deadline=Date.now()+75_000;
    while([...owned.values()].some(value=>!value.exited)&&Date.now()<deadline)await pause(250);
    for(const [name,value]of owned)if(!value.exited){process.stderr.write(`Forced stop after grace deadline: ${name}. Its durable leases must expire before retry.\n`);value.child.kill('SIGKILL');}
    await Promise.allSettled([...owned.values()].map(value=>!value.exited?Promise.race([once(value.child,'exit'),pause(3000)]):Promise.resolve()));
    await new Promise<void>(resolve=>server?.close(()=>resolve())??resolve());
    const current=await loadState();if(current?.token===state.token)await unlink(statePath);
    process.stdout.write('Managed services stopped.\n');
  }
  try{
    server=createServer(socket=>{let buffer='';socket.setTimeout(5000,()=>socket.destroy());socket.on('data',part=>{buffer+=part.toString();if(buffer.length>4096){socket.destroy();return;}if(!buffer.includes('\n'))return;socket.pause();void(async()=>{try{const request=JSON.parse(buffer.trim()) as {token?:string;action?:string};const supplied=Buffer.from(request.token??'');const expected=Buffer.from(state.token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new StackError('CONTROL_UNAUTHORIZED');if(request.action==='status'){socket.end(JSON.stringify(await snapshot())+'\n');}else if(request.action==='stop'){socket.end(JSON.stringify({stopping:true,graceSeconds:75})+'\n');void shutdown().catch(()=>{process.stderr.write('STACK_STOP_FAILED\n');process.exitCode=1;});}else throw new StackError('CONTROL_ACTION_INVALID');}catch{socket.end(JSON.stringify({error:'CONTROL_DENIED'})+'\n');}})();});});
    await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(pipe,resolve);});await writeFile(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});
    for(const service of services){
      const child=spawn(process.execPath,['--import','tsx',script,'__child',service],{cwd:root,env:{...process.env,SETTLEKIT_MANAGED_CHILD:'true'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
      const value:ChildState={child,lastHeartbeat:0,stopping:false,exited:false};owned.set(service,value);child.stdout?.resume();child.stderr?.resume();
      child.on('message',message=>{if(message&&typeof message==='object'&&'type'in message&&message.type==='heartbeat')value.lastHeartbeat=Date.now();});
      child.once('exit',()=>{value.exited=true;if(!stopping){process.stderr.write(`Managed ${service} exited; stopping its companion services.\n`);process.exitCode=1;void shutdown();}});
      child.once('error',()=>{process.stderr.write(`Managed ${service} could not start.\n`);process.exitCode=1;void shutdown();});
    }
    for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{void shutdown();});
    for(let n=0;n<60&&!stopping;n++){
      const status=await snapshot();const checks=Object.values(status.services as Record<string,{processAlive:boolean;httpReady?:boolean;heartbeatFresh:boolean}>);if(checks.every(item=>item.processAlive&&item.heartbeatFresh&&item.httpReady!==false)){ready=true;break;}await pause(500);
    }
    if(!ready&&!stopping)throw new StackError('STACK_HTTP_READINESS_FAILED');
    if(ready)process.stdout.write(`SettleKit local services ready:\n${origins.gateway}\n${origins.store}\n${origins.accountant}\nWorker heartbeat is process liveness, not a successful source/policy/job check.\nPress Ctrl+C or run local-stack stop to finish active work and close this stack.\n`);
  }catch(error){await shutdown();throw error;}
}

async function main(){
  const action=process.argv[2]??'status';
  if(action==='__child'){await childMode(process.argv[3] as Service);return;}
  if(action==='start'){await start();return;}
  if(action!=='stop'&&action!=='status')throw new StackError('USAGE_START_STOP_STATUS');
  const state=await loadState();if(!state){process.stdout.write(JSON.stringify({managed:false,message:'No stack started by this supervisor. Existing independent processes were not changed.'})+'\n');return;}
  const result=await control(action,state);process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
await main().catch(error=>{process.stderr.write(`LOCAL_STACK_${error instanceof StackError?error.code:'UNAVAILABLE'}\n`);process.exitCode=1;});
