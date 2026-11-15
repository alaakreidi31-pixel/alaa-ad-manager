import { describe, expect, it } from 'vitest';
import { formatMoney as format, lastMonths, periodLabel } from './reports-api';

// Intl puts a no-break space between the code and the number.
const formatMoney = (...args: Parameters<typeof format>) => format(...args).replace(/\s/g, ' ');

describe('report formatting (display only)', () => {
  it('formats money with the decimals of the API text and the currency code', () => {
    expect(formatMoney('1234.5', 'USD', 'en')).toBe('USD 1,234.5');
    expect(formatMoney('1234.50', 'USD', 'en')).toBe('USD 1,234.50');
    expect(formatMoney('75.000', 'KWD', 'en')).toBe('KWD 75.000');
    expect(formatMoney('1500', 'JPY', 'en')).toBe('JPY 1,500');
    expect(formatMoney(null, 'USD', 'en')).toBe('—');
    expect(formatMoney('10.00', 'SAR', 'ar')).toMatch(/10\.00/); // Western digits in Arabic
  });

  it('labels periods in UTC', () => {
    expect(periodLabel('2026-10-05', 'day', 'en')).toBe('Oct 5');
    expect(periodLabel('2026-10-01', 'month', 'en')).toBe('Oct 2026');
    expect(periodLabel('2026-10', 'month', 'en')).toBe('Oct 2026');
  });

  it('lastMonths: 13 months ending with the current one', () => {
    expect(lastMonths(13, new Date('2026-11-16T23:00:00Z'))).toEqual({
      from: '2025-11',
      to: '2026-11',
    });
    expect(lastMonths(1, new Date('2026-01-01T00:00:00Z'))).toEqual({
      from: '2026-01',
      to: '2026-01',
    });
  });
});
