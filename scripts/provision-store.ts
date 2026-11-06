// Local operator setup. Prints no credentials; never run against a shared project.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../packages/db/src/client.ts';
const envPath=new URL('../.env',import.meta.url);let env=await readFile(envPath,'utf8');
if(process.env.TEST_DATABASE_ISOLATED!=='true')throw new Error('Explicit isolated configuration required.');
const additions:Record<string,string>={};
for(const testing of [true,false]){
  const prefix=testing?'TEST_STORE_':'STORE_';if(process.env[`${prefix}DATABASE_URL`])continue;
  const owner=new URL((testing?process.env.TEST_DATABASE_URL_UNPOOLED:process.env.DATABASE_URL_UNPOOLED)!);
  owner.pathname=testing?'/settlekit_store_test':'/settlekit_store';
  const db=createDatabase(owner.toString(),1);const role=testing?'settlekit_store_test_app':'settlekit_store_app';const password=randomBytes(32).toString('hex');
  try{
    for(const file of ['001_orders.sql','002_development_failures.sql'])await db.pool.query(await readFile(new URL(`../examples/store/migrations/${file}`,import.meta.url),'utf8'));
    if(!(await db.pool.query('select 1 from pg_roles where rolname=$1',[role])).rowCount)await db.pool.query(`create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    else throw new Error('Role already exists; preserve its credential and configure locally instead of resetting it.');
    await db.pool.query(`grant usage on schema public to ${role}`);
    await db.pool.query(`grant select,insert,update,delete on all tables in schema public to ${role}`);
    await db.pool.query(`alter default privileges for role settlekit_owner in schema public grant select,insert,update,delete on tables to ${role}`);
    const runtime=new URL(owner);runtime.hostname=new URL((testing?process.env.TEST_DATABASE_URL:process.env.DATABASE_URL)!).hostname;runtime.username=role;runtime.password=password;
    additions[`${prefix}DATABASE_URL`]=runtime.toString();additions[`${prefix}DATABASE_URL_UNPOOLED`]=owner.toString();
  }finally{await db.pool.end();}
}
for(const [key,value]of Object.entries(additions)){const line=new RegExp(`^${key}=.*$`,'m');env=line.test(env)?env.replace(line,()=>`${key}=${value}`):`${env.trimEnd()}\n${key}=${value}\n`;}
await writeFile(envPath,env);process.stdout.write('Separate store databases migrated and limited runtime credentials saved locally.\n');
