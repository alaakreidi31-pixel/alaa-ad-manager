import { describe, expect, it } from 'vitest';
import { hashPassword, PasswordSchema, verifyPassword } from './password';

const PASSWORD = 'correct horse battery';

describe('password hashing (argon2id)', () => {
  it('produces an argon2id hash with the OWASP parameters', async () => {
    const hashed = await hashPassword(PASSWORD);
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(hashed).toContain('m=19456,t=2,p=1');
  });

  it('never contains the password itself', async () => {
    const hashed = await hashPassword(PASSWORD);
    expect(hashed).not.toContain(PASSWORD);
  });

  it('uses a random salt: the same password gives different hashes', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const hashed = await hashPassword(PASSWORD);
    expect(await verifyPassword(hashed, PASSWORD)).toBe(true);
    expect(await verifyPassword(hashed, 'correct horse battery!')).toBe(false);
  });

  it('returns false (does not throw) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
  });
});

describe('password policy', () => {
  it('accepts 12 characters or more', () => {
    expect(PasswordSchema.safeParse('a'.repeat(12)).success).toBe(true);
  });

  it('rejects fewer than 12 characters', () => {
    expect(PasswordSchema.safeParse('a'.repeat(11)).success).toBe(false);
  });

  it('rejects more than 128 characters', () => {
    expect(PasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('rejects a password made only of spaces', () => {
    expect(PasswordSchema.safeParse(' '.repeat(12)).success).toBe(false);
  });
});
