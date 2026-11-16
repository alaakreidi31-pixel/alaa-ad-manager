import { z } from 'zod';
import { CURRENCY_CODES } from '../money/currencies';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a date like 2026-11-15' })
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), {
    message: 'is not a real date',
  });

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'must be a month like 2026-11' });

const DAY = 86_400_000;
// The most periods one chart may show (keeps every chart readable and fast).
const LIMITS = { day: 400, week: 160, month: 60 } as const;

const utcToday = () => new Date().toISOString().slice(0, 10);

// Performance reports: a date range, a granularity, optional filters.
// Money is reported in ONE currency at a time (never added across
// currencies); by default the currency with the most spend in the range.
export const PerformanceQuerySchema = z
  .object({
    from: day.optional(),
    to: day.optional(),
    granularity: z.enum(['day', 'week', 'month']).default('day'),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((code) => CURRENCY_CODES.has(code), { message: 'must be an ISO 4217 currency' })
      .optional(),
    clientId: z.uuid().optional(),
    platform: z.enum(['META', 'GOOGLE']).optional(),
  })
  .transform((value, ctx) => {
    const to = value.to ?? utcToday();
    const from =
      value.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10);
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1;
    const periods =
      value.granularity === 'day'
        ? days
        : value.granularity === 'week'
          ? Math.ceil(days / 7) + 1
          : Math.ceil(days / 28) + 1;
    if (days < 1 || periods > LIMITS[value.granularity]) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'the range is too long for this granularity',
      });
      return z.NEVER;
    }
    return { ...value, from, to };
  });

// Agency finance: whole months, at most 36 (default: the last 13 months).
// Date.UTC months start at 0, so the month index of "end" is endMonth - 1.
export const FinanceQuerySchema = z
  .object({ from: month.optional(), to: month.optional() })
  .transform(({ from, to }, ctx) => {
    const now = new Date();
    const end = to ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [endYear = 0, endMonth = 1] = end.split('-').map(Number);
    const start = from ?? new Date(Date.UTC(endYear, endMonth - 13, 1)).toISOString().slice(0, 7);
    const [startYear = 0, startMonth = 1] = start.split('-').map(Number);
    const count = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    if (count < 1 || count > 36) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'the range must be 1 to 36 months' });
      return z.NEVER;
    }
    return { from: start, to: end };
  });

export type PerformanceQuery = z.output<typeof PerformanceQuerySchema>;
