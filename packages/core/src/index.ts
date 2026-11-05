import { z } from 'zod';
import { getAddress, isAddress } from 'viem';

export const WHITECHAIN_CHAIN_ID = 1874;
export const USDT_ADDRESS = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7' as const;
export const USDT_DECIMALS = 6;
export const UINT256_MAX = (1n << 256n) - 1n;
export const addressSchema = z.string().refine((v) => isAddress(v), 'Enter a valid wallet address.').transform((v) => getAddress(v).toLowerCase());
export const baseUnitsSchema = z.string().regex(/^(0|[1-9]\d*)$/).refine((v) => v.length <= 78 && BigInt(v) <= UINT256_MAX, 'Amount exceeds uint256.');
export const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
  websiteOrigin: z.string().trim().url('Enter your website URL.').max(250),
}).strict();

export function parseUsdt(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error('Use a nonnegative USDT amount with at most six decimals.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return BigInt(baseUnitsSchema.parse(result.toString()));
}

export function formatUsdt(value: string | bigint): string {
  const amount = BigInt(baseUnitsSchema.parse(value.toString()));
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${amount / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
}

export class AppError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

export function websiteOrigin(value: string, allowLocal = false): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search || (url.pathname !== '/' && url.pathname !== '')) {
    throw new AppError('INVALID_WEBSITE', 400, 'Enter your website origin without credentials, a path or query.');
  }
  if (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) {
    throw new AppError('INVALID_WEBSITE', 400, 'Use an HTTPS website origin. Local HTTP is allowed only in local development.');
  }
  return url.origin;
}
