import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ClientArchivedError } from '../clients/clients.errors';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import { CampaignMetricsService } from './campaign-metrics.service';
import {
  CampaignArchivedError,
  CampaignNotFoundError,
  CampaignValidationError,
  CurrencyLockedError,
  FutureDayError,
} from './campaigns.errors';
import { CampaignsService } from './campaigns.service';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const prisma = createTestPrisma();
const db = prisma as unknown as PrismaService;
const metrics = new CampaignMetricsService(db);
const campaigns = new CampaignsService(db);
const actor = { userId: randomUUID(), ip: '203.0.113.9', userAgent: 'MetricsTest/1.0' };

async function newCampaign(currency = 'USD') {
  const client = await prisma.client.create({
    data: { name: `Metrics ${randomUUID()}`, currency },
  });
  const campaign = await campaigns.create(client.id, { platform: 'META', name: 'Daily' }, actor);
  return { clientId: client.id, campaignId: campaign.id };
}

const range = { from: '2026-10-01', to: '2026-10-31' };

describe('CampaignMetricsService (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('saves a day in minor units and returns it as text', async () => {
    const { clientId, campaignId } = await newCampaign();
    const saved = await metrics.saveDay(
      clientId,
      campaignId,
      '2026-10-05',
      { spend: '120.5', impressions: 15000, clicks: '320', conversions: 2.5 },
      actor,
    );
    expect(saved).toMatchObject({
      date: '2026-10-05',
      spend: '120.50',
      impressions: 15000,
      clicks: 320,
      conversions: '2.50',
      source: 'MANUAL',
    });
    const row = await prisma.campaignDailyMetric.findFirstOrThrow({ where: { campaignId } });
    expect(row.spendMinor).toBe(12050n);
  });

  it('saving the same day again CORRECTS it: never counted twice', async () => {
    const { clientId, campaignId } = await newCampaign();
    await metrics.saveDay(clientId, campaignId, '2026-10-07', { spend: '100' }, actor);
    await metrics.saveDay(clientId, campaignId, '2026-10-07', { spend: '80', clicks: 5 }, actor);

    expect(await prisma.campaignDailyMetric.count({ where: { campaignId } })).toBe(1);
    const report = await metrics.report(clientId, campaignId, range);
    expect(report.totals).toMatchObject({ spend: '80.00', clicks: 5 });

    const logs = (
      await prisma.auditLog.findMany({ where: { action: 'admin.campaign_metrics.saved' } })
    )
      .map((row) => row.metadata as { campaignId: string; corrected: boolean })
      .filter((meta) => meta.campaignId === campaignId);
    expect(logs.map((meta) => meta.corrected)).toEqual([false, true]);
  });

  it('reports the days of a range, oldest first, with exact totals', async () => {
    const { clientId, campaignId } = await newCampaign();
    await metrics.saveDay(
      clientId,
      campaignId,
      '2026-10-03',
      { spend: '0.1', conversions: '1.25' },
      actor,
    );
    await metrics.saveDay(
      clientId,
      campaignId,
      '2026-10-02',
      { spend: '0.2', impressions: 10 },
      actor,
    );
    await metrics.saveDay(clientId, campaignId, '2026-11-02', { spend: '999' }, actor);

    const report = await metrics.report(clientId, campaignId, range);
    expect(report.days.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03']);
    // 0.1 + 0.2 is exactly 0.30: no float
    expect(report.totals).toEqual({
      spend: '0.30',
      impressions: 10,
      clicks: 0,
      conversions: '1.25',
    });
    expect(report).toMatchObject({ currency: 'USD', from: '2026-10-01', to: '2026-10-31' });
    const empty = await metrics.report(clientId, campaignId, {
      from: '2025-01-01',
      to: '2025-01-31',
    });
    expect(empty.totals).toEqual({ spend: '0.00', impressions: 0, clicks: 0, conversions: '0.00' });
  });

  it('uses the decimals of the campaign currency', async () => {
    const { clientId, campaignId } = await newCampaign('JPY');
    expect(
      (await metrics.saveDay(clientId, campaignId, '2026-10-01', { spend: '1500' }, actor)).spend,
    ).toBe('1500');
    await expect(
      metrics.saveDay(clientId, campaignId, '2026-10-02', { spend: '1.5' }, actor),
    ).rejects.toBeInstanceOf(CampaignValidationError);
  });

  it('refuses bad numbers, bad dates, future days and too long ranges', async () => {
    const { clientId, campaignId } = await newCampaign();
    const save = (date: string, body: unknown) =>
      metrics.saveDay(clientId, campaignId, date, body, actor);
    for (const body of [
      {},
      { spend: '-1' },
      { spend: '1', clicks: 1.5 },
      { spend: '1', impressions: -3 },
      { spend: '1', conversions: '1.234' },
      { spend: '1', source: 'CSV' },
    ]) {
      await expect(save('2026-10-01', body)).rejects.toBeInstanceOf(CampaignValidationError);
    }
    await expect(save('2026-02-30', { spend: '1' })).rejects.toBeInstanceOf(
      CampaignValidationError,
    );
    await expect(save('2999-01-01', { spend: '1' })).rejects.toBeInstanceOf(FutureDayError);
    await expect(
      metrics.report(clientId, campaignId, { from: '2024-01-01', to: '2026-01-01' }),
    ).rejects.toBeInstanceOf(CampaignValidationError);
    await expect(
      metrics.report(clientId, campaignId, { from: '2026-10-10', to: '2026-10-01' }),
    ).rejects.toBeInstanceOf(CampaignValidationError);
  });

  it('IDOR: the numbers of a campaign are not reachable through another client', async () => {
    const mine = await newCampaign();
    const other = await newCampaign();
    await expect(metrics.report(other.clientId, mine.campaignId, range)).rejects.toBeInstanceOf(
      CampaignNotFoundError,
    );
    await expect(
      metrics.saveDay(other.clientId, mine.campaignId, '2026-10-01', { spend: '1' }, actor),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
    expect(await prisma.campaignDailyMetric.count({ where: { campaignId: mine.campaignId } })).toBe(
      0,
    );
  });

  it('refuses archived campaigns and clients', async () => {
    const { clientId, campaignId } = await newCampaign();
    await campaigns.changeStatus(clientId, campaignId, 'archive', actor);
    await expect(
      metrics.saveDay(clientId, campaignId, '2026-10-01', { spend: '1' }, actor),
    ).rejects.toBeInstanceOf(CampaignArchivedError);

    const second = await newCampaign();
    await prisma.client.update({ where: { id: second.clientId }, data: { status: 'ARCHIVED' } });
    await expect(
      metrics.saveDay(second.clientId, second.campaignId, '2026-10-01', { spend: '1' }, actor),
    ).rejects.toBeInstanceOf(ClientArchivedError);
  });

  it('locks the campaign currency once a day exists', async () => {
    const { clientId, campaignId } = await newCampaign();
    // No numbers yet: the currency may change
    await campaigns.update(clientId, campaignId, { currency: 'SAR' }, actor);
    await metrics.saveDay(clientId, campaignId, '2026-10-01', { spend: '5' }, actor);
    await expect(
      campaigns.update(clientId, campaignId, { currency: 'USD' }, actor),
    ).rejects.toBeInstanceOf(CurrencyLockedError);
    // Other fields still change
    await expect(
      campaigns.update(clientId, campaignId, { name: 'Renamed' }, actor),
    ).resolves.toBeDefined();
  });

  it('the database refuses DELETE and negative numbers', async () => {
    const { clientId, campaignId } = await newCampaign();
    await metrics.saveDay(clientId, campaignId, '2026-10-01', { spend: '5' }, actor);
    const row = await prisma.campaignDailyMetric.findFirstOrThrow({ where: { campaignId } });
    await expect(prisma.campaignDailyMetric.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE campaign_daily_metrics SET clicks = -1 WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow();
    // A campaign with numbers can never disappear either
    await expect(prisma.campaign.delete({ where: { id: campaignId } })).rejects.toThrow();
  });
});
