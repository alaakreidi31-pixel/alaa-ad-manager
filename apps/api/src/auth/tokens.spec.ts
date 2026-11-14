import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken, readBearerToken, readCookie } from './tokens';

describe('refresh tokens', () => {
  it('are random and long', () => {
    const a = generateRefreshToken();
    expect(a).not.toBe(generateRefreshToken());
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('are hashed deterministically, and the hash differs from the token', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toContain(token);
  });
});

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; alaa_refresh=abc; b=2', 'alaa_refresh')).toBe('abc');
  });

  it('returns undefined when missing', () => {
    expect(readCookie('a=1', 'alaa_refresh')).toBeUndefined();
    expect(readCookie(undefined, 'alaa_refresh')).toBeUndefined();
  });

  it('does not match a cookie whose name only starts the same', () => {
    expect(readCookie('alaa_refresh_old=x', 'alaa_refresh')).toBeUndefined();
  });
});

describe('readBearerToken', () => {
  it('reads a Bearer token', () => {
    expect(readBearerToken('Bearer abc.def')).toBe('abc.def');
  });

  it('rejects other schemes and empty values', () => {
    expect(readBearerToken('Basic abc')).toBeUndefined();
    expect(readBearerToken('Bearer')).toBeUndefined();
    expect(readBearerToken(undefined)).toBeUndefined();
  });
});
