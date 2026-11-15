import { describe, expect, it } from 'vitest';
import { monthFromNow } from './fees-api';

describe('fee helpers', () => {
  it('gives the month N months from now, across years', () => {
    const now = new Date();
    expect(monthFromNow(0)).toBe(now.toISOString().slice(0, 7));
    const next = monthFromNow(1);
    expect(next > monthFromNow(0)).toBe(true);
    expect(monthFromNow(12).slice(0, 4)).toBe(String(now.getUTCFullYear() + 1));
  });
});
