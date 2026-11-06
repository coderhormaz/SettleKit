import { createPublicClient, http, type Hex } from 'viem';
import { whitechainSepolia } from 'viem/chains';
import { createSiweMessage } from 'viem/siwe';
import { randomUUID } from 'node:crypto';
import { AppError, addressSchema, WHITECHAIN_CHAIN_ID } from '@settlekit/core';
import { hashToken, randomToken, runtimeConfig } from '@settlekit/core/server';
import { transaction, type Database } from './client.ts';
import { enqueue } from './jobs.ts';

export const SESSION_SECONDS = 12 * 60 * 60;
export interface AuthenticatedMerchant { id: string; owner_wallet: string }
export interface WalletChallenge { id: string; message: string; address: string; purpose: 'login' | 'settlement'; merchant_id: string | null; browser_hash: string; expires_at: Date; consumed_at: Date | null }

export async function requestChallenge(db: Database, input: { address: string; browserToken: string; purpose: 'login' | 'settlement'; merchantId?: string }) {
  const address = addressSchema.parse(input.address);
  if (!/^[a-f0-9]{64}$/.test(input.browserToken)) throw new AppError('BROWSER_REQUIRED', 400, 'Reload the page and connect again.');
  const config = runtimeConfig();
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const nonce = randomToken();
  const message = createSiweMessage({ address:address as Hex, chainId: WHITECHAIN_CHAIN_ID, domain: config.domain, uri: config.origin, version: '1', nonce, issuedAt: new Date(), expirationTime: expiresAt, statement: input.purpose === 'login' ? 'Sign in to SettleKit. This does not authorize a token transfer.' : 'Prove ownership of this SettleKit settlement wallet. This does not authorize a token transfer.', resources: [input.purpose === 'login' ? 'urn:settlekit:login' : `urn:settlekit:settlement:${input.merchantId}`] });
  return transaction(db, async (client) => {
    for (const [key, limit] of [['challenge:global', 120], [`challenge:${address}`, 10]] as const) {
      const budget = await client.query<{ count: number }>(`insert into request_budgets(key,count,reset_at) values($1,1,now()+interval '1 minute') on conflict(key) do update set count=case when request_budgets.reset_at<=now() then 1 else request_budgets.count+1 end,reset_at=case when request_budgets.reset_at<=now() then now()+interval '1 minute' else request_budgets.reset_at end returning count`, [key]);
      if (budget.rows[0].count > limit) throw new AppError('RATE_LIMITED', 429, 'Too many connection attempts. Please wait a minute and try again.');
    }
    if (input.purpose === 'settlement' && !input.merchantId) throw new AppError('SESSION_REQUIRED', 401, 'Sign in to verify a settlement wallet.');
    const id = randomUUID();
    await client.query('insert into wallet_challenges(id,address,nonce,message,purpose,merchant_id,browser_hash,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)', [id,address,nonce,message,input.purpose,input.merchantId ?? null,hashToken(input.browserToken),expiresAt]);
    return { id, message, expiresAt: expiresAt.toISOString() };
  });
}

export async function verifyChallenge(db: Database, input: { id: string; signature: Hex; browserToken: string; purpose: 'login' | 'settlement'; merchantId?: string }) {
  const { rows } = await db.pool.query<WalletChallenge>('select id,message,address,purpose,merchant_id,browser_hash,expires_at,consumed_at from wallet_challenges where id=$1', [input.id]);
  const challenge = rows[0];
  if (!challenge || challenge.purpose !== input.purpose || challenge.merchant_id !== (input.merchantId ?? null) || challenge.browser_hash !== hashToken(input.browserToken) || challenge.consumed_at || challenge.expires_at.getTime() <= Date.now()) {
    throw new AppError('CHALLENGE_INVALID', 400, 'This wallet request expired or was already used. Connect and sign again.');
  }
  const config = runtimeConfig();
  const client = createPublicClient({ chain: whitechainSepolia, transport: http(config.rpc, { timeout: 8_000, retryCount: 0 }) });
  let valid: boolean;
  try { valid = await client.verifySiweMessage({ message: challenge.message, signature: input.signature, address: challenge.address as Hex, domain: config.domain, time: new Date() }); }
  catch { throw new AppError('SIGNATURE_UNAVAILABLE', 503, 'Wallet verification is temporarily unavailable. Please try again.'); }
  if (!valid) throw new AppError('SIGNATURE_INVALID', 400, 'The signature does not match this wallet request. Connect and sign again.');
  const sessionToken = randomToken();
  return transaction(db, async (sql) => {
    const consumed = await sql.query('update wallet_challenges set consumed_at=clock_timestamp() where id=$1 and consumed_at is null and expires_at>clock_timestamp() returning id', [challenge.id]);
    if (consumed.rowCount !== 1) throw new AppError('CHALLENGE_USED', 409, 'This request was already used. Connect and sign again.');
    if (input.purpose === 'settlement') {
      await sql.query('update merchants set settlement_wallet=$1,settlement_proven_at=now(),version=version+1,updated_at=now() where id=$2', [challenge.address,input.merchantId]);
      await enqueue(sql, 'merchant.screening', `settlement:${challenge.id}`, {}, input.merchantId);
      await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'settlement.proven',$2)", [input.merchantId,JSON.stringify({wallet:challenge.address})]);
      return { merchantId: input.merchantId!, sessionToken: null };
    }
    const merchant = await sql.query<{ id: string }>('insert into merchants(owner_wallet,settlement_wallet,settlement_proven_at) values($1,$1,now()) on conflict(owner_wallet) do update set owner_wallet=excluded.owner_wallet returning id', [challenge.address]);
    const merchantId = merchant.rows[0].id;
    await sql.query("insert into merchant_sessions(token_hash,merchant_id,expires_at) values($1,$2,now()+interval '12 hours')", [hashToken(sessionToken),merchantId]);
    await sql.query("insert into audit_events(merchant_id,kind,metadata) values($1,'session.created',$2)", [merchantId,JSON.stringify({wallet:challenge.address})]);
    await enqueue(sql, 'merchant.screening', `login:${challenge.id}`, {}, merchantId);
    return { merchantId, sessionToken };
  });
}

export async function authenticate(db: Database, token: string | undefined): Promise<AuthenticatedMerchant> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new AppError('SESSION_REQUIRED', 401, 'Connect your wallet to continue.');
  const { rows } = await db.pool.query<AuthenticatedMerchant>('select m.id,m.owner_wallet from merchant_sessions s join merchants m on m.id=s.merchant_id where s.token_hash=$1 and s.expires_at>clock_timestamp()', [hashToken(token)]);
  if (!rows[0]) throw new AppError('SESSION_EXPIRED', 401, 'Your session expired. Connect your wallet again.');
  return rows[0];
}
export async function logout(db: Database, token: string | undefined): Promise<void> {
  if (token) await db.pool.query('delete from merchant_sessions where token_hash=$1', [hashToken(token)]);
}
