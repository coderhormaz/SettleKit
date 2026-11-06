/** Explicit operator backup/isolated restore. Does not install tools or create databases. */
import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {rootCertificates} from 'node:tls';

const root=fileURLToPath(new URL('../',import.meta.url));config({path:join(root,'.env'),quiet:true});
const backupDirectory=join(root,'data','backups');
class BackupError extends Error{constructor(readonly code:string){super(code);}}
type DatabaseChoice='gateway'|'store';
interface Manifest {version:1;database:DatabaseChoice;format:'custom';createdAt:string;sourceFingerprint:string;sha256:string;postgresClientMajor:17}
function inside(parent:string,target:string){const value=relative(parent,target);return value===''||(!value.startsWith('..')&&!isAbsolute(value));}
function connection(name:string):URL{
  let url:URL;try{url=new URL(process.env[name]??'');}catch{throw new BackupError(`CONFIGURATION_${name}`);}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||url.hostname.includes('-pooler')||url.searchParams.get('sslmode')!=='verify-full'||!url.username||!url.password||!url.pathname.slice(1))throw new BackupError(`CONFIGURATION_${name}`);
  return url;
}
const host=(url:URL)=>url.hostname.toLowerCase().replace(/-pooler(?=\.|$)/,'');
const databaseName=(url:URL)=>decodeURIComponent(url.pathname.slice(1));
const identity=(url:URL)=>`${host(url)}:${url.port||'5432'}/${databaseName(url)}`;
const fingerprint=(url:URL)=>createHash('sha256').update(identity(url)).digest('hex');
async function pgEnvironment(url:URL):Promise<NodeJS.ProcessEnv>{
  const env:NodeJS.ProcessEnv={...process.env};for(const key of ['PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS','PGHOSTADDR','PGTARGETSESSIONATTRS'])delete env[key];
  let certificates=process.env.PGSSLROOTCERT||'system';
  // libpq's OpenSSL system bundle is often absent on Windows. Export only the
  // installed Node runtime's public trust roots; keep hostname verification and
  // allow an explicit private CA bundle through PGSSLROOTCERT.
  if(!process.env.PGSSLROOTCERT&&process.platform==='win32'){
    const directory=await backupsPath(),content=rootCertificates.join('\n')+'\n';certificates=join(directory,`public-ca-${createHash('sha256').update(content).digest('hex').slice(0,16)}.pem`);
    try{await writeFile(certificates,content,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(!inside(directory,await realpath(certificates))||await readFile(certificates,'utf8')!==content)throw new BackupError('POSTGRES_TRUST_BUNDLE_CONFLICT');}
  }
  return {...env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:databaseName(url),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:certificates,PGCONNECT_TIMEOUT:'10',PGAPPNAME:'SettleKit explicit local backup/restore'};
}
async function trustedTool(name:'pg_dump'|'pg_restore'){
  const override=process.env[name==='pg_dump'?'PG_DUMP_PATH':'PG_RESTORE_PATH'];const executable=process.platform==='win32'?`${name}.exe`:name;
  const candidates=override?[resolve(override)]:[...(process.env.PATH??'').split(delimiter).filter(Boolean).map(directory=>join(directory,executable)),...(process.platform==='win32'?[join(process.env.ProgramFiles??'C:\\Program Files','PostgreSQL','17','bin',executable)]:[])];
  for(const path of candidates){try{await access(path,process.platform==='win32'?constants.F_OK:constants.X_OK);return path;}catch{/* Try the next existing installed binary. */}}
  throw new BackupError(`POSTGRES17_${name.toUpperCase()}_NOT_FOUND`);
}
async function runTool(path:string,args:string[],env:NodeJS.ProcessEnv,version=false){
  return new Promise<string>((resolve,reject)=>{
    const child=spawn(path,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';let diagnostic='';let timeout=false;
    const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL');},version?5000:15*60_000);
    child.stdout?.on('data',part=>{if(version&&output.length<4096)output+=part.toString();});child.stderr?.on('data',part=>{if(diagnostic.length<65536)diagnostic+=part.toString();});
    child.once('error',()=>{clearTimeout(timer);reject(new BackupError('POSTGRES_TOOL_UNAVAILABLE'));});
    child.once('exit',code=>{clearTimeout(timer);if(code!==0||timeout){const reason=timeout?'POSTGRES_OPERATION_TIMEOUT':/certificate|sslrootcert|root cert/i.test(diagnostic)?'POSTGRES_TLS_CONFIGURATION':/password authentication|no password|authentication failed/i.test(diagnostic)?'POSTGRES_AUTHENTICATION_FAILED':/permission denied|must be owner/i.test(diagnostic)?'POSTGRES_PERMISSION_DENIED':/already exists/i.test(diagnostic)?'RESTORE_TARGET_NOT_EMPTY':/could not connect|connection.*failed|timeout|network/i.test(diagnostic)?'POSTGRES_CONNECTION_UNAVAILABLE':'POSTGRES_OPERATION_FAILED';reject(new BackupError(reason));}else resolve(output);});
  });
}
async function version17(path:string){const value=await runTool(path,['--version'],process.env,true);if(!/\(PostgreSQL\) 17(?:\.|\s|$)/.test(value))throw new BackupError('POSTGRES17_CLIENT_REQUIRED');}
async function backupsPath(){await mkdir(backupDirectory,{recursive:true});const actual=await realpath(backupDirectory);if(!inside(await realpath(root),actual))throw new BackupError('BACKUP_PATH_OUTSIDE_WORKSPACE');return actual;}
async function sha256(path:string){const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');}
function argumentsFor(){
  const action=process.argv[2];const values=new Map<string,string>();
  for(let i=3;i<process.argv.length;i+=2){const key=process.argv[i];const value=process.argv[i+1];if(!['--database','--file','--confirm-target'].includes(key)||!value||values.has(key))throw new BackupError('USAGE_BACKUP_OR_RESTORE');values.set(key,value);}
  const choice=values.get('--database');if((action!=='backup'&&action!=='restore')||(choice!=='gateway'&&choice!=='store'))throw new BackupError('USAGE_BACKUP_OR_RESTORE');
  return {action,database:choice as DatabaseChoice,file:values.get('--file'),confirmTarget:values.get('--confirm-target')};
}
async function backup(database:DatabaseChoice){
  const source=connection(database==='gateway'?'DATABASE_URL_UNPOOLED':'STORE_DATABASE_URL_UNPOOLED');
  const tool=await trustedTool('pg_dump');await version17(tool);const directory=await backupsPath();
  const name=`${database}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}.dump`;const target=join(directory,name);const partial=target+'.partial';
  const file=await open(partial,'wx',0o600);await file.close();
  try{
    await runTool(tool,['--format=custom','--no-owner','--no-acl',`--file=${partial}`],await pgEnvironment(source));
    await rename(partial,target);await chmod(target,0o600);
    const manifest:Manifest={version:1,database,format:'custom',createdAt:new Date().toISOString(),sourceFingerprint:fingerprint(source),sha256:await sha256(target),postgresClientMajor:17};
    await writeFile(target+'.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
    process.stdout.write(`Backup created under ignored data/backups/: ${name}\nThis contains private operating data. No restore or database creation was performed.\n`);
  }catch(error){try{await unlink(partial);}catch{/* A successfully renamed archive is retained if later manifest persistence fails. */}throw error;}
}
async function restore(database:DatabaseChoice,fileName:string|undefined,confirmation:string|undefined){
  if(process.env.TEST_DATABASE_ISOLATED!=='true')throw new BackupError('EXPLICIT_TEST_ISOLATION_REQUIRED');
  const target=connection('RESTORE_DATABASE_URL_UNPOOLED');const targetName=databaseName(target);
  if(!/^settlekit_restore_[a-z0-9_]+$/.test(targetName)||targetName.length>63||confirmation!==targetName)throw new BackupError('RESTORE_TARGET_NAME_CONFIRMATION_REQUIRED');
  const testing=connection(database==='gateway'?'TEST_DATABASE_URL_UNPOOLED':'TEST_STORE_DATABASE_URL_UNPOOLED');
  if(host(target)!==host(testing)||(target.port||'5432')!==(testing.port||'5432'))throw new BackupError('RESTORE_REQUIRES_SELECTED_ISOLATED_TEST_HOST');
  for(const name of ['DATABASE_URL','DATABASE_URL_UNPOOLED','STORE_DATABASE_URL','STORE_DATABASE_URL_UNPOOLED','TEST_DATABASE_URL','TEST_DATABASE_URL_UNPOOLED','TEST_STORE_DATABASE_URL','TEST_STORE_DATABASE_URL_UNPOOLED']){
    if(!process.env[name])continue;let existing:URL;try{existing=new URL(process.env[name]!);}catch{throw new BackupError('EXISTING_DATABASE_CONFIGURATION_INVALID');}
    if(identity(existing)===identity(target))throw new BackupError('RESTORE_CANNOT_TARGET_EXISTING_APP_DATABASE');
    if(['DATABASE_URL','DATABASE_URL_UNPOOLED','STORE_DATABASE_URL','STORE_DATABASE_URL_UNPOOLED'].includes(name)&&host(existing)===host(target))throw new BackupError('RESTORE_TEST_HOST_IS_NOT_DISTINCT_FROM_DEFAULT');
  }
  if(!fileName)throw new BackupError('RESTORE_ARCHIVE_REQUIRED');
  const directory=await backupsPath();const archive=await realpath(resolve(root,fileName));if(!inside(directory,archive)||!archive.endsWith('.dump'))throw new BackupError('RESTORE_ARCHIVE_OUTSIDE_BACKUPS');
  const manifest=JSON.parse(await readFile(archive+'.json','utf8')) as Manifest;
  if(manifest.version!==1||manifest.format!=='custom'||manifest.postgresClientMajor!==17||manifest.database!==database||!/^[a-f0-9]{64}$/.test(manifest.sourceFingerprint)||manifest.sourceFingerprint===fingerprint(target)||manifest.sha256!==await sha256(archive))throw new BackupError('RESTORE_MANIFEST_OR_ARCHIVE_MISMATCH');
  const tool=await trustedTool('pg_restore');await version17(tool);
  // No --clean, --create, DROP or arbitrary SQL. A pre-created empty, explicit
  // restore database is required. Any restore error rolls back the transaction.
  await runTool(tool,[`--dbname=${targetName}`,'--single-transaction','--exit-on-error','--no-owner','--no-acl',archive],await pgEnvironment(target));
  await writeFile(join(directory,`restore-${new Date().toISOString().replace(/[:.]/g,'-')}.json`),JSON.stringify({version:1,restoredAt:new Date().toISOString(),archive:basename(archive),targetFingerprint:fingerprint(target),database,transactional:true},null,2)+'\n',{mode:0o600});
  process.stdout.write('Restore completed into the explicitly named isolated restore database. Runtime app URLs were not changed.\n');
}
async function main(){const args=argumentsFor();if(args.action==='backup'){if(args.file||args.confirmTarget)throw new BackupError('BACKUP_OUTPUT_IS_MANAGED');await backup(args.database);}else await restore(args.database,args.file,args.confirmTarget);}
await main().catch(error=>{process.stderr.write(`DATABASE_BACKUP_${error instanceof BackupError?error.code:'UNAVAILABLE'}\n`);process.exitCode=1;});
