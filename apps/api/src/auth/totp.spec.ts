import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  currentTimeStep,
  findTotpTimeStep,
  generateTotpSecret,
  totpCode,
} from './totp';

// RFC 6238, Appendix B (SHA-1): secret = ASCII "12345678901234567890"
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('matches the official test vector at %i seconds', (seconds, code) => {
    expect(totpCode(RFC_SECRET, currentTimeStep(seconds * 1000), 8)).toBe(code);
  });

  it('produces the 6-digit code used by Google Authenticator', () => {
    expect(totpCode(RFC_SECRET, currentTimeStep(59_000))).toBe('287082');
  });

  it('Base32 round-trips and matches RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
  });

  it('refuses invalid Base32', () => {
    expect(() => base32Decode('not-base32!')).toThrow('Invalid Base32 secret');
  });

  it('generates a random 160-bit secret', () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(a);
  });

  describe('findTotpTimeStep', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_700_000_000_000;
    const step = currentTimeStep(now);
    const codeAt = (s: number) => totpCode(RFC_SECRET, s);

    it('accepts the current code and returns its time step', () => {
      expect(findTotpTimeStep(secret, codeAt(step), now)).toBe(step);
    });

    it('accepts the previous and next code (clock drift)', () => {
      expect(findTotpTimeStep(secret, codeAt(step - 1), now)).toBe(step - 1);
      expect(findTotpTimeStep(secret, codeAt(step + 1), now)).toBe(step + 1);
    });

    it('refuses an older code', () => {
      expect(findTotpTimeStep(secret, codeAt(step - 2), now)).toBeNull();
    });

    it('refuses anything that is not 6 digits', () => {
      expect(findTotpTimeStep(secret, '12345', now)).toBeNull();
      expect(findTotpTimeStep(secret, 'abcdef', now)).toBeNull();
      expect(findTotpTimeStep(secret, `${codeAt(step)}0`, now)).toBeNull();
    });
  });

  it('builds an otpauth link for the QR code', () => {
    const uri = buildOtpAuthUri('ALAA AD MANAGER', 'owner@alaa.test', 'MZXW6YTBOI');
    expect(uri).toBe(
      'otpauth://totp/ALAA%20AD%20MANAGER%3Aowner%40alaa.test?secret=MZXW6YTBOI&issuer=ALAA+AD+MANAGER&algorithm=SHA1&digits=6&period=30',
    );
  });
});
