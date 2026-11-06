import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { AppError } from '@settlekit/core';
import * as schema from './schema.ts';

export function createDatabase(connectionString: string, max = 4) {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new AppError('DATABASE_CONFIGURATION', 503, 'Database configuration needs attention.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || url.searchParams.get('sslmode') !== 'verify-full') {
    throw new AppError('DATABASE_CONFIGURATION', 503, 'Database configuration needs attention.');
  }
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, allowExitOnIdle: true, query_timeout: 15_000 });
  // Errors on idle sockets are handled without leaking a connection string.
  pool.on('error', () => { process.stderr.write('Database idle connection interrupted; the next request will reconnect.\n'); });
  return { pool, orm: drizzle(pool, { schema }) };
}
export type Database = ReturnType<typeof createDatabase>;
let shared: Database | undefined;
export function database(): Database {
  if (!process.env.DATABASE_URL) throw new AppError('DATABASE_UNAVAILABLE', 503, 'The service is temporarily unavailable. Please try again.');
  return shared ??= createDatabase(process.env.DATABASE_URL);
}

export async function transaction<T>(db: Database, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    await client.query("set local statement_timeout = '10s'");
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try { await client.query('rollback'); } catch { /* The failed connection is discarded below. */ }
    throw error;
  } finally { client.release(); }
}
