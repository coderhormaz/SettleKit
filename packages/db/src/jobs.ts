import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction, type Database } from './client.ts';

export interface ClaimedJob { id: string; merchant_id: string | null; kind: string; payload: Record<string, unknown>; lease_token: string; attempts: number; max_attempts: number }
export async function enqueue(client: PoolClient, kind: string, key: string, payload: Record<string, unknown>, merchantId: string | null = null): Promise<void> {
  await client.query('insert into outbox_jobs(kind,dedupe_key,payload,merchant_id) values($1,$2,$3,$4) on conflict(dedupe_key) do nothing', [kind, key, JSON.stringify(payload), merchantId]);
}

export async function claimJob(db: Database, leaseSeconds = 60): Promise<ClaimedJob | null> {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw new Error('Invalid lease duration.');
  return transaction(db, async (client) => {
    await client.query("update outbox_jobs set status='dead',last_error_code='ATTEMPT_BUDGET_EXHAUSTED' where status='processing' and lease_until < clock_timestamp() and attempts >= max_attempts");
    const result = await client.query<ClaimedJob>(`update outbox_jobs set status='processing',attempts=attempts+1,lease_token=$1,lease_until=clock_timestamp()+($2*interval '1 second') where id=(select id from outbox_jobs where ((status='pending' and available_at<=clock_timestamp()) or (status='processing' and lease_until<clock_timestamp())) and attempts<max_attempts order by available_at,created_at for update skip locked limit 1) returning id,merchant_id,kind,payload,lease_token,attempts,max_attempts`, [randomUUID(), leaseSeconds]);
    return result.rows[0] ?? null;
  });
}

export async function completeJob(db: Database, job: ClaimedJob): Promise<boolean> {
  const result = await db.pool.query("update outbox_jobs set status='completed',lease_token=null,lease_until=null where id=$1 and lease_token=$2 and status='processing' and lease_until>clock_timestamp() returning id", [job.id, job.lease_token]);
  return result.rowCount === 1;
}

export async function failJob(db: Database, job: ClaimedJob, code: string): Promise<boolean> {
  const safeCode = /^[A-Z_]{1,64}$/.test(code) ? code : 'JOB_FAILED';
  const result = await db.pool.query(`update outbox_jobs set status=case when attempts>=max_attempts then 'dead' else 'pending' end,last_error_code=$3,available_at=clock_timestamp()+(least(300,power(2,attempts))*interval '1 second'),lease_token=null,lease_until=null where id=$1 and lease_token=$2 and status='processing' and lease_until>clock_timestamp() returning id`, [job.id, job.lease_token, safeCode]);
  return result.rowCount === 1;
}
