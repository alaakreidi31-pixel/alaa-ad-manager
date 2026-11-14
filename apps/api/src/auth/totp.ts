import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (RFC 6238), the algorithm used by Google Authenticator:
// HMAC-SHA1, 6 digits, a new code every 30 seconds.
// Written with Node's built-in crypto (no extra library) and verified against
// the official RFC 6238 test vectors in totp.spec.ts.

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
// Accept the previous and the next code too (phone clock slightly off).
export const TOTP_WINDOW = 1;

// RFC 4648 Base32: the format authenticator apps expect for the secret.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid Base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 20 random bytes (160 bits), the size recommended by RFC 4226.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentTimeStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

// The code for one 30-second time step.
export function totpCode(secret: Buffer, timeStep: number, digits: number = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// Returns the time step the code belongs to (within the allowed window),
// or null when it matches none. The step is used to refuse a code used twice.
export function findTotpTimeStep(
  secretBase32: string,
  code: string,
  nowMs: number = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = currentTimeStep(nowMs);
  let found: number | null = null;
  // Every candidate is checked (no early exit) with a constant-time comparison.
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step += 1) {
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && found === null) found = step;
  }
  return found;
}

// The link encoded in the QR code that the authenticator app scans.
export function buildOtpAuthUri(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
