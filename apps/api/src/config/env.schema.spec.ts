import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.schema';

const VALID_URL = 'postgresql://user:secret@localhost:5432/test_db';

describe('parseEnv (configuration guard)', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL });
    expect(env).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_URL: VALID_URL,
    });
  });

  it('converts PORT from text to a number', () => {
    expect(parseEnv({ DATABASE_URL: VALID_URL, PORT: '4000' }).PORT).toBe(4000);
  });

  it('refuses to start without DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL: is required/);
  });

  it('refuses a DATABASE_URL that is not PostgreSQL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/postgresql:\/\//);
  });

  it('refuses an invalid PORT', () => {
    expect(() => parseEnv({ DATABASE_URL: VALID_URL, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('refuses an unknown NODE_ENV', () => {
    expect(() => parseEnv({ DATABASE_URL: VALID_URL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
