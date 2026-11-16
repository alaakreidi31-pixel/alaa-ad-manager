import { z } from 'zod';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a date like 2026-11-15' })
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), {
    message: 'is not a real date',
  });

const title = z
  .string()
  .trim()
  .min(1, { message: 'is required' })
  .max(200, { message: 'must be at most 200 characters' });

// "" clears an optional text, like the other forms of the application.
const optionalText = z
  .string()
  .trim()
  .max(5000, { message: 'must be at most 5000 characters' })
  .transform((value) => (value === '' ? null : value))
  .nullable();

const optionalId = z
  .union([z.uuid(), z.literal('')])
  .transform((value) => (value === '' ? null : value))
  .nullable();

const optionalDay = z
  .union([day, z.literal('')])
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export const CreateTaskSchema = z
  .object({
    title,
    description: optionalText.optional(),
    priority: z.enum(PRIORITIES).default('MEDIUM'),
    dueOn: optionalDay.optional(),
    clientId: optionalId.optional(),
    campaignId: optionalId.optional(),
    visibleToClient: z.boolean().default(false),
  })
  .strict();

export const UpdateTaskSchema = z
  .object({
    title: title.optional(),
    description: optionalText.optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(STATUSES).optional(),
    dueOn: optionalDay.optional(),
    clientId: optionalId.optional(),
    campaignId: optionalId.optional(),
    visibleToClient: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to change' });

export const CommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, { message: 'is required' })
      .max(5000, { message: 'must be at most 5000 characters' }),
  })
  .strict();

const commaList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const ListTasksQuerySchema = z.object({
  status: commaList(STATUSES),
  priority: z.enum(PRIORITIES).optional(),
  source: z.enum(['MANUAL', 'RECURRING', 'SYSTEM']).optional(),
  clientId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
  // overdue: open and due before today; today; week: due in the next 7 days; none: no due date.
  due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const recurrenceFields = {
  title,
  description: optionalText.optional(),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  clientId: optionalId.optional(),
  campaignId: optionalId.optional(),
  visibleToClient: z.boolean().default(false),
  frequency: z.enum(['WEEKLY', 'MONTHLY']),
  // WEEKLY: 1 = Monday ... 7 = Sunday. MONTHLY: 1 to 28.
  day: z.number().int().min(1).max(28),
  dueAfterDays: z.number().int().min(0).max(60).default(0),
  startsOn: day,
  endsOn: optionalDay.optional(),
};

const scheduleCheck = (value: { frequency?: string; day?: number }) =>
  value.frequency !== 'WEEKLY' || value.day === undefined || value.day <= 7;

export const CreateRecurrenceSchema = z
  .object(recurrenceFields)
  .strict()
  .refine(scheduleCheck, { path: ['day'], message: 'a weekly day is 1 (Monday) to 7 (Sunday)' });

export const UpdateRecurrenceSchema = z
  .object({
    title: title.optional(),
    description: optionalText.optional(),
    priority: z.enum(PRIORITIES).optional(),
    clientId: optionalId.optional(),
    campaignId: optionalId.optional(),
    visibleToClient: z.boolean().optional(),
    frequency: z.enum(['WEEKLY', 'MONTHLY']).optional(),
    day: z.number().int().min(1).max(28).optional(),
    dueAfterDays: z.number().int().min(0).max(60).optional(),
    endsOn: optionalDay.optional(),
    paused: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to change' })
  .refine((value) => value.day === undefined || value.frequency !== undefined, {
    path: ['frequency'],
    message: 'send the frequency with the day',
  })
  .refine(scheduleCheck, { path: ['day'], message: 'a weekly day is 1 (Monday) to 7 (Sunday)' });

export const IdSchema = z.uuid();
