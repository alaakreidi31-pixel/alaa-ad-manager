import { z } from 'zod';

// Validation of the campaign fields (ADR 0018). The database checks the most
// important rules again (CHECK constraints in the migration).

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `must be at most ${max} characters` })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

// A calendar day "YYYY-MM-DD" that really exists (no 2026-02-30).
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a date like 2026-11-15' })
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), {
    message: 'is not a real date',
  });

const optionalDay = z
  .union([day, z.literal('')])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

// Money: decimal TEXT such as "150.50" (numbers are accepted too). The
// service turns it into minor units with the decimals of the campaign's
// currency (ADR 0008): no float is ever stored.
const optionalMoney = z
  .union([z.string().trim(), z.number().nonnegative().finite()])
  .transform((value) => (typeof value === 'number' ? String(value) : value))
  .pipe(
    z.string().regex(/^(\d{1,15}(\.\d{1,3})?)?$/, {
      message: 'must be an amount like 150 or 150.50',
    }),
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

const fields = {
  name: z
    .string()
    .trim()
    .min(2, { message: 'must be at least 2 characters' })
    .max(200, { message: 'must be at most 200 characters' }),
  externalId: optionalText(64),
  objective: optionalText(100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => CURRENCIES.has(value), { message: 'must be a currency code, e.g. USD' })
    .optional(),
  dailyBudget: optionalMoney,
  startDate: optionalDay,
  endDate: optionalDay,
};

const datesInOrder = (value: { startDate?: string | null; endDate?: string | null }) =>
  !value.startDate || !value.endDate || value.endDate >= value.startDate;
const datesMessage = { message: 'must not be before the start date', path: ['endDate'] };

// .strict(): unknown fields (e.g. "status", "clientId") are refused.
export const CreateCampaignSchema = z
  .object({ platform: z.enum(['META', 'GOOGLE']), ...fields })
  .strict()
  .refine(datesInOrder, datesMessage);

// The platform cannot change: the platform id belongs to it.
export const UpdateCampaignSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'at least one field is required',
  })
  .refine(datesInOrder, datesMessage);

// The order of the dates, checked again on update with the stored values.
export const CampaignDatesSchema = z
  .object({ startDate: z.string().nullable(), endDate: z.string().nullable() })
  .refine(datesInOrder, datesMessage);

export const ListCampaignsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED']).optional(),
  platform: z.enum(['META', 'GOOGLE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// All campaigns of the agency (the "Campaigns" page): search by campaign or client name.
export const ListAllCampaignsQuerySchema = ListCampaignsQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});

export const CampaignIdSchema = z.uuid();

// The numbers of one day (step 4.2). Counts are whole numbers; conversions
// may have 2 decimals (Google); spend is money TEXT like "150.50" (ADR 0008).
const count = z
  .union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().trim()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^\d{1,15}$/, { message: 'must be a whole number, 0 or more' }))
  .transform((value) => BigInt(value));

export const SaveDayMetricsSchema = z
  .object({
    spend: z
      .union([z.string().trim(), z.number().nonnegative().finite()])
      .transform((value) => String(value))
      .pipe(
        z.string().regex(/^\d{1,15}(\.\d{1,3})?$/, {
          message: 'must be an amount like 150 or 150.50',
        }),
      ),
    impressions: count.default(0n),
    clicks: count.default(0n),
    conversions: z
      .union([z.string().trim(), z.number().nonnegative().finite()])
      .transform((value) => String(value))
      .pipe(
        z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, {
          message: 'must be a number like 3 or 2.5',
        }),
      )
      .default('0'),
  })
  .strict();

// At most one year per request.
export const MetricsRangeSchema = z
  .object({ from: day.optional(), to: day.optional() })
  .transform(({ from, to }, ctx) => {
    const end = to ?? new Date().toISOString().slice(0, 10);
    const endTime = Date.parse(`${end}T00:00:00Z`);
    const start = from ?? new Date(endTime - 29 * 86_400_000).toISOString().slice(0, 10);
    const days = (endTime - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
    if (days < 0 || days > 365) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'the range must be 1 to 366 days' });
      return z.NEVER;
    }
    return { from: start, to: end };
  });
