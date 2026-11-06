import { AppError, profileSchema, websiteOrigin } from '@settlekit/core';
import { runtimeConfig } from '@settlekit/core/server';
import { transaction, type Database } from './client.ts';
import { enqueue } from './jobs.ts';
import { currentScreening } from './screening.ts';

export interface MerchantRow { id: string; owner_wallet: string; display_name: string; website_origin: string; settlement_wallet: string; settlement_proven_at: Date; version: number; updated_at: Date }
export async function merchantProfile(db: Database, merchantId: string) {
  const { rows } = await db.pool.query<MerchantRow>('select id,owner_wallet,display_name,website_origin,settlement_wallet,settlement_proven_at,version,updated_at from merchants where id=$1', [merchantId]);
  const merchant = rows[0];
  if (!merchant) throw new AppError('MERCHANT_NOT_FOUND', 404, 'Business setup was not found. Sign in again.');
  const screening = await currentScreening(db, merchantId);
  return { id: merchant.id, ownerWallet: merchant.owner_wallet, displayName: merchant.display_name, websiteOrigin: merchant.website_origin, settlementWallet: merchant.settlement_wallet, settlementProvenAt: merchant.settlement_proven_at.toISOString(), version: merchant.version, updatedAt: merchant.updated_at.toISOString(), screening };
}

export async function updateMerchant(db: Database, merchantId: string, payload: unknown) {
  const parsed = profileSchema.parse(payload);
  const origin = websiteOrigin(parsed.websiteOrigin, runtimeConfig().allowLocal);
  await transaction(db, async (sql) => {
    const result = await sql.query<{version:number}>('update merchants set display_name=$1,website_origin=$2,version=version+1,updated_at=now() where id=$3 returning version', [parsed.displayName,origin,merchantId]);
    if (result.rowCount !== 1) throw new AppError('MERCHANT_NOT_FOUND', 404, 'Business setup was not found.');
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'profile.saved',$2)", [merchantId,JSON.stringify({fields:['displayName','websiteOrigin']})]);
    await enqueue(sql, 'merchant.screening', `profile:${merchantId}:${result.rows[0].version}`, {}, merchantId);
  });
  return merchantProfile(db, merchantId);
}
