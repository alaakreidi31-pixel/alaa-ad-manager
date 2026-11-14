import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('converts to lowercase', () => {
    expect(normalizeEmail('Alaa@Example.COM')).toBe('alaa@example.com');
  });

  it('removes surrounding spaces, tabs and new lines', () => {
    expect(normalizeEmail('  alaa@example.com\t\n')).toBe('alaa@example.com');
  });

  it('trims and lowercases together', () => {
    expect(normalizeEmail('  Alaa@Example.com ')).toBe('alaa@example.com');
  });

  it('keeps an already normalized email unchanged', () => {
    expect(normalizeEmail('alaa@example.com')).toBe('alaa@example.com');
  });
});
