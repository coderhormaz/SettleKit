import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export class IntegrationError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export const CHAIN_ID = 1874;
export const TOKEN = '0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7';
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v);
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v);
const amount = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;

export interface Association {
  payment_id: string;
  checkout_reference: string;
  merchant_order_id: string;
  amount_base_units: string;
  token: string;
  chain_id: number;
  payer: string;
  merchant: string;
  state_version: number;
  confirmation_stage: 'included_2_blocks';
  eligible: boolean;
  refund_amount_base_units: string;
}
export interface PaymentEvent extends Association {
  event_id: string;
  event_type: 'payment.accepted' | 'payment.review';
  created_at: string;
}
export interface CurrentEligibility extends Association {
  status: 'accepted' | 'orphaned' | 'review' | 'pending';
  refund_hold: boolean;
  grant_expires_at: string;
}

function association(value: unknown): asserts value is Association {
  if (!record(value) || !id(value.payment_id) || !id(value.checkout_reference) || !id(value.merchant_order_id) || !amount(value.amount_base_units) || BigInt(value.amount_base_units) === 0n || !amount(value.refund_amount_base_units) || value.chain_id !== CHAIN_ID || typeof value.token !== 'string' || value.token.toLowerCase() !== TOKEN || !address(value.payer) || !address(value.merchant) || !version(value.state_version) || value.confirmation_stage !== 'included_2_blocks' || typeof value.eligible !== 'boolean') throw new IntegrationError('EVENT_INVALID');
}
export function parsePaymentEvent(raw: Buffer): PaymentEvent {
  if (raw.byteLength > 32_768) throw new IntegrationError('BODY_TOO_LARGE', 413);
  let value: unknown;
  try { value = JSON.parse(raw.toString('utf8')); } catch { throw new IntegrationError('EVENT_INVALID'); }
  association(value);
  const event = value as Association & Record<string, unknown>;
  if (!id(event.event_id) || !['payment.accepted', 'payment.review'].includes(String(event.event_type)) || typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at))) throw new IntegrationError('EVENT_INVALID');
  return event as unknown as PaymentEvent;
}
export function parseEligibility(value: unknown): CurrentEligibility {
  association(value);
  const current = value as Association & Record<string, unknown>;
  if (!['accepted', 'orphaned', 'review', 'pending'].includes(String(current.status)) || typeof current.refund_hold !== 'boolean' || typeof current.grant_expires_at !== 'string' || !Number.isFinite(Date.parse(current.grant_expires_at))) throw new IntegrationError('ELIGIBILITY_INVALID', 503);
  return current as unknown as CurrentEligibility;
}
export function verifyWebhook(raw: Buffer, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()): void {
  if (secret.length < 32) throw new IntegrationError('WEBHOOK_CONFIGURATION', 503);
  if (raw.byteLength > 32_768) throw new IntegrationError('BODY_TOO_LARGE', 413);
  if (!timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !signature || !/^v1=[0-9a-f]{64}$/.test(signature)) throw new IntegrationError('WEBHOOK_UNAUTHORIZED', 401);
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), 'hex'))) throw new IntegrationError('WEBHOOK_UNAUTHORIZED', 401);
}
export function bearerMatches(header: string | undefined, secret: string): boolean {
  if (secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7)); const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export type ReceiptDisposition = 'fulfill' | 'review' | 'superseded';
export function receiptDisposition(event: PaymentEvent, current: CurrentEligibility, now = Date.now()): ReceiptDisposition {
  for (const key of ['payment_id', 'checkout_reference', 'merchant_order_id', 'amount_base_units', 'chain_id'] as const) if (event[key] !== current[key]) throw new IntegrationError('ASSOCIATION_MISMATCH', 409);
  for (const key of ['token', 'payer', 'merchant'] as const) if (event[key].toLowerCase() !== current[key].toLowerCase()) throw new IntegrationError('ASSOCIATION_MISMATCH', 409);
  const expires = Date.parse(current.grant_expires_at);
  if (expires <= now || expires > now + 15_000) throw new IntegrationError('ELIGIBILITY_GRANT_EXPIRED', 503);
  if (event.state_version !== current.state_version) return 'superseded';
  if (event.event_type !== 'payment.accepted' || current.status !== 'accepted' || !event.eligible || !current.eligible || current.refund_hold || BigInt(current.refund_amount_base_units) !== 0n || BigInt(event.refund_amount_base_units) !== 0n) return 'review';
  return 'fulfill';
}

