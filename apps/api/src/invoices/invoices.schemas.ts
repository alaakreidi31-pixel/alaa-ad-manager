import { z } from 'zod';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a date like 2026-11-15' })
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), {
    message: 'is not a real date',
  });

const reason = z
  .string()
  .trim()
  .min(3, { message: 'must be at least 3 characters' })
  .max(500, { message: 'must be at most 500 characters' });

export const ListInvoicesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ISSUED', 'VOID']).optional(),
  clientId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// The due date is optional: the database uses issue day + 14.
export const IssueInvoiceSchema = z.object({ dueOn: day.optional() }).strict();

export const VoidSchema = z.object({ reason }).strict();

export const RecordPaymentSchema = z
  .object({
    amount: z
      .union([z.string().trim(), z.number().positive().finite()])
      .transform((value) => String(value))
      .pipe(
        z.string().regex(/^\d{1,15}(\.\d{1,3})?$/, { message: 'must be an amount like 300.50' }),
      ),
    paidOn: day,
    method: z.enum(['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER']),
    reference: z
      .string()
      .trim()
      .max(200)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
  })
  .strict();

export const IdSchema = z.uuid();
