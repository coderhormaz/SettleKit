import { writeFile,mkdir } from 'node:fs/promises';
import { database } from '../packages/db/src/index.ts';
const db=database();
try {
  const result=await db.pool.query('select snapshot,health from screening_sources where source_id=$1',['ofac-sdn-ethereum-addresses']);
  const source=result.rows[0]?.snapshot;
  if(!source)throw new Error('No validated source has been imported.');
  const server=await db.pool.query<{version:string}>("select current_setting('server_version') as version");
  const role=await db.pool.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');
  await mkdir('docs/evidence/phase-1',{recursive:true});
  await writeFile('docs/evidence/phase-1/screening-source.json',JSON.stringify({kind:'live-official-source-import-and-private-persistence',sourceId:source.sourceId,sourceUrl:source.sourceUrl,sha256:source.sha256,fetchedAt:source.fetchedAt,publishedAt:source.publishedAt,recordCount:source.recordCount,entryCount:source.entryCount,uniqueAddressCount:source.addresses.length,coverage:source.coverage,health:result.rows[0].health},null,2)+'\n');
  await writeFile('docs/evidence/phase-1/neon-foundation.json',JSON.stringify({kind:'live-neon-postgresql',observedAt:new Date().toISOString(),serverVersion:server.rows[0].version,runtimeRole:{superuser:role.rows[0].rolsuper,bypassRls:role.rows[0].rolbypassrls},tlsMode:'verify-full',runtimeConnection:'pooled, server only',migrationConnection:'direct, server only',developmentAndTestTargets:'separate branches; credentials excluded',migrations:['0000_glorious_hercules','0001_integer_amount_guard'],limitations:'No payment router, payment processing or production database claim.'},null,2)+'\n');
  process.stdout.write('Sanitized Neon and official-source provenance evidence recorded.\n');
}finally{await db.pool.end();}
