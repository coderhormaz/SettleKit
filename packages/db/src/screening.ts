import { evaluateWallet, OFAC_SOURCE_ID, type SourceSnapshot, type ProviderHealth, type ScreeningDecision } from '@settlekit/screening';
import { AppError } from '@settlekit/core';
import { transaction, type Database } from './client.ts';

interface SourceRow { snapshot: SourceSnapshot | null; health: ProviderHealth }
export async function publishSnapshot(db: Database, snapshot: SourceSnapshot): Promise<void> {
  const health: ProviderHealth = { state: 'available', checkedAt: snapshot.fetchedAt };
  await db.pool.query(`insert into screening_sources(source_id,snapshot,health,fetched_at) values($1,$2,$3,$4) on conflict(source_id) do update set snapshot=excluded.snapshot,health=excluded.health,fetched_at=excluded.fetched_at,updated_at=clock_timestamp() where (screening_sources.fetched_at is null or screening_sources.fetched_at<=excluded.fetched_at) and (screening_sources.health->>'checkedAt')::timestamptz<=excluded.fetched_at`, [snapshot.sourceId,JSON.stringify(snapshot),JSON.stringify(health),snapshot.fetchedAt]);
}
export async function recordSourceFailure(db: Database, code: string): Promise<void> {
  const health: ProviderHealth = {state:'unavailable',checkedAt:new Date().toISOString(),reasonCode:/^[A-Z_]{1,64}$/.test(code)?code:'SOURCE_IMPORT_FAILED'};
  await db.pool.query('insert into screening_sources(source_id,health) values($1,$2) on conflict(source_id) do update set health=excluded.health,updated_at=clock_timestamp()', [OFAC_SOURCE_ID,JSON.stringify(health)]);
}
export async function currentScreening(db: Database, merchantId: string): Promise<ScreeningDecision> {
  // Re-evaluate from the current required source; an old allowed row cannot mask an outage.
  const { rows } = await db.pool.query<SourceRow & {settlement_wallet:string}>('select m.settlement_wallet,s.snapshot,s.health from merchants m left join screening_sources s on s.source_id=$2 where m.id=$1',[merchantId,OFAC_SOURCE_ID]);
  if (!rows[0]) throw new AppError('MERCHANT_NOT_FOUND',404,'Business setup was not found.');
  const row=rows[0];
  return evaluateWallet({address:row.settlement_wallet,snapshot:row.snapshot,providerHealth:row.health ?? {state:'unavailable',checkedAt:new Date().toISOString(),reasonCode:'SOURCE_MISSING'}});
}
export async function refreshMerchantScreening(db: Database, merchantId: string): Promise<ScreeningDecision> {
  return transaction(db, async(sql)=>{
    const merchant=await sql.query<{settlement_wallet:string}>('select settlement_wallet from merchants where id=$1 for update',[merchantId]);
    if(!merchant.rows[0])throw new AppError('MERCHANT_NOT_FOUND',404,'Business setup was not found.');
    const source=await sql.query<SourceRow>('select snapshot,health from screening_sources where source_id=$1',[OFAC_SOURCE_ID]);
    const row=source.rows[0];
    const decision=evaluateWallet({address:merchant.rows[0].settlement_wallet,snapshot:row?.snapshot ?? null,providerHealth:row?.health ?? {state:'unavailable',checkedAt:new Date().toISOString(),reasonCode:'SOURCE_MISSING'}});
    await sql.query('insert into screening_decisions(merchant_id,wallet,decision,valid_until) values($1,$2,$3,$4)',[merchantId,merchant.rows[0].settlement_wallet,JSON.stringify(decision),decision.expiresAt]);
    return decision;
  });
}
