import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,delimiter} from 'node:path';
import {config} from 'dotenv';
const root=fileURLToPath(new URL('../',import.meta.url));config({path:join(root,'.env'),quiet:true});
const directory=join(root,'packages','cre');const data=join(root,'data');
const cli=process.env.CRE_CLI_PATH??join(root,'.tools','cre-1.39.0','cre_v1.39.0_windows_amd64.exe');
const bun=process.env.BUN_PATH??join(root,'.tools','bun-1.4.4','bun-windows-x64','bun.exe');
const wasm=join(data,'cre-recovery.wasm');const secretValues=new Set<string>();
for(const [name,value]of Object.entries(process.env))if(value&&value.length>=16&&/KEY|TOKEN|SECRET|DATABASE_URL|RPC_URL/.test(name))secretValues.add(value);
try{const env=await readFile(join(data,'cre-recovery.env'),'utf8');for(const line of env.split(/\r?\n/)){const equal=line.indexOf('=');if(equal>0){const value=line.slice(equal+1);if(value.length>=16)secretValues.add(value);}}}catch{/* Preparation below supplies a safe configuration error. */}
function sanitize(output:string){let result=output;for(const value of [...secretValues].sort((a,b)=>b.length-a.length)){result=result.split(value).join('[REDACTED]');if(value.startsWith('0x')&&value.length===66)result=result.split(value.slice(2)).join('[REDACTED]');}return result;}
async function run(path:string,args:string[],timeout:number){
  return new Promise<string>((resolve,reject)=>{const child=spawn(path,args,{cwd:directory,env:{...process.env,PATH:`${dirname(bun)}${delimiter}${process.env.PATH??''}`},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
    const append=(part:Buffer)=>{output+=part.toString();if(output.length>1500000){child.kill('SIGKILL');output=output.slice(0,1500000);}};child.stdout?.on('data',append);child.stderr?.on('data',append);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('CRE_TOOL_UNAVAILABLE'));});child.once('exit',code=>{clearTimeout(timer);if(code!==0){const error=new Error('CRE_COMMAND_FAILED');Object.assign(error,{safeOutput:sanitize(output)});reject(error);}else resolve(sanitize(output));});
  });
}
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
try{
  if(process.platform!=='win32'&&(!process.env.CRE_CLI_PATH||!process.env.BUN_PATH))throw new Error('EXPLICIT_PLATFORM_TOOL_PATHS_REQUIRED');
  const baseline=JSON.parse(await readFile(join(root,'docs/evidence/phase-1/cre-simulation.json'),'utf8')) as {cliBinaryHash:string};
  const binaryHash=await hash(cli);if(!process.env.CRE_CLI_PATH&&binaryHash!==baseline.cliBinaryHash)throw new Error('CRE_BINARY_HASH_MISMATCH');
  await mkdir(data,{recursive:true});if(process.argv.includes('--simulate'))await run(process.execPath,['--import','tsx','--env-file=../../.env','scripts/prepare-recovery.ts'],30000);
  const compile=await run(bun,['node_modules/@chainlink/cre-sdk/bin/cre-compile.ts','recovery.ts',wasm],120000);
  if(!process.argv.includes('--simulate')){process.stdout.write('Recovery WASM compiled; simulation was not run. Use --simulate only with configured services and an eligible failed notification.\n');}
  else{
    for(const line of (await readFile(join(data,'cre-recovery.env'),'utf8')).split(/\r?\n/)){const equal=line.indexOf('=');if(equal>0&&line.slice(equal+1).length>=16)secretValues.add(line.slice(equal+1));}
    const startedAt=new Date().toISOString();const output=await run(cli,['workflow','simulate','.','--project-root','.','--target','recovery-settings','--non-interactive','--trigger-index','0','--wasm',wasm,'--env',join(data,'cre-recovery.env')],180000);
    const evidence=join(root,'docs','evidence','phase-5');await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'cre-recovery-simulation.log'),`${compile}\n${output}`);
    const setting=JSON.parse(await readFile(join(data,'cre-recovery.config.json'),'utf8')) as {whitechainRpcUrl:string;localSimulation:boolean};
    const localChain=['127.0.0.1','localhost','[::1]'].includes(new URL(setting.whitechainRpcUrl).hostname);
    await writeFile(join(evidence,'cre-recovery-simulation.json'),JSON.stringify({kind:'actual-cre-cli-recovery-simulation',startedAt,completedAt:new Date().toISOString(),cliBinaryHash:binaryHash,sourceSha256:await hash(join(directory,'recovery.ts')),wasmSha256:await hash(wasm),whitechainRpcRoute:localChain?'explicit local test RPC':'configured Whitechain HTTP RPC (1874)',liveWhitechain:!localChain,localConfiguration:setting.localSimulation,execution:'CLI simulation, not DON deployment',resultLog:'cre-recovery-simulation.log',evidenceBoundary:'A successful CLI run can return no candidates/refusals. Inspect persisted recovery and actual merchant order outcome before claiming recovered fulfillment.'},null,2)+'\n');
    process.stdout.write('CRE simulation finished. Sanitized evidence saved; inspect recovery/order outcome before claiming fulfillment.\n');
  }
}catch(error){const safe=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CRE_RECOVERY_UNAVAILABLE';process.stderr.write(`${safe}\n`);if(error&&typeof error==='object'&&'safeOutput'in error){await mkdir(data,{recursive:true});await writeFile(join(data,'cre-recovery-failure.log'),String(error.safeOutput));process.stderr.write('Sanitized failure detail saved under ignored data/.\n');}process.exitCode=1;}
