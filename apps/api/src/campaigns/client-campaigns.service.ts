import { Inject, Injectable } from '@nestjs/common';
import type { CampaignPlatform, CampaignStatus } from '../generated/prisma/client';
import { fromMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignMetricsService, type MetricsReport } from './campaign-metrics.service';
import { CampaignNotFoundError, CampaignValidationError } from './campaigns.errors';
import { CampaignIdSchema, MetricsRangeSchema } from './campaigns.schemas';

// What a CLIENT sees of its campaigns (step 4.5). Read only. Archived
// campaigns are hidden. The platform id and the dates of entry are not shown.
export interface ClientCampaign {
  id: string;
  platform: CampaignPlatform;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  currency: string;
  dailyBudget: string | null;
  startDate: string | null;
  endDate: string | null;
}

// Totals of a period, one line per currency (campaigns may use different
// currencies: amounts in different currencies are NEVER added together).
export interface ClientCampaignSummary {
  from: string;
  to: string;
  activeCampaigns: number;
  totals: {
    currency: string;
    spend: string;
    impressions: number;
    clicks: number;
    conversions: string;
  }[];
}

const VISIBLE = { not: 'ARCHIVED' as const };
const toDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

// The client id ALWAYS comes from the session (ClientUserGuard), never from
// the request: a client can only read its own campaigns.
@Injectable()
export class ClientCampaignsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CampaignMetricsService) private readonly metrics: CampaignMetricsService,
  ) {}

  async list(clientId: string): Promise<ClientCampaign[]> {
    const rows = await this.prisma.campaign.findMany({
      where: { clientId, status: VISIBLE },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      name: row.name,
      objective: row.objective,
      status: row.status,
      currency: row.currency,
      dailyBudget:
        row.dailyBudgetMinor === null ? null : fromMinor(row.dailyBudgetMinor, row.currency),
      startDate: toDay(row.startDate),
      endDate: toDay(row.endDate),
    }));
  }

  async summary(clientId: string, query: unknown): Promise<ClientCampaignSummary> {
    const range = MetricsRangeSchema.safeParse(query);
    if (!range.success) throw new CampaignValidationError(range.error);
    const { from, to } = range.data;

    const [activeCampaigns, campaigns, sums] = await this.prisma.$transaction([
      this.prisma.campaign.count({ where: { clientId, status: 'ACTIVE' } }),
      this.prisma.campaign.findMany({
        where: { clientId, status: VISIBLE },
        select: { id: true, currency: true },
      }),
      this.prisma.campaignDailyMetric.groupBy({
        by: ['campaignId'],
        where: {
          campaign: { clientId, status: VISIBLE },
          date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
        _sum: { spendMinor: true, impressions: true, clicks: true, conversions: true },
        orderBy: { campaignId: 'asc' },
      }),
    ]);

    const currencyOf = new Map(campaigns.map((campaign) => [campaign.id, campaign.currency]));
    const byCurrency = new Map<
      string,
      { spend: bigint; impressions: bigint; clicks: bigint; conversionCents: bigint }
    >();
    for (const row of sums) {
      const currency = currencyOf.get(row.campaignId);
      if (!currency) continue;
      const total = byCurrency.get(currency) ?? {
        spend: 0n,
        impressions: 0n,
        clicks: 0n,
        conversionCents: 0n,
      };
      const sum = row._sum as {
        spendMinor: bigint | null;
        impressions: bigint | null;
        clicks: bigint | null;
        conversions: { toFixed: (digits: number) => string } | null;
      };
      total.spend += sum.spendMinor ?? 0n;
      total.impressions += sum.impressions ?? 0n;
      total.clicks += sum.clicks ?? 0n;
      // Conversions have 2 decimals: added as whole hundredths, no float.
      total.conversionCents += BigInt((sum.conversions?.toFixed(2) ?? '0.00').replace('.', ''));
      byCurrency.set(currency, total);
    }

    return {
      from,
      to,
      activeCampaigns,
      totals: [...byCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, total]) => ({
          currency,
          spend: fromMinor(total.spend, currency),
          impressions: Number(total.impressions),
          clicks: Number(total.clicks),
          conversions: fromMinor(total.conversionCents, 'USD'),
        })),
    };
  }

  // The daily numbers of ONE of the client's own, visible campaigns.
  async campaignMetrics(
    clientId: string,
    campaignId: string,
    query: unknown,
  ): Promise<MetricsReport> {
    if (!CampaignIdSchema.safeParse(campaignId).success) throw new CampaignNotFoundError();
    const visible = await this.prisma.campaign.count({
      where: { id: campaignId, clientId, status: VISIBLE },
    });
    // Another client's campaign, or an archived one: simply "not found".
    if (visible === 0) throw new CampaignNotFoundError();
    return this.metrics.report(clientId, campaignId, query);
  }
}
