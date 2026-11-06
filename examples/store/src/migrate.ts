import { readFile } from 'node:fs/promises';
import { createStoreDatabase } from './store.ts';

const testing=process.argv.includes('--test');
if(testing&&(process.env.TEST_DATABASE_ISOLATED!=='true'||process.env.TEST_STORE_DATABASE_URL_UNPOOLED===process.env.STORE_DATABASE_URL_UNPOOLED))throw new Error('An isolated store test target is required.');
const url=testing?process.env.TEST_STORE_DATABASE_URL_UNPOOLED:process.env.STORE_DATABASE_URL_UNPOOLED;
if(!url)throw new Error('Direct isolated store migration connection is required.');
const pool=createStoreDatabase(url);
try{for(const file of ['001_orders.sql','002_development_failures.sql'])await pool.query(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));process.stdout.write('Independent store migrations applied.\n');}
finally{await pool.end();}
