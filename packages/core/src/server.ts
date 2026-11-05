import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './index.ts';

export const randomToken = () => randomBytes(32).toString('hex');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function encryptSecret(value: string, hexKey: string, context: string): string {
  const key = Buffer.from(z.string().regex(/^[a-f0-9]{64}$/i).parse(hexKey), 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(value: string, hexKey: string, context: string): string {
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid protected value.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(z.string().regex(/^[a-f0-9]{64}$/i).parse(hexKey), 'hex'), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function runtimeConfig() {
  const origin = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(local && process.env.ALLOW_LOCAL_HTTP === 'true'))) {
    throw new AppError('CONFIGURATION_UNAVAILABLE', 503, 'The service configuration needs attention.');
  }
  return { origin: origin.origin, domain: origin.host, secureCookies: origin.protocol === 'https:', allowLocal: local && process.env.ALLOW_LOCAL_HTTP === 'true', rpc: process.env.WHITECHAIN_RPC_URL ?? 'https://rpc.testnet.whitechain.io' };
}

export function requireMutationOrigin(origin: string | null): void {
  if (origin !== runtimeConfig().origin) throw new AppError('ORIGIN_DENIED', 403, 'Reload SettleKit and try again.');
}

export function publicError(error: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (error instanceof AppError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  if (error instanceof z.ZodError) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: error.issues.map((i) => i.message).join(' ') } } };
  return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'We could not complete that request. Your saved setup is safe. Please try again.' } } };
}
