import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.schema';

const VALID_URL = 'postgresql://user:secret@localhost:5432/test_db';
const SECRET = 'x'.repeat(32);
const TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
const BASE = {
  DATABASE_URL: VALID_URL,
  JWT_ACCESS_SECRET: SECRET,
  TOTP_ENCRYPTION_KEY: TOTP_KEY,
};

describe('parseEnv (configuration guard)', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const env = parseEnv(BASE);
    expect(env).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_URL: VALID_URL,
      JWT_ACCESS_SECRET: SECRET,
      TOTP_ENCRYPTION_KEY: TOTP_KEY,
    });
  });

  it('converts PORT from text to a number', () => {
    expect(parseEnv({ ...BASE, PORT: '4000' }).PORT).toBe(4000);
  });

  it('refuses to start without DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL: is required/);
  });

  it('refuses to start without JWT_ACCESS_SECRET', () => {
    expect(() => parseEnv({ DATABASE_URL: VALID_URL })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses a JWT_ACCESS_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...BASE, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('refuses to start without TOTP_ENCRYPTION_KEY', () => {
    expect(() => parseEnv({ ...BASE, TOTP_ENCRYPTION_KEY: undefined })).toThrow(
      /TOTP_ENCRYPTION_KEY/,
    );
  });

  it('refuses a TOTP_ENCRYPTION_KEY that is not 32 bytes', () => {
    const short = Buffer.alloc(16).toString('base64');
    expect(() => parseEnv({ ...BASE, TOTP_ENCRYPTION_KEY: short })).toThrow(/32 random bytes/);
  });

  it('refuses a DATABASE_URL that is not PostgreSQL', () => {
    expect(() => parseEnv({ ...BASE, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /postgresql:\/\//,
    );
  });

  it('refuses an invalid PORT', () => {
    expect(() => parseEnv({ ...BASE, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('refuses an unknown NODE_ENV', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
