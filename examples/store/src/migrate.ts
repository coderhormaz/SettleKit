import { readFile } from 'node:fs/promises';
import { createStoreDatabase } from './store.ts';

const url=process.env.STORE_DATABASE_URL_UNPOOLED;
if(!url)throw new Error('Direct isolated store migration connection is required.');
const pool=createStoreDatabase(url);
try{await pool.query(await readFile(new URL('../migrations/001_orders.sql',import.meta.url),'utf8'));process.stdout.write('Independent store migration applied.\n');}
finally{await pool.end();}
