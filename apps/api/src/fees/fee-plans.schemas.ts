import { z } from 'zod';
import { CURRENCY_CODES } from '../money/currencies';

// Validation of the fee plan inputs (ADR 0019). PostgreSQL checks the same
// rules again (constraints and triggers in the migration).

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'must be a month like 2026-12' });

// Money TEXT like "300" or "300.50" (numbers accepted). Turned into minor
// units with the decimals of the plan currency (ADR 0008).
const money = z
  .union([z.string().trim(), z.number().nonnegative().finite()])
  .transform((value) => String(value))
  .pipe(
    z.string().regex(/^\d{1,15}(\.\d{1,3})?$/, { message: 'must be an amount like 300 or 300.50' }),
  );

const optionalMoney = z
  .union([z.string().trim(), z.number().nonnegative().finite(), z.null()])
  .transform((value) => (value === null || value === '' ? null : String(value)))
  .pipe(
    z
      .string()
      .regex(/^\d{1,15}(\.\d{1,3})?$/, { message: 'must be an amount like 300 or 300.50' })
      .nullable(),
  )
  .optional();

// A percentage with at most 2 decimals, 0 to 100: "7.5" -> 750 basis points.
const percent = z
  .union([z.string().trim(), z.number().nonnegative().finite()])
  .transform((value) => String(value))
  .pipe(
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, { message: 'must be a percentage like 10 or 7.5' })
      .transform((value) => {
        const [whole = '0', decimals = ''] = value.split('.');
        return Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
      })
      .refine((basisPoints) => basisPoints <= 10000, { message: 'must be 100 at most' }),
  );

export const CreateFeePlanSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((code) => CURRENCY_CODES.has(code), {
        message: 'must be an ISO 4217 currency, e.g. USD',
      })
      .optional(),
    fixedFee: money.default('0'),
    percent: percent.default(0),
    minimumFee: optionalMoney,
    startsOn: month,
  })
  .strict();

// Months to report: at most 24, default the last 6 (the current one included).
export const FeesQuerySchema = z
  .object({ from: month.optional(), to: month.optional() })
  .transform(({ from, to }, ctx) => {
    const now = new Date();
    const end = to ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [endYear = 0, endMonth = 1] = end.split('-').map(Number);
    const start =
      from ??
      (() => {
        const date = new Date(Date.UTC(endYear, endMonth - 1 - 5, 1));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      })();
    const [startYear = 0, startMonth = 1] = start.split('-').map(Number);
    const count = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    if (count < 1 || count > 24) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'the range must be 1 to 24 months' });
      return z.NEVER;
    }
    return { from: start, to: end };
  });

export const FeePlanIdSchema = z.uuid();
