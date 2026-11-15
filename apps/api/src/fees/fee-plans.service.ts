import { Inject, Injectable } from '@nestjs/common';
import { auditRow } from '../audit/audit';
import { ClientArchivedError, ClientNotFoundError } from '../clients/clients.errors';
import { ClientIdSchema } from '../clients/clients.schemas';
import type { Actor } from '../clients/clients.service';
import type { FeePlan } from '../generated/prisma/client';
import { fromMinor, MoneyFormatError, toMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';
import {
  FeePlanCannotCancelError,
  FeePlanNotFoundError,
  FeePlanOverlapError,
  FeePlanStartsTooEarlyError,
  FeePlanValidationError,
} from './fee-plans.errors';
import { CreateFeePlanSchema, FeePlanIdSchema, FeesQuerySchema } from './fee-plans.schemas';

export type FeePlanStatus = 'active' | 'scheduled' | 'ended' | 'cancelled';

// A plan as the administration sees it: amounts as text in the plan
// currency, the percentage as text ("7.50"), days as "YYYY-MM-DD".
export interface FeePlanView {
  id: string;
  currency: string;
  fixedFee: string;
  percent: string;
  minimumFee: string | null;
  startsOn: string;
  endsOn: string | null;
  cancelledAt: Date | null;
  status: FeePlanStatus;
  createdAt: Date;
}

export interface MonthFee {
  month: string; // "2026-11"
  // The current month is not over: its numbers can still change.
  inProgress: boolean;
  plan: Pick<FeePlanView, 'id' | 'currency' | 'fixedFee' | 'percent' | 'minimumFee'> | null;
  // Spend in the PLAN currency only (no conversion, ADR 0019).
  spend: string | null;
  fee: string | null;
  breakdown: { fixed: string; variable: string; minimumApplied: boolean } | null;
}

// Spend left out of a month's fee because its currency differs from the plan.
export interface CurrencyWarning {
  clientName: string;
  month: string;
  currency: string;
  spend: string;
}

export interface FeesReport {
  clientId: string;
  clientName: string;
  from: string;
  to: string;
  months: MonthFee[];
  warnings: CurrencyWarning[];
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const dayOrNull = (date: Date | null) => (date ? day(date) : null);
const utcToday = () => new Date().toISOString().slice(0, 10);
const monthStart = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
};
const percentText = (basisPoints: number) =>
  `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}`;

function statusOf(plan: FeePlan, today: string): FeePlanStatus {
  if (plan.cancelledAt) return 'cancelled';
  if (day(plan.startsOn) > today) return 'scheduled';
  if (plan.endsOn && day(plan.endsOn) < today) return 'ended';
  return 'active';
}

function toView(plan: FeePlan, today: string): FeePlanView {
  return {
    id: plan.id,
    currency: plan.currency,
    fixedFee: fromMinor(plan.fixedFeeMinor, plan.currency),
    percent: percentText(plan.percentBasisPoints),
    minimumFee:
      plan.minimumFeeMinor === null ? null : fromMinor(plan.minimumFeeMinor, plan.currency),
    startsOn: day(plan.startsOn),
    endsOn: dayOrNull(plan.endsOn),
    cancelledAt: plan.cancelledAt,
    status: statusOf(plan, today),
    createdAt: plan.createdAt,
  };
}

// The text of a database error, whatever layer wrapped it.
function databaseMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const meta = (error as { meta?: unknown }).meta;
  const cause = (error as { cause?: unknown }).cause;
  return [
    error.message,
    JSON.stringify(meta ?? ''),
    cause instanceof Error ? cause.message : '',
  ].join(' ');
}

function money(amount: string, currency: string, field: string): bigint {
  try {
    return toMinor(amount, currency);
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      throw new FeePlanValidationError({ field, message: error.message });
    }
    throw error;
  }
}

type Db = Pick<PrismaService, 'client'>;

