import { execFileSync } from 'node:child_process';
import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Compare actual local credentials without printing them, including on failure.
const secrets=new Set<string>();
for(const source of ['.env','data/cre-simulation.env','data/cre-recovery.env']){
  try{const env=await readFile(source,'utf8');for(const line of env.split(/\r?\n/)){const match=line.match(/^([A-Z_]+)=(.*)$/);if(!match||!/(KEY|SECRET|TOKEN|DATABASE_URL)/.test(match[1]))continue;const value=match[2].replace(/^['"]|['"]$/g,'');if(value.length>=24){secrets.add(value);if(/^0x[a-f0-9]{64}$/i.test(value))secrets.add(value.slice(2));if(value.startsWith('postgres')){try{const password=decodeURIComponent(new URL(value).password);if(password.length>=16)secrets.add(password);}catch{/* Configuration validation lives in the runtime. */}}}}}catch{/* CI has no private local files. */}
}
try{const wallets=JSON.parse(await readFile('data/phase-1-wallets.json','utf8')) as Record<string,{privateKey?:string}>;for(const wallet of Object.values(wallets))if(wallet.privateKey){secrets.add(wallet.privateKey);secrets.add(wallet.privateKey.slice(2));}}catch{/* Optional test-only local file. */}
let findings=0;let checked=0;
function inspect(path:string,data:Buffer){checked++;if([...secrets].some(secret=>data.includes(Buffer.from(secret)))){findings++;process.stderr.write(`Local credential matched in ${path}\n`);}}
const staged=execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACM','-z']).toString().split('\0').filter(Boolean);
for(const path of staged)inspect(path,execFileSync('git',['show',`:${path}`],{maxBuffer:32*1024*1024}));
async function clientFiles(directory:string){for(const item of await readdir(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())await clientFiles(path);else inspect(path,await readFile(path));}}
for(const directory of ['apps/gateway/.next/static','apps/accountant/.next/static']){
  try{await clientFiles(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;/* No generated client build in a clean checkout. */}
}
process.stdout.write(`Credential scan: ${checked} staged/client files; ${findings} findings.\n`);if(findings)process.exitCode=1;
