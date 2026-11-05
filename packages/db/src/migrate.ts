import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.ts';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error('Direct migration connection is required.');
const db = createDatabase(url, 1);
try {
  await migrate(db.orm, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  process.stdout.write('PostgreSQL migrations applied successfully.\n');
} finally { await db.pool.end(); }