/** Reject non-global addresses. DNS answers are validated and pinned to this connection. */
export function isPublicAddress(value: string): boolean {
  const raw = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(raw) === 4) {
    const [a,b,c] = raw.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(raw) === 6) {
    // Global unicast only; reject mapped IPv4, loopback, unspecified, link-local and ULA.
    return /^[23][0-9a-f]{0,3}:/.test(raw) && !raw.startsWith('2001:db8:') && !raw.startsWith('2001:0:') && !raw.startsWith('2002:');
  }
  return false;
}

export async function safeJsonRequest(url: URL, options: { approvedOrigin: string; allowLocal?: boolean; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 15_000) throw new IntegrationError('TIMEOUT_CONFIGURATION',503);
  const deadline = Date.now() + timeoutMs;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(hostname);
  if (url.origin !== options.approvedOrigin || url.username || url.password || url.hash || (url.protocol !== 'https:' && !(options.allowLocal && local && url.protocol === 'http:'))) throw new IntegrationError('ENDPOINT_NOT_ALLOWED', 503);
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const answers = await Promise.race([
    isIP(hostname) ? Promise.resolve([{address:hostname,family:isIP(hostname)}]) : lookup(hostname, {all:true}),
    new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(new IntegrationError('DEPENDENCY_TIMEOUT',503)),timeoutMs);}),
  ]).catch(error=>{throw error instanceof IntegrationError ? error : new IntegrationError('DEPENDENCY_UNAVAILABLE',503);}).finally(()=>clearTimeout(dnsTimer));
  if (!answers.length || answers.some(answer => !(options.allowLocal && local) && !isPublicAddress(answer.address))) throw new IntegrationError('ENDPOINT_NOT_ALLOWED', 503);
  // A localhost override must never resolve outside loopback.
  if (local && answers.some(answer => !['127.0.0.1', '::1'].includes(answer.address))) throw new IntegrationError('ENDPOINT_NOT_ALLOWED', 503);
  const pinned = answers[0];
  const payload = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
  if (payload && payload.byteLength > 32_768) throw new IntegrationError('BODY_TOO_LARGE', 413);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new IntegrationError('DEPENDENCY_TIMEOUT',503);
  return new Promise((resolve,reject) => {
    let request: http.ClientRequest | undefined;
    let settled = false;
    const finish = (error: IntegrationError | null, value?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(totalTimer);
      if (error) reject(error); else resolve(value);
    };
    const totalTimer = setTimeout(()=>{request?.destroy();finish(new IntegrationError('DEPENDENCY_TIMEOUT',503));},remaining);
    const transport = url.protocol === 'https:' ? https : http;
    request = transport.request(url, {
      method:options.method ?? 'GET', timeout:remaining, family:pinned.family,
      headers:{accept:'application/json',...(payload ? {'content-type':'application/json','content-length':String(payload.byteLength)} : {}),...options.headers},
      lookup:((_host: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => callback(null,pinned.address,pinned.family)) as never,
    },response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { response.destroy();finish(new IntegrationError('DEPENDENCY_REJECTED', 503));return; }
      const parts: Buffer[] = [];let size = 0;
      response.on('data',(part:Buffer) => {size += part.byteLength;if(size > 32_768){response.destroy();finish(new IntegrationError('DEPENDENCY_TOO_LARGE',503));}else parts.push(part);});
      response.on('error',()=>finish(new IntegrationError('DEPENDENCY_UNAVAILABLE',503)));
      response.on('end',()=>{try{finish(null,JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown);}catch{finish(new IntegrationError('DEPENDENCY_INVALID',503));}});
    });
    request.on('timeout',()=>{request?.destroy();finish(new IntegrationError('DEPENDENCY_TIMEOUT',503));});
    request.on('error',()=>finish(new IntegrationError('DEPENDENCY_UNAVAILABLE',503)));
    if (payload) request.write(payload);request.end();
  });
}
