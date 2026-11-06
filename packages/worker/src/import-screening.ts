import { importCurrentOfac, ScreeningSourceError } from '@settlekit/screening';
import { database, publishSnapshot, recordSourceFailure } from '@settlekit/db';
const db=database();
try {
  const snapshot=await importCurrentOfac();
  await publishSnapshot(db,snapshot);
  process.stdout.write(JSON.stringify({source:snapshot.sourceId,hash:snapshot.sha256,fetchedAt:snapshot.fetchedAt,records:snapshot.recordCount,identifiers:snapshot.entryCount})+'\n');
}catch(error){const code=error instanceof ScreeningSourceError?error.code:'SOURCE_IMPORT_FAILED';await recordSourceFailure(db,code);process.stderr.write(code+'\n');process.exitCode=1;}
finally{await db.pool.end();}
