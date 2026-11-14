import { randomInt } from 'node:crypto';

// Temporary passwords for new client accounts and password resets (ADR 0016).
// Shown ONCE to the administrator, stored only as an argon2id hash, and must
// be replaced at the first login. Never written to any log.

// No 0/O, 1/I/l: easy to read aloud or copy by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const GROUPS = 4;
const GROUP_LENGTH = 5;

// Format: xxxxx-xxxxx-xxxxx-xxxxx (23 characters, about 117 bits of randomness).
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i += 1) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}
