import { describe, expect, it } from 'vitest';
import { baseUnitsSchema, formatUsdt, parseUsdt, UINT256_MAX, websiteOrigin } from '../src/index.ts';
import { decryptSecret, encryptSecret, hashToken, publicError, randomToken } from '../src/server.ts';

describe('exact money and private boundaries', () => {
  it('preserves six-decimal amounts and uint256 precision', () => {
    expect(parseUsdt('25.000001')).toBe(25_000_001n);
    expect(formatUsdt(25_000_001n)).toBe('25.000001');
    expect(baseUnitsSchema.parse(UINT256_MAX.toString())).toBe(UINT256_MAX.toString());
    for (const value of ['-1', '01', '1e6', '0.0000001', 'NaN']) expect(() => parseUsdt(value)).toThrow();
    expect(() => baseUnitsSchema.parse((UINT256_MAX + 1n).toString())).toThrow();
  });
  it('uses authenticated encryption bound to its tenant/context', () => {
    const key = randomToken();
    const encrypted = encryptSecret('private webhook configuration', key, 'merchant:A');
    expect(decryptSecret(encrypted, key, 'merchant:A')).toBe('private webhook configuration');
    expect(() => decryptSecret(encrypted, key, 'merchant:B')).toThrow();
    expect(hashToken(randomToken())).toMatch(/^[a-f0-9]{64}$/);
  });
  it('allows only safe configured origins and redacts internal failures', () => {
    expect(websiteOrigin('https://studio.example/')).toBe('https://studio.example');
    for (const url of ['http://studio.example','https://name:secret@studio.example','https://studio.example/private']) expect(() => websiteOrigin(url)).toThrow();
    expect(publicError(new Error('postgres://user:secret@database'))).not.toEqual(expect.objectContaining({body:expect.stringContaining('secret')}));
    expect(JSON.stringify(publicError(new Error('private credential')))).not.toContain('credential');
  });
});