// Fee plans of a client (step 5.1, ADR 0019). PostgreSQL enforces the rules
// (no overlap, terms never change, close/cancel rules, no delete); this
// service applies them in a friendly order and writes the audit log in the
// SAME transaction. The fee of a month is computed by PostgreSQL
// (monthly_fee_minor, NUMERIC, half up): never in JavaScript.
@Injectable()
export class FeePlansService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(clientId: string): Promise<FeePlanView[]> {
    await this.findClient(this.prisma, clientId);
    const today = utcToday();
    const plans = await this.prisma.feePlan.findMany({
      where: { clientId },
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
    });
    return plans.map((plan) => toView(plan, today));
  }

  // Creates a plan. If the client has an open plan, it is closed at the end
  // of the month before the new one, which starts NEXT month at the earliest.
  async create(clientId: string, input: unknown, actor: Actor): Promise<FeePlanView> {
    const parsed = CreateFeePlanSchema.safeParse(input);
    if (!parsed.success) throw new FeePlanValidationError(parsed.error);
    const startsOn = `${parsed.data.startsOn}-01`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // One change at a time per client: lock its row until the end.
        if (!ClientIdSchema.safeParse(clientId).success) throw new ClientNotFoundError();
        await tx.$queryRaw`SELECT id FROM clients WHERE id = ${clientId}::uuid FOR UPDATE`;
        const client = await this.findClient(tx, clientId);
        if (client.status === 'ARCHIVED') throw new ClientArchivedError();

        const currency = parsed.data.currency ?? client.currency;
        const fixedFeeMinor = money(parsed.data.fixedFee, currency, 'fixedFee');
        const minimumFeeMinor =
          parsed.data.minimumFee == null
            ? null
            : money(parsed.data.minimumFee, currency, 'minimumFee');
        const percentBasisPoints = parsed.data.percent;
        if (fixedFeeMinor === 0n && percentBasisPoints === 0) {
          throw new FeePlanValidationError({
            field: 'fixedFee',
            message: 'a plan needs a fixed fee, a percentage, or both',
          });
        }

        const open = await tx.feePlan.findFirst({
          where: { clientId, endsOn: null, cancelledAt: null },
        });
        let closed: { id: string; endsOn: string } | null = null;
        if (open) {
          if (startsOn < monthStart(1)) throw new FeePlanStartsTooEarlyError();
          if (day(open.startsOn) >= startsOn) throw new FeePlanOverlapError();
          const endsOn = new Date(new Date(`${startsOn}T00:00:00Z`).getTime() - 86_400_000);
          await tx.feePlan.update({ where: { id: open.id }, data: { endsOn } });
          closed = { id: open.id, endsOn: day(endsOn) };
          await tx.auditLog.create({
            data: auditRow({
              ...actor,
              action: 'admin.fee_plan.closed',
              metadata: {
                clientId,
                feePlanId: open.id,
                'before.endsOn': null,
                'after.endsOn': closed.endsOn,
                reason: 'replaced',
              },
            }),
          });
        }

        const plan = await tx.feePlan.create({
          data: {
            clientId,
            currency,
            fixedFeeMinor,
            percentBasisPoints,
            minimumFeeMinor,
            startsOn: new Date(`${startsOn}T00:00:00Z`),
          },
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.fee_plan.created',
            metadata: {
              clientId,
              feePlanId: plan.id,
              currency,
              fixedFeeMinor: fixedFeeMinor.toString(),
              percentBasisPoints,
              minimumFeeMinor: minimumFeeMinor === null ? null : minimumFeeMinor.toString(),
              startsOn,
              closedFeePlanId: closed?.id ?? null,
            },
          }),
        });
        return toView(plan, utcToday());
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  // Cancels a plan that has not started yet (a mistake in a future plan).
  async cancel(clientId: string, planId: string, actor: Actor): Promise<FeePlanView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.findClient(tx, clientId);
        if (!FeePlanIdSchema.safeParse(planId).success) throw new FeePlanNotFoundError();
        // BOTH ids: a plan of another client is not found (IDOR).
        const plan = await tx.feePlan.findFirst({ where: { id: planId, clientId } });
        if (!plan) throw new FeePlanNotFoundError();
        if (plan.cancelledAt || day(plan.startsOn) <= utcToday()) {
          throw new FeePlanCannotCancelError();
        }
        const cancelled = await tx.feePlan.update({
          where: { id: plan.id },
          data: { cancelledAt: new Date() },
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.fee_plan.cancelled',
            metadata: {
              clientId,
              feePlanId: plan.id,
              'before.cancelledAt': null,
              'after.cancelledAt': cancelled.cancelledAt?.toISOString() ?? null,
            },
          }),
        });
        return toView(cancelled, utcToday());
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  // The fee of each month of a period, from the real spend.
  async fees(clientId: string, query: unknown): Promise<FeesReport> {
    const range = FeesQuerySchema.safeParse(query);
    if (!range.success) throw new FeePlanValidationError(range.error);
    const { from, to } = range.data;
    const client = await this.findClient(this.prisma, clientId);

    const firstDay = `${from}-01`;
    const [toYear = 0, toMonth = 1] = to.split('-').map(Number);
    const lastDay = new Date(Date.UTC(toYear, toMonth, 0)).toISOString().slice(0, 10);

    const plans = await this.prisma.feePlan.findMany({
      where: { clientId, cancelledAt: null },
      orderBy: { startsOn: 'asc' },
    });
    // Spend per month and currency, summed by PostgreSQL (NUMERIC, exact).
    const spendRows = await this.prisma.$queryRaw<
      { month: string; currency: string; spend: string }[]
    >`
      SELECT to_char(date_trunc('month', m.date), 'YYYY-MM') AS month,
             c.currency AS currency,
             SUM(m.spend_minor)::text AS spend
      FROM campaign_daily_metrics m
      JOIN campaigns c ON c.id = m.campaign_id
      WHERE c.client_id = ${clientId}::uuid
        AND m.date >= ${firstDay}::date AND m.date <= ${lastDay}::date
      GROUP BY 1, 2`;
    const spendOf = new Map(spendRows.map((row) => [`${row.month}|${row.currency}`, row.spend]));

    const currentMonth = monthStart(0).slice(0, 7);
    const months: MonthFee[] = [];
    const warnings: CurrencyWarning[] = [];
    for (let cursor = firstDay; cursor <= lastDay;) {
      const month = cursor.slice(0, 7);
      const [year = 0, monthNumber = 1] = month.split('-').map(Number);
      const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
      const plan = plans.find(
        (candidate) =>
          day(candidate.startsOn) <= cursor &&
          (!candidate.endsOn || day(candidate.endsOn) >= monthEnd),
      );

      if (!plan) {
        months.push({
          month,
          inProgress: month === currentMonth,
          plan: null,
          spend: null,
          fee: null,
          breakdown: null,
        });
      } else {
        const spendMinor = spendOf.get(`${month}|${plan.currency}`) ?? '0';
        const [computed] = await this.prisma.$queryRaw<{ fee: string; variable: string }[]>`
          SELECT monthly_fee_minor(${spendMinor}::numeric, ${plan.fixedFeeMinor}::bigint,
                                   ${plan.percentBasisPoints}::integer, ${plan.minimumFeeMinor}::bigint)::text AS fee,
                 monthly_fee_minor(${spendMinor}::numeric, 0::bigint,
                                   ${plan.percentBasisPoints}::integer, NULL::bigint)::text AS variable`;
        const fee = BigInt(computed?.fee ?? '0');
        const variable = BigInt(computed?.variable ?? '0');
        months.push({
          month,
          inProgress: month === currentMonth,
          plan: {
            id: plan.id,
            currency: plan.currency,
            fixedFee: fromMinor(plan.fixedFeeMinor, plan.currency),
            percent: percentText(plan.percentBasisPoints),
            minimumFee:
              plan.minimumFeeMinor === null ? null : fromMinor(plan.minimumFeeMinor, plan.currency),
          },
          spend: fromMinor(BigInt(spendMinor), plan.currency),
          fee: fromMinor(fee, plan.currency),
          breakdown: {
            fixed: fromMinor(plan.fixedFeeMinor, plan.currency),
            variable: fromMinor(variable, plan.currency),
            minimumApplied: fee > plan.fixedFeeMinor + variable,
          },
        });
        // Spend in other currencies: NOT converted, NOT counted, reported.
        for (const row of spendRows) {
          if (row.month === month && row.currency !== plan.currency && BigInt(row.spend) > 0n) {
            warnings.push({
              clientName: client.name,
              month,
              currency: row.currency,
              spend: fromMinor(BigInt(row.spend), row.currency),
            });
          }
        }
      }
      cursor = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    }
    return { clientId, clientName: client.name, from, to, months, warnings };
  }

  private async findClient(db: Db, clientId: string) {
    if (!ClientIdSchema.safeParse(clientId).success) throw new ClientNotFoundError();
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, status: true, currency: true },
    });
    if (!client) throw new ClientNotFoundError();
    return client;
  }

  // PostgreSQL refusals (constraints and triggers) as expected errors.
  private translate(error: unknown): unknown {
    const text = databaseMessage(error);
    if (text.includes('fee_plans_no_overlap')) return new FeePlanOverlapError();
    if (
      text.includes('only the first fee plan') ||
      text.includes('closes at the end of the current month')
    ) {
      return new FeePlanStartsTooEarlyError();
    }
    if (text.includes('can be cancelled, once')) return new FeePlanCannotCancelError();
    return error;
  }
}
