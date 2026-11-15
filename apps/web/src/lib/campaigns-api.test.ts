import { describe, expect, it } from 'vitest';
import { lastDays, ratios } from './campaigns-api';

describe('campaign helpers', () => {
  it('gives a range of N days ending today', () => {
    const { from, to } = lastDays(30);
    expect(to).toBe(new Date().toISOString().slice(0, 10));
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(29);
  });

  it('computes display ratios, and null instead of dividing by zero', () => {
    expect(ratios({ spend: '50.00', impressions: 1000, clicks: 20, conversions: '4.00' })).toEqual({
      ctr: 2,
      cpc: 2.5,
      cpa: 12.5,
    });
    expect(ratios({ spend: '0.00', impressions: 0, clicks: 0, conversions: '0.00' })).toEqual({
      ctr: null,
      cpc: null,
      cpa: null,
    });
  });
});
