import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeFormat,
  normalizeRecoveryCode,
} from './recovery-codes';

describe('recovery codes', () => {
  it('generates 10 different codes in the XXXXX-XXXXX format', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(code).not.toMatch(/[01OILU]/);
    }
  });

  it('accepts spaces, dashes and lowercase when typed', () => {
    expect(normalizeRecoveryCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(hashRecoveryCode('abcde fghjk')).toBe(hashRecoveryCode('ABCDE-FGHJK'));
  });

  it('stores a SHA-256 hash, never the code', () => {
    const [code = ''] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(code);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(normalizeRecoveryCode(code));
  });

  it('recognizes the code format', () => {
    expect(isRecoveryCodeFormat('ABCDEFGHJK')).toBe(true);
    expect(isRecoveryCodeFormat('123456')).toBe(false);
    expect(isRecoveryCodeFormat('ABCDEFGHJ0')).toBe(false);
  });
});
