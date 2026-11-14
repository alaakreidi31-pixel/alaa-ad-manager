import { createHash, randomInt } from 'node:crypto';

// One-time backup codes, for when the phone with the authenticator app is lost.
// Shown ONCE at setup; only their SHA-256 hash is stored (the codes are random,
// so a fast hash is enough, like the refresh tokens).

export const RECOVERY_CODE_COUNT = 10;
// No 0/O, 1/I/L, U: easy to read and to type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 10;

// Format shown to the user: XXXXX-XXXXX
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

// Spaces, dashes and lowercase letters are accepted when typing a code.
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function isRecoveryCodeFormat(normalized: string): boolean {
  return normalized.length === CODE_LENGTH && [...normalized].every((c) => ALPHABET.includes(c));
}

export function hashRecoveryCode(input: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(input)).digest('hex');
}
