import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { fromMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';
import {
  FinanceQuerySchema,
  PerformanceQuerySchema,
  type PerformanceQuery,
} from './reports.schemas';

export class ReportValidationError extends Error {
  readonly fields: { field: string; message: string }[];
  constructor(fields: { field: string; message: string }[]) {
    super('Invalid report request');
    this.fields = fields;
  }
}

// Numbers for the charts. Money is text in ONE currency ("1234.50"); counts
// are numbers; ratios are computed by PostgreSQL in NUMERIC and returned as
// text, or null when dividing by zero. The browser only draws.
export interface PerformancePoint {
  period: string; // first day of the period, "YYYY-MM-DD"
  spend: { meta: string; google: string; total: string };
  conversions: { meta: string; google: string; total: string };
  impressions: number;
  clicks: number;
}

export interface PerformanceReport {
  from: string;
  to: string;
  granularity: 'day' | 'week' | 'month';
  // Currencies with spend in the range, most spend first; the report uses `currency`.
  currencies: string[];
  currency: string | null;
  points: PerformancePoint[];
  totals: {
    spend: string;
    impressions: number;
    clicks: number;
    conversions: string;
    ctr: string | null;
    cpc: string | null;
    cpa: string | null;
  };
}

export interface CampaignRow {
  id: string;
  name: string;
  platform: 'META' | 'GOOGLE';
  clientId: string;
  clientName: string;
  spend: string;
  impressions: number;
  clicks: number;
  conversions: string;
  ctr: string | null;
  cpc: string | null;
  cpa: string | null;
}

export interface FinanceReport {
  from: string;
  to: string;
  currencies: {
    currency: string;
    months: { month: string; invoiced: string; collected: string }[];
    outstanding: string;
    overdue: number;
  }[];
}

interface Scope {
  // Client portal: its own campaigns, archived ones hidden.
  clientId?: string;
  portal?: boolean;
}

const ZERO = '0';

// Reports (phase 7, ADR 0021). Read only; every number comes from the
// database: no sample data. Money is never added across currencies.
@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private parsePerformance(query: unknown, scope: Scope): PerformanceQuery {
    const parsed = PerformanceQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ReportValidationError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(query)',
          message: issue.message,
        })),
      );
    }
    // In the portal the client id comes from the session, never the query.
    return scope.portal ? { ...parsed.data, clientId: scope.clientId } : parsed.data;
  }

  private filters(query: PerformanceQuery, scope: Scope): Prisma.Sql {
    return Prisma.sql`
      ${query.clientId ? Prisma.sql`AND c.client_id = ${query.clientId}::uuid` : Prisma.empty}
      ${query.platform ? Prisma.sql`AND c.platform::text = ${query.platform}` : Prisma.empty}
      ${scope.portal ? Prisma.sql`AND c.status <> 'ARCHIVED'` : Prisma.empty}`;
  }

  private async currencies(query: PerformanceQuery, scope: Scope): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ currency: string }[]>`
      SELECT c.currency AS currency
      FROM campaign_daily_metrics m JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.date >= ${query.from}::date AND m.date <= ${query.to}::date ${this.filters(query, scope)}
      GROUP BY c.currency
      ORDER BY SUM(m.spend_minor) DESC, c.currency`;
    return rows.map((row) => row.currency);
  }

  async performance(query: unknown, scope: Scope = {}): Promise<PerformanceReport> {
    const q = this.parsePerformance(query, scope);
    const currencies = await this.currencies(q, scope);
    const currency = q.currency ?? currencies[0] ?? null;
    const base = { from: q.from, to: q.to, granularity: q.granularity, currencies, currency };
    const step = Prisma.raw(`'1 ${q.granularity}'::interval`);
    const unit = q.granularity;

    // Every period of the range is returned, empty ones included.
    const rows = await this.prisma.$queryRaw<
      {
        period: string;
        meta_spend: string;
        google_spend: string;
        spend: string;
        meta_conversions: string;
        google_conversions: string;
        conversions: string;
        impressions: string;
        clicks: string;
      }[]
    >`
      WITH periods AS (
        SELECT generate_series(date_trunc(${unit}, ${q.from}::timestamp), ${q.to}::timestamp, ${step})::date AS period
      ), data AS (
        SELECT date_trunc(${unit}, m.date::timestamp)::date AS period, c.platform::text AS platform,
               m.spend_minor, m.impressions, m.clicks, m.conversions
        FROM campaign_daily_metrics m JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.date >= ${q.from}::date AND m.date <= ${q.to}::date
          AND c.currency = ${currency ?? ''} ${this.filters(q, scope)}
      )
      SELECT to_char(p.period, 'YYYY-MM-DD') AS period,
        COALESCE(SUM(d.spend_minor) FILTER (WHERE d.platform = 'META'), 0)::text AS meta_spend,
        COALESCE(SUM(d.spend_minor) FILTER (WHERE d.platform = 'GOOGLE'), 0)::text AS google_spend,
        COALESCE(SUM(d.spend_minor), 0)::text AS spend,
        COALESCE(SUM(d.conversions) FILTER (WHERE d.platform = 'META'), 0)::text AS meta_conversions,
        COALESCE(SUM(d.conversions) FILTER (WHERE d.platform = 'GOOGLE'), 0)::text AS google_conversions,
        COALESCE(SUM(d.conversions), 0)::text AS conversions,
        COALESCE(SUM(d.impressions), 0)::text AS impressions,
        COALESCE(SUM(d.clicks), 0)::text AS clicks
      FROM periods p LEFT JOIN data d ON d.period = p.period
      GROUP BY p.period ORDER BY p.period`;

    const [totals] = await this.prisma.$queryRaw<
      {
        spend: string;
        impressions: string;
        clicks: string;
        conversions: string;
        ctr: string | null;
        cpc: string | null;
        cpa: string | null;
      }[]
    >`
      SELECT COALESCE(SUM(m.spend_minor), 0)::text AS spend,
             COALESCE(SUM(m.impressions), 0)::text AS impressions,
             COALESCE(SUM(m.clicks), 0)::text AS clicks,
             COALESCE(SUM(m.conversions), 0)::text AS conversions,
             round(SUM(m.clicks) * 100.0 / NULLIF(SUM(m.impressions), 0), 2)::text AS ctr,
             round(SUM(m.spend_minor) / NULLIF(SUM(m.clicks), 0))::text AS cpc,
             round(SUM(m.spend_minor) / NULLIF(SUM(m.conversions), 0))::text AS cpa
      FROM campaign_daily_metrics m JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.date >= ${q.from}::date AND m.date <= ${q.to}::date
        AND c.currency = ${currency ?? ''} ${this.filters(q, scope)}`;

    const money = (minor: string) => (currency ? fromMinor(BigInt(minor), currency) : ZERO);
    // Conversions are NUMERIC(14,2) sums: always 2 decimals, as text.
    const twoDecimals = (value: string) => {
      const [whole = '0', cents = ''] = value.split('.');
      return `${whole}.${cents.padEnd(2, '0').slice(0, 2)}`;
    };
    return {
      ...base,
      points: rows.map((row) => ({
        period: row.period,
        spend: {
          meta: money(row.meta_spend),
          google: money(row.google_spend),
          total: money(row.spend),
        },
        conversions: {
          meta: twoDecimals(row.meta_conversions),
          google: twoDecimals(row.google_conversions),
          total: twoDecimals(row.conversions),
        },
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
      })),
      totals: {
        spend: money(totals?.spend ?? ZERO),
        impressions: Number(totals?.impressions ?? 0),
        clicks: Number(totals?.clicks ?? 0),
        conversions: twoDecimals(totals?.conversions ?? ZERO),
        ctr: totals?.ctr ?? null,
        cpc: totals?.cpc && currency ? fromMinor(BigInt(totals.cpc), currency) : null,
        cpa: totals?.cpa && currency ? fromMinor(BigInt(totals.cpa), currency) : null,
      },
    };
  }

  // Campaigns compared over the range (most spend first, at most 50).
  async campaigns(
    query: unknown,
    scope: Scope = {},
  ): Promise<{ currency: string | null; currencies: string[]; items: CampaignRow[] }> {
    const q = this.parsePerformance(query, scope);
    const currencies = await this.currencies(q, scope);
    const currency = q.currency ?? currencies[0] ?? null;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        platform: 'META' | 'GOOGLE';
        client_id: string;
        client_name: string;
        spend: string;
        impressions: string;
        clicks: string;
        conversions: string;
        ctr: string | null;
        cpc: string | null;
        cpa: string | null;
      }[]
    >`
      SELECT c.id, c.name, c.platform::text AS platform, c.client_id::text AS client_id, cl.name AS client_name,
             SUM(m.spend_minor)::text AS spend, SUM(m.impressions)::text AS impressions,
             SUM(m.clicks)::text AS clicks, SUM(m.conversions)::text AS conversions,
             round(SUM(m.clicks) * 100.0 / NULLIF(SUM(m.impressions), 0), 2)::text AS ctr,
             round(SUM(m.spend_minor) / NULLIF(SUM(m.clicks), 0))::text AS cpc,
             round(SUM(m.spend_minor) / NULLIF(SUM(m.conversions), 0))::text AS cpa
      FROM campaigns c
      JOIN clients cl ON cl.id = c.client_id
      JOIN campaign_daily_metrics m ON m.campaign_id = c.id
        AND m.date >= ${q.from}::date AND m.date <= ${q.to}::date
      WHERE c.currency = ${currency ?? ''} ${this.filters(q, scope)}
      GROUP BY c.id, cl.name
      ORDER BY SUM(m.spend_minor) DESC, c.name
      LIMIT 50`;
    const money = (minor: string | null) =>
      minor !== null && currency ? fromMinor(BigInt(minor), currency) : null;
    return {
      currency,
      currencies,
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        platform: row.platform,
        clientId: row.client_id,
        clientName: row.client_name,
        spend: money(row.spend) ?? ZERO,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        conversions: (([whole = '0', cents = '']) =>
          `${whole}.${cents.padEnd(2, '0').slice(0, 2)}`)(row.conversions.split('.')),
        ctr: row.ctr,
        cpc: money(row.cpc),
        cpa: money(row.cpa),
      })),
    };
  }

  // Agency finance: issued invoices by invoiced month, payments by payment
  // month, and what is still due today. One block per currency.
  async finance(query: unknown): Promise<FinanceReport> {
    const parsed = FinanceQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ReportValidationError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(query)',
          message: issue.message,
        })),
      );
    }
    const { from, to } = parsed.data;
    const first = `${from}-01`;
    const last = `${to}-01`;
    const rows = await this.prisma.$queryRaw<
      { currency: string; month: string; invoiced: string; collected: string }[]
    >`
      WITH months AS (
        SELECT generate_series(${first}::date, ${last}::date, '1 month'::interval)::date AS month
      ), currencies AS (
        SELECT DISTINCT currency FROM invoices WHERE status = 'ISSUED'
      ), invoiced AS (
        SELECT currency, period_month AS month, SUM(total_minor) AS amount
        FROM invoices WHERE status = 'ISSUED' GROUP BY 1, 2
      ), collected AS (
        SELECT i.currency, date_trunc('month', p.paid_on)::date AS month, SUM(p.amount_minor) AS amount
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.voided_at IS NULL AND i.status = 'ISSUED' GROUP BY 1, 2
      )
      SELECT c.currency, to_char(m.month, 'YYYY-MM') AS month,
             COALESCE(inv.amount, 0)::text AS invoiced, COALESCE(col.amount, 0)::text AS collected
      FROM currencies c CROSS JOIN months m
      LEFT JOIN invoiced inv ON inv.currency = c.currency AND inv.month = m.month
      LEFT JOIN collected col ON col.currency = c.currency AND col.month = m.month
      ORDER BY c.currency, m.month`;
    const due = await this.prisma.$queryRaw<
      { currency: string; outstanding: string; overdue: number }[]
    >`
      SELECT i.currency,
             SUM(i.total_minor - COALESCE(p.paid, 0))::text AS outstanding,
             count(*) FILTER (WHERE i.due_on < (now() AT TIME ZONE 'UTC')::date)::int AS overdue
      FROM invoices i
      LEFT JOIN LATERAL (SELECT SUM(amount_minor) AS paid FROM payments
                         WHERE invoice_id = i.id AND voided_at IS NULL) p ON true
      WHERE i.status = 'ISSUED' AND i.total_minor > COALESCE(p.paid, 0)
      GROUP BY i.currency`;
    const dueOf = new Map(due.map((row) => [row.currency, row]));

    const byCurrency = new Map<string, FinanceReport['currencies'][number]>();
    for (const row of rows) {
      const block = byCurrency.get(row.currency) ?? {
        currency: row.currency,
        months: [],
        outstanding: fromMinor(BigInt(dueOf.get(row.currency)?.outstanding ?? '0'), row.currency),
        overdue: dueOf.get(row.currency)?.overdue ?? 0,
      };
      block.months.push({
        month: row.month,
        invoiced: fromMinor(BigInt(row.invoiced), row.currency),
        collected: fromMinor(BigInt(row.collected), row.currency),
      });
      byCurrency.set(row.currency, block);
    }
    return { from, to, currencies: [...byCurrency.values()] };
  }
}
