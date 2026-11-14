import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox (AES-256-GCM)', () => {
  it('encrypts and decrypts', () => {
    const box = new SecretBox(key());
    expect(box.decrypt(box.encrypt('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
  });

  it('never stores the plain value, and encrypts differently every time', () => {
    const box = new SecretBox(key());
    const a = box.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(a.startsWith('v1.')).toBe(true);
    expect(box.encrypt('JBSWY3DPEHPK3PXP')).not.toBe(a);
  });

  it('refuses a value that was changed', () => {
    const box = new SecretBox(key());
    const parts = box.encrypt('JBSWY3DPEHPK3PXP').split('.');
    const ciphertext = Buffer.from(parts[3] ?? '', 'base64url');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    parts[3] = ciphertext.toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
  });

  it('refuses a value encrypted with another key', () => {
    const encrypted = new SecretBox(key()).encrypt('JBSWY3DPEHPK3PXP');
    expect(() => new SecretBox(key()).decrypt(encrypted)).toThrow();
  });

  it('refuses a malformed value', () => {
    expect(() => new SecretBox(key()).decrypt('plain-text')).toThrow('Unsupported');
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow('32 bytes');
    expect(() => new SecretBox('')).toThrow('32 bytes');
  });
});
