import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

// Argon2id with the OWASP Password Storage Cheat Sheet minimum:
// 19 MiB of memory, 2 iterations, 1 thread.
// The parameters are stored inside each hash, so they can be raised later
// without breaking existing passwords.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN_LENGTH = 12;
// Upper limit protects the server from very long inputs (hashing cost).
export const PASSWORD_MAX_LENGTH = 128;

// Length-based policy (NIST SP 800-63B): no forced symbols or digits.
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: `must be at least ${PASSWORD_MIN_LENGTH} characters` })
  .max(PASSWORD_MAX_LENGTH, { message: `must be at most ${PASSWORD_MAX_LENGTH} characters` })
  .refine((value) => value.trim().length > 0, { message: 'must not be only spaces' });

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

// Never throws: a malformed hash simply does not match.
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
