import { describe, expect, it } from 'vitest';
import { countryOptions, currencyOptions, timeZoneOptions } from './reference-data';

describe('client form lists', () => {
  it('lists every country with a code, translated', () => {
    const countries = countryOptions('en');
    expect(countries.length).toBeGreaterThan(240);
    expect(countries).toContainEqual({ value: 'SA', label: 'Saudi Arabia (SA)' });
  });

  it('puts USD first among the currencies', () => {
    const currencies = currencyOptions('en');
    expect(currencies[0]?.value).toBe('USD');
    expect(currencies.some((c) => c.value === 'SAR')).toBe(true);
  });

  it('offers UTC and real time zones', () => {
    const zones = timeZoneOptions();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Asia/Riyadh');
  });
});
