import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { auditRow } from '../audit/audit';
import { ClientArchivedError, ClientNotFoundError } from '../clients/clients.errors';
import { ClientIdSchema } from '../clients/clients.schemas';
import type { Actor } from '../clients/clients.service';
import type { CampaignPlatform } from '../generated/prisma/client';
import { fromMinor, MoneyFormatError, toMinor } from '../money/money';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignValidationError, ImportHasErrorsError } from './campaigns.errors';
import { CsvFormatError, parseCampaignCsv, type RowError } from './csv-import';

// The request: the platform of the file, and its text (read in the browser).
const ImportRequestSchema = z
  .object({
    platform: z.enum(['META', 'GOOGLE']),
    csv: z.string().min(1).max(2_000_000),
  })
  .strict();

export type ImportProblem =
  RowError['reason'] | 'unknown_campaign' | 'archived_campaign' | 'bad_amount' | 'future_day';

export interface ImportRow {
  line: number;
  date: string;
  campaignId: string;
  campaignName: string;
  externalId: string;
  currency: string;
  spend: string;
  impressions: number;
  clicks: number;
  conversions: string;
  // new: no numbers yet for this day; correction: replaces the stored day.
  change: 'new' | 'correction';
}

export interface ImportPreview {
  platform: CampaignPlatform;
  rows: ImportRow[];
  errors: { line: number; reason: ImportProblem; externalId?: string }[];
  summary: { newDays: number; corrections: number; errors: number; campaigns: number };
}

interface PlannedRow {
  row: ImportRow;
  spendMinor: bigint;
}

type Db = Pick<PrismaService, 'client' | 'campaign' | 'campaignDailyMetric'>;

// CSV import of daily numbers (step 4.3, ADR 0018). Two calls with the same
// file: "preview" writes nothing; "commit" checks everything AGAIN and saves
// ALL lines in one transaction, or none. Lines are matched to campaigns of
// THIS client and platform only, by the platform campaign id (IDOR).
@Injectable()
export class CampaignImportService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async preview(clientId: string, input: unknown): Promise<ImportPreview> {
    const { preview } = await this.plan(this.prisma, clientId, input);
    return preview;
  }

  async commit(clientId: string, input: unknown, actor: Actor): Promise<ImportPreview> {
    return this.prisma.$transaction(
      async (tx) => {
        const { preview, planned } = await this.plan(tx, clientId, input);
        if (preview.errors.length > 0) throw new ImportHasErrorsError(preview.errors.length);

        for (const { row, spendMinor } of planned) {
          const key = { campaignId: row.campaignId, date: new Date(`${row.date}T00:00:00Z`) };
          const values = {
            spendMinor,
            impressions: BigInt(row.impressions),
            clicks: BigInt(row.clicks),
            conversions: row.conversions,
            source: 'CSV' as const,
          };
          await tx.campaignDailyMetric.upsert({
            where: { campaignId_date: key },
            create: { ...key, ...values },
            update: values,
          });
        }
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.campaign_metrics.imported',
            metadata: {
              clientId,
              platform: preview.platform,
              newDays: preview.summary.newDays,
              corrections: preview.summary.corrections,
              campaigns: preview.summary.campaigns,
            },
          }),
        });
        return preview;
      },
      // Up to 2000 lines: more than the default 5 seconds.
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private async plan(
    db: Db,
    clientId: string,
    input: unknown,
  ): Promise<{ preview: ImportPreview; planned: PlannedRow[] }> {
    if (!ClientIdSchema.safeParse(clientId).success) throw new ClientNotFoundError();
    const request = ImportRequestSchema.safeParse(input);
    if (!request.success) throw new CampaignValidationError(request.error);
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { status: true },
    });
    if (!client) throw new ClientNotFoundError();
    if (client.status === 'ARCHIVED') throw new ClientArchivedError();

    let parsed: ReturnType<typeof parseCampaignCsv>;
    try {
      parsed = parseCampaignCsv(request.data.csv);
    } catch (error) {
      if (error instanceof CsvFormatError) {
        throw new CampaignValidationError({
          field: 'csv',
          message: error.missing.length
            ? `${error.reason}: ${error.missing.join(',')}`
            : error.reason,
        });
      }
      throw error;
    }

    const platform = request.data.platform;
    const externalIds = [...new Set(parsed.rows.map((row) => row.externalId))];
    const campaigns = await db.campaign.findMany({
      where: { clientId, platform, externalId: { in: externalIds } },
      select: { id: true, name: true, externalId: true, status: true, currency: true },
    });
    const byExternalId = new Map(campaigns.map((campaign) => [campaign.externalId, campaign]));
    const existing = await db.campaignDailyMetric.findMany({
      where: {
        campaignId: { in: campaigns.map((campaign) => campaign.id) },
        date: { in: [...new Set(parsed.rows.map((row) => new Date(`${row.date}T00:00:00Z`)))] },
      },
      select: { campaignId: true, date: true },
    });
    const stored = new Set(
      existing.map((row) => `${row.campaignId}|${row.date.toISOString().slice(0, 10)}`),
    );
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const errors: ImportPreview['errors'] = [...parsed.errors];
    const planned: PlannedRow[] = [];
    for (const row of parsed.rows) {
      const campaign = byExternalId.get(row.externalId);
      const problem = (reason: ImportProblem) =>
        errors.push({ line: row.line, reason, externalId: row.externalId });
      if (!campaign) {
        problem('unknown_campaign');
        continue;
      }
      if (campaign.status === 'ARCHIVED') {
        problem('archived_campaign');
        continue;
      }
      if (row.date > tomorrow) {
        problem('future_day');
        continue;
      }
      let spendMinor: bigint;
      try {
        spendMinor = toMinor(row.spend, campaign.currency);
      } catch (error) {
        if (!(error instanceof MoneyFormatError)) throw error;
        problem('bad_amount');
        continue;
      }
      planned.push({
        spendMinor,
        row: {
          line: row.line,
          date: row.date,
          campaignId: campaign.id,
          campaignName: campaign.name,
          externalId: row.externalId,
          currency: campaign.currency,
          spend: fromMinor(spendMinor, campaign.currency),
          impressions: Number(row.impressions),
          clicks: Number(row.clicks),
          conversions: twoDecimals(row.conversions),
          change: stored.has(`${campaign.id}|${row.date}`) ? 'correction' : 'new',
        },
      });
    }
    errors.sort((a, b) => a.line - b.line);

    const rows = planned.map((entry) => entry.row);
    return {
      planned,
      preview: {
        platform,
        rows,
        errors,
        summary: {
          newDays: rows.filter((row) => row.change === 'new').length,
          corrections: rows.filter((row) => row.change === 'correction').length,
          errors: errors.length,
          campaigns: new Set(rows.map((row) => row.campaignId)).size,
        },
      },
    };
  }
}

// "2.5" -> "2.50", "3" -> "3.00": text only, no float.
function twoDecimals(value: string): string {
  const [whole = '0', cents = ''] = value.split('.');
  return `${whole}.${cents.padEnd(2, '0')}`;
}
