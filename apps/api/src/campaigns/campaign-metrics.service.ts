import { Inject, Injectable } from '@nestjs/common';
import { auditRow } from '../audit/audit';
import { ClientArchivedError, ClientNotFoundError } from '../clients/clients.errors';
import { ClientIdSchema } from '../clients/clients.schemas';
import type { Actor } from '../clients/clients.service';
import type { CampaignDailyMetric, MetricSource } from '../generated/prisma/client';
import { fromMinor, MoneyFormatError, toMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';
import {
  CampaignArchivedError,
  CampaignNotFoundError,
  CampaignValidationError,
  FutureDayError,
} from './campaigns.errors';
import {
  CampaignIdSchema,
  day,
  MetricsRangeSchema,
  SaveDayMetricsSchema,
} from './campaigns.schemas';

// One day as the API returns it. Spend is money text in the campaign currency.
export interface DayMetrics {
  date: string;
  spend: string;
  impressions: number;
  clicks: number;
  conversions: string;
  source: MetricSource;
  updatedAt: Date;
}

export interface MetricsReport {
  campaignId: string;
  currency: string;
  from: string;
  to: string;
  // Days with numbers only, oldest first.
  days: DayMetrics[];
  totals: { spend: string; impressions: number; clicks: number; conversions: string };
}

const dayDate = (value: string) => new Date(`${value}T00:00:00Z`);

function toDay(row: CampaignDailyMetric, currency: string): DayMetrics {
  return {
    date: row.date.toISOString().slice(0, 10),
    spend: fromMinor(row.spendMinor, currency),
    impressions: Number(row.impressions),
    clicks: Number(row.clicks),
    conversions: row.conversions.toFixed(2),
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

type Db = Pick<PrismaService, 'client' | 'campaign'>;

// Daily numbers of a campaign (step 4.2, ADR 0018). Same isolation as the
// campaigns: client id AND campaign id on every query (IDOR). One row per
// campaign and day: saving a day again CORRECTS it (never counted twice).
@Injectable()
export class CampaignMetricsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async report(clientId: string, campaignId: string, query: unknown): Promise<MetricsReport> {
    const range = MetricsRangeSchema.safeParse(query);
    if (!range.success) throw new CampaignValidationError(range.error);
    const { from, to } = range.data;
    const campaign = await this.findCampaign(this.prisma, clientId, campaignId);

    const where = { campaignId: campaign.id, date: { gte: dayDate(from), lte: dayDate(to) } };
    const [rows, sums] = await this.prisma.$transaction([
      this.prisma.campaignDailyMetric.findMany({ where, orderBy: { date: 'asc' } }),
      this.prisma.campaignDailyMetric.aggregate({
        where,
        _sum: { spendMinor: true, impressions: true, clicks: true, conversions: true },
      }),
    ]);
    return {
      campaignId: campaign.id,
      currency: campaign.currency,
      from,
      to,
      days: rows.map((row) => toDay(row, campaign.currency)),
      totals: {
        spend: fromMinor(sums._sum.spendMinor ?? 0n, campaign.currency),
        impressions: Number(sums._sum.impressions ?? 0n),
        clicks: Number(sums._sum.clicks ?? 0n),
        conversions: sums._sum.conversions ? sums._sum.conversions.toFixed(2) : '0.00',
      },
    };
  }

  // Enters or corrects the numbers of one day.
  async saveDay(
    clientId: string,
    campaignId: string,
    date: string,
    input: unknown,
    actor: Actor,
    source: MetricSource = 'MANUAL',
  ): Promise<DayMetrics> {
    const parsedDate = day.safeParse(date);
    if (!parsedDate.success) {
      throw new CampaignValidationError({
        field: 'date',
        message: 'must be a date like 2026-11-15',
      });
    }
    // One day of margin: the client's time zone may already be "tomorrow".
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    if (parsedDate.data > tomorrow) throw new FutureDayError();
    const parsed = SaveDayMetricsSchema.safeParse(input);
    if (!parsed.success) throw new CampaignValidationError(parsed.error);

    return this.prisma.$transaction(async (tx) => {
      const campaign = await this.findCampaign(tx, clientId, campaignId);
      if (campaign.clientStatus === 'ARCHIVED') throw new ClientArchivedError();
      if (campaign.status === 'ARCHIVED') throw new CampaignArchivedError();

      let spendMinor: bigint;
      try {
        spendMinor = toMinor(parsed.data.spend, campaign.currency);
      } catch (error) {
        if (error instanceof MoneyFormatError) {
          throw new CampaignValidationError({ field: 'spend', message: error.message });
        }
        throw error;
      }
      const values = {
        spendMinor,
        impressions: parsed.data.impressions,
        clicks: parsed.data.clicks,
        conversions: parsed.data.conversions,
        source,
      };
      const key = { campaignId: campaign.id, date: dayDate(parsedDate.data) };
      const existing = await tx.campaignDailyMetric.findUnique({
        where: { campaignId_date: key },
        select: { id: true },
      });
      const row = await tx.campaignDailyMetric.upsert({
        where: { campaignId_date: key },
        create: { ...key, ...values },
        update: values,
      });
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.campaign_metrics.saved',
          metadata: {
            clientId,
            campaignId: campaign.id,
            date: parsedDate.data,
            corrected: existing !== null,
            source,
          },
        }),
      });
      return toDay(row, campaign.currency);
    });
  }

  // Ids that are not UUIDs are simply "not found" (no database error).
  private async findCampaign(db: Db, clientId: string, campaignId: string) {
    if (!ClientIdSchema.safeParse(clientId).success) throw new ClientNotFoundError();
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { status: true },
    });
    if (!client) throw new ClientNotFoundError();
    if (!CampaignIdSchema.safeParse(campaignId).success) throw new CampaignNotFoundError();
    // BOTH ids: a campaign of another client is not found (IDOR).
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, clientId },
      select: { id: true, status: true, currency: true },
    });
    if (!campaign) throw new CampaignNotFoundError();
    return { ...campaign, clientStatus: client.status };
  }
}
