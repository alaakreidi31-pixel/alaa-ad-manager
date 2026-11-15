import { afterAll, describe, expect, it } from 'vitest';
import { CURRENCY_MINOR_UNITS } from '../money/currencies';
import { currencyDigits } from '../money/money';
import { createTestPrisma } from '../testing/test-prisma';

const prisma = createTestPrisma();

describe('ISO 4217 currencies (ADR 0019)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('the database list and money.ts are identical, code by code and decimals', async () => {
    const rows = await prisma.currency.findMany({ orderBy: { code: 'asc' } });
    expect(Object.fromEntries(rows.map((row) => [row.code, row.minorUnits]))).toEqual(
      CURRENCY_MINOR_UNITS,
    );
    expect(rows).toHaveLength(154);
  });

  it('uses the ISO decimals, not the display decimals of the browser', () => {
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('IQD')).toBe(3);
    expect(() => currencyDigits('HRK')).toThrow();
  });
});
