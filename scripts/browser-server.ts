import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDatabase, publishSnapshot } from '../packages/db/src/index.ts';
config({path:'.env',quiet:true});
if(process.env.TEST_DATABASE_ISOLATED!=='true'||!process.env.TEST_DATABASE_URL||process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error('Isolated test configuration required.');
const dev=createDatabase(process.env.DATABASE_URL!,1);const testing=createDatabase(process.env.TEST_DATABASE_URL,1);
try{const source=await dev.pool.query('select snapshot from screening_sources where source_id=$1',['ofac-sdn-ethereum-addresses']);if(source.rows[0]?.snapshot)await publishSnapshot(testing,source.rows[0].snapshot);}finally{await dev.pool.end();await testing.pool.end();}
const child=spawn(process.execPath,[fileURLToPath(new URL('../apps/gateway/node_modules/next/dist/bin/next',import.meta.url)),'start','--hostname','127.0.0.1','--port','3100'],{cwd:fileURLToPath(new URL('../apps/gateway',import.meta.url)),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,APP_ORIGIN:'http://127.0.0.1:3100',ALLOW_LOCAL_HTTP:'true'},stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>child.kill(signal));
child.once('exit',code=>{process.exitCode=code??1;});
