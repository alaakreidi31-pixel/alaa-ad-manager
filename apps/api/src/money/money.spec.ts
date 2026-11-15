import { describe, expect, it } from 'vitest';
import { currencyDigits, fromMinor, MoneyFormatError, toMinor } from './money';

describe('money (ADR 0008)', () => {
  it('knows the decimals of each currency', () => {
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('SAR')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
  });

  it('turns decimal text into whole minor units, without a float', () => {
    expect(toMinor('150', 'USD')).toBe(15000n);
    expect(toMinor('150.5', 'USD')).toBe(15050n);
    expect(toMinor('0.1', 'USD') + toMinor('0.2', 'USD')).toBe(toMinor('0.3', 'USD'));
    expect(toMinor('1500', 'JPY')).toBe(1500n);
    expect(toMinor('1.234', 'KWD')).toBe(1234n);
    expect(toMinor('999999999999999.99', 'USD')).toBe(99999999999999999n);
  });

  it.each([
    ['1.234', 'USD'],
    ['1.5', 'JPY'],
    ['-5', 'USD'],
    ['abc', 'USD'],
    ['1e3', 'USD'],
    ['', 'USD'],
  ])('refuses %s %s', (amount, currency) => {
    expect(() => toMinor(amount, currency)).toThrow(MoneyFormatError);
  });

  it('writes minor units back as decimal text', () => {
    expect(fromMinor(15050n, 'USD')).toBe('150.50');
    expect(fromMinor(5n, 'USD')).toBe('0.05');
    expect(fromMinor(0n, 'USD')).toBe('0.00');
    expect(fromMinor(1500n, 'JPY')).toBe('1500');
    expect(fromMinor(1234n, 'KWD')).toBe('1.234');
  });
});
