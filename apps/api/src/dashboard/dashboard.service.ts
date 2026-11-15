import { Inject, Injectable } from '@nestjs/common';
import type { ClientStatus } from '../generated/prisma/client';
import { fromMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';

// The administration home page (step 3.2). REAL numbers only (ADR 0017):
// everything is counted from the database at the moment of the request.
// Money, campaigns and invoices are added when their phases exist.
export interface AdminDashboard {
  clients: Record<ClientStatus, number> & { total: number };
  accounts: {
    total: number;
    active: number;
    suspended: number;
    // Accounts still on a temporary password (never signed in).
    pendingPasswordChange: number;
  };
  recentClients: { id: string; name: string; status: ClientStatus; createdAt: Date }[];
  // The current month (UTC), all clients. One line per currency: amounts
  // in different currencies are never added together (ADR 0019).
  month: {
    month: string;
    activeCampaigns: number;
    spend: { currency: string; amount: string }[];
    // Fees of the clients that have a plan this month (archived excluded),
    // computed by PostgreSQL (monthly_fee_minor). Month in progress.
    fees: { currency: string; amount: string; clients: number }[];
    activeClientsWithoutPlan: number;
  };
  // Issued invoices not fully paid (one line per currency), overdue ones,
  // and drafts waiting for review (ADR 0020).
  invoices: {
    due: { currency: string; amount: string; count: number }[];
    overdue: number;
    drafts: number;
  };
  generatedAt: Date;
}

const RECENT_CLIENTS = 5;

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async admin(): Promise<AdminDashboard> {
    const clientAccounts = { role: 'CLIENT_USER' as const };
    // One transaction: every number is read from the same moment.
    const [byStatus, accountsByStatus, pendingPasswordChange, recentClients] =
      await this.prisma.$transaction([
        this.prisma.client.groupBy({
          by: ['status'],
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.user.groupBy({
          by: ['status'],
          where: clientAccounts,
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.user.count({ where: { ...clientAccounts, mustChangePassword: true } }),
        this.prisma.client.findMany({
          select: { id: true, name: true, status: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: RECENT_CLIENTS,
        }),
      ]);

    const clients = { ACTIVE: 0, SUSPENDED: 0, ARCHIVED: 0, total: 0 };
    for (const row of byStatus) {
      const count = (row._count as { _all: number })._all;
      clients[row.status] = count;
      clients.total += count;
    }
    const accounts = { total: 0, active: 0, suspended: 0, pendingPasswordChange };
    for (const row of accountsByStatus) {
      const count = (row._count as { _all: number })._all;
      if (row.status === 'ACTIVE') accounts.active = count;
      else accounts.suspended = count;
      accounts.total += count;
    }

    return {
      clients,
      accounts,
      recentClients,
      month: await this.currentMonth(),
      invoices: await this.invoices(),
      generatedAt: new Date(),
    };
  }

  private async currentMonth(): Promise<AdminDashboard['month']> {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);

    const [activeCampaigns, spendRows, feeRows, withoutPlan] = await this.prisma.$transaction([
      this.prisma.campaign.count({
        where: { status: 'ACTIVE', client: { status: { not: 'ARCHIVED' } } },
      }),
      this.prisma.$queryRaw<{ currency: string; amount: string }[]>`
        SELECT c.currency AS currency, SUM(m.spend_minor)::text AS amount
        FROM campaign_daily_metrics m
        JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.date >= ${first}::date AND m.date <= ${last}::date
        GROUP BY c.currency ORDER BY c.currency`,
      this.prisma.$queryRaw<{ currency: string; amount: string; clients: number }[]>`
        SELECT p.currency AS currency,
               SUM(monthly_fee_minor(COALESCE(s.spend, 0), p.fixed_fee_minor,
                                     p.percent_basis_points, p.minimum_fee_minor))::text AS amount,
               count(*)::int AS clients
        FROM fee_plans p
        JOIN clients cl ON cl.id = p.client_id AND cl.status <> 'ARCHIVED'
        LEFT JOIN LATERAL (
          SELECT SUM(m.spend_minor) AS spend
          FROM campaign_daily_metrics m
          JOIN campaigns ca ON ca.id = m.campaign_id
          WHERE ca.client_id = p.client_id AND ca.currency = p.currency
            AND m.date >= ${first}::date AND m.date <= ${last}::date
        ) s ON true
        WHERE p.cancelled_at IS NULL
          AND p.starts_on <= ${first}::date
          AND (p.ends_on IS NULL OR p.ends_on >= ${last}::date)
        GROUP BY p.currency ORDER BY p.currency`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM clients cl
        WHERE cl.status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM fee_plans p
          WHERE p.client_id = cl.id AND p.cancelled_at IS NULL
            AND p.starts_on <= ${first}::date
            AND (p.ends_on IS NULL OR p.ends_on >= ${last}::date))`,
    ]);

    return {
      month: first.slice(0, 7),
      activeCampaigns,
      spend: spendRows.map((row) => ({
        currency: row.currency,
        amount: fromMinor(BigInt(row.amount), row.currency),
      })),
      fees: feeRows.map((row) => ({
        currency: row.currency,
        amount: fromMinor(BigInt(row.amount), row.currency),
        clients: row.clients,
      })),
      activeClientsWithoutPlan: withoutPlan[0]?.total ?? 0,
    };
  }

  private async invoices(): Promise<AdminDashboard['invoices']> {
    const [due, counts] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ currency: string; amount: string; count: number }[]>`
        SELECT i.currency AS currency,
               SUM(i.total_minor - COALESCE(p.paid, 0))::text AS amount,
               count(*)::int AS count
        FROM invoices i
        LEFT JOIN LATERAL (
          SELECT SUM(amount_minor) AS paid FROM payments
          WHERE invoice_id = i.id AND voided_at IS NULL
        ) p ON true
        WHERE i.status = 'ISSUED' AND i.total_minor > COALESCE(p.paid, 0)
        GROUP BY i.currency ORDER BY i.currency`,
      this.prisma.$queryRaw<{ overdue: number; drafts: number }[]>`
        SELECT
          (SELECT count(*)::int FROM invoices i
           WHERE i.status = 'ISSUED' AND i.due_on < (now() AT TIME ZONE 'UTC')::date
             AND i.total_minor > COALESCE((SELECT SUM(amount_minor) FROM payments
                                           WHERE invoice_id = i.id AND voided_at IS NULL), 0)) AS overdue,
          (SELECT count(*)::int FROM invoices WHERE status = 'DRAFT') AS drafts`,
    ]);
    return {
      due: due.map((row) => ({
        currency: row.currency,
        amount: fromMinor(BigInt(row.amount), row.currency),
        count: row.count,
      })),
      overdue: counts[0]?.overdue ?? 0,
      drafts: counts[0]?.drafts ?? 0,
    };
  }
}
