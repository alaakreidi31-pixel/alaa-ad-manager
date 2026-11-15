import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createSessionToken,
  httpCall,
  startHttpTestApp,
  type HttpTestApp,
} from '../testing/http-test-app';
import { createTestPrisma } from '../testing/test-prisma';
import { ReportsService, ReportValidationError } from './reports.service';

// The real PrismaService reads .env at import time: replace it by a token.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const prisma = createTestPrisma();
const service = new ReportsService(prisma as unknown as PrismaService);

// A client with Meta and Google campaigns in USD, one in SAR, one archived.
async function setup() {
  const client = await prisma.client.create({ data: { name: `Reports ${randomUUID()}` } });
  const make = (
    name: string,
    platform: 'META' | 'GOOGLE',
    currency: string,
    status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
  ) => prisma.campaign.create({ data: { clientId: client.id, platform, name, currency, status } });
  const meta = await make('Meta usd', 'META', 'USD');
  const google = await make('Google usd', 'GOOGLE', 'USD');
  const sar = await make('Meta sar', 'META', 'SAR');
  const old = await make('Old archived', 'GOOGLE', 'USD', 'ARCHIVED');
  const day = (
    campaignId: string,
    date: string,
    spendMinor: bigint,
    impressions: bigint,
    clicks: bigint,
    conversions: string,
  ) =>
    prisma.campaignDailyMetric.create({
      data: {
        campaignId,
        date: new Date(`${date}T00:00:00Z`),
        spendMinor,
        impressions,
        clicks,
        conversions,
        source: 'MANUAL',
      },
    });
  await day(meta.id, '2026-10-05', 1010n, 1000n, 10n, '0.1');
  await day(meta.id, '2026-10-06', 2020n, 1000n, 30n, '0.2');
  await day(google.id, '2026-10-06', 5000n, 2000n, 40n, '1');
  await day(sar.id, '2026-10-06', 999999n, 1n, 1n, '9');
  await day(old.id, '2026-10-07', 7000n, 1000n, 20n, '1');
  return { client, meta, google, sar, old };
}

const range = { from: '2026-10-01', to: '2026-10-31' };

describe('ReportsService (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('performance: every day of the range, spend per platform, one currency, exact totals', async () => {
    const { client } = await setup();
    const report = await service.performance({ ...range, clientId: client.id, currency: 'USD' });
    expect(report.currencies).toEqual(['SAR', 'USD']); // most spend first
    expect(report.points).toHaveLength(31); // empty days included
    expect(report.points.find((p) => p.period === '2026-10-06')).toEqual({
      period: '2026-10-06',
      spend: { meta: '20.20', google: '50.00', total: '70.20' },
      conversions: { meta: '0.20', google: '1.00', total: '1.20' },
      impressions: 3000,
      clicks: 70,
    });
    // 10.10 + 20.20 + 50.00 + 70.00 (archived, still the agency's history)
    expect(report.totals).toEqual({
      spend: '150.30',
      impressions: 5000,
      clicks: 100,
      conversions: '2.30',
      ctr: '2.00',
      cpc: '1.50',
      cpa: '65.35',
    });
  });

  it('performance: weekly and monthly periods, platform filter, and the default currency', async () => {
    const { client } = await setup();
    const weekly = await service.performance({
      ...range,
      clientId: client.id,
      currency: 'USD',
      granularity: 'week',
    });
    expect(weekly.points.map((p) => p.period)).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(weekly.points[1]?.spend.total).toBe('150.30');
    const monthly = await service.performance({
      ...range,
      clientId: client.id,
      granularity: 'month',
    });
    // Default currency = most spend (SAR here): money is never mixed
    expect(monthly).toMatchObject({
      currency: 'SAR',
      points: [{ period: '2026-10-01', spend: { total: '9999.99' } }],
    });
    const google = await service.performance({
      ...range,
      clientId: client.id,
      currency: 'USD',
      platform: 'GOOGLE',
    });
    expect(google.totals.spend).toBe('120.00');
  });

  it('the client portal hides archived campaigns', async () => {
    const { client } = await setup();
    const portal = await service.performance(
      { ...range, currency: 'USD' },
      { portal: true, clientId: client.id },
    );
    expect(portal.totals.spend).toBe('80.30');
    const campaigns = await service.campaigns(
      { ...range, currency: 'USD' },
      { portal: true, clientId: client.id },
    );
    expect(campaigns.items.map((item) => item.name)).toEqual(['Google usd', 'Meta usd']);
  });

  it('campaigns: compared by spend, with ratios computed by PostgreSQL', async () => {
    const { client } = await setup();
    const report = await service.campaigns({ ...range, clientId: client.id, currency: 'USD' });
    expect(report.items[0]).toMatchObject({ name: 'Old archived', spend: '70.00' });
    expect(report.items.find((item) => item.name === 'Meta usd')).toMatchObject({
      spend: '30.30',
      impressions: 2000,
      clicks: 40,
      conversions: '0.30',
      ctr: '2.00',
      cpc: '0.76', // 3030 / 40 = 75.75 -> 76 cents
      cpa: '101.00',
    });
  });

  it('no data: empty but complete, never invented numbers', async () => {
    const client = await prisma.client.create({ data: { name: `Reports empty ${randomUUID()}` } });
    const report = await service.performance({ ...range, clientId: client.id });
    expect(report).toMatchObject({ currencies: [], currency: null });
    expect(report.points.every((p) => p.spend.total === '0' && p.clicks === 0)).toBe(true);
    expect(report.totals).toMatchObject({ ctr: null, cpc: null, cpa: null });
    expect((await service.campaigns({ ...range, clientId: client.id })).items).toEqual([]);
  });

  it('refuses invalid or too long ranges', async () => {
    await expect(
      service.performance({ from: '2020-01-01', to: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ReportValidationError);
    await expect(service.performance({ granularity: 'year' })).rejects.toBeInstanceOf(
      ReportValidationError,
    );
    await expect(service.performance({ currency: 'XYZ' })).rejects.toBeInstanceOf(
      ReportValidationError,
    );
    await expect(service.finance({ from: '2020-01', to: '2026-01' })).rejects.toBeInstanceOf(
      ReportValidationError,
    );
  });

  it('finance: invoiced and collected per month and currency, and what is still due', async () => {
    // The test database keeps earlier runs: compare before and after.
    const kwdOf = (report: Awaited<ReturnType<typeof service.finance>>) =>
      report.currencies.find((block) => block.currency === 'KWD');
    const before = kwdOf(await service.finance({}));
    const client = await prisma.client.create({
      data: { name: `Reports finance ${randomUUID()}` },
    });
    const now = new Date();
    const monthStart = (offset: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const plan = await prisma.feePlan.create({
      data: {
        clientId: client.id,
        currency: 'KWD',
        fixedFeeMinor: 100000n,
        startsOn: monthStart(-1),
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        clientId: client.id,
        feePlanId: plan.id,
        periodMonth: monthStart(-1),
        currency: 'KWD',
        spendMinor: 0,
        fixedFeeMinor: 100000n,
        percentBasisPoints: 0,
        variableFeeMinor: 0n,
        totalMinor: 100000n,
      },
    });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'ISSUED' } });
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amountMinor: 25000n,
        paidOn: new Date(now.toISOString().slice(0, 10)),
        method: 'CASH',
      },
    });
    const report = await service.finance({});
    const kwd = kwdOf(report);
    const thisMonth = monthStart(0).toISOString().slice(0, 7);
    const lastMonth = monthStart(-1).toISOString().slice(0, 7);
    // KWD has 3 decimals; the difference is exact at this size.
    const delta = (after?: string, earlier?: string) =>
      (Number(after ?? 0) - Number(earlier ?? 0)).toFixed(3);
    const month = (block: typeof kwd, key: string) => block?.months.find((m) => m.month === key);
    expect(delta(month(kwd, lastMonth)?.invoiced, month(before, lastMonth)?.invoiced)).toBe(
      '100.000',
    );
    expect(delta(month(kwd, thisMonth)?.collected, month(before, thisMonth)?.collected)).toBe(
      '25.000',
    );
    expect(delta(kwd?.outstanding, before?.outstanding)).toBe('75.000');
    expect(report.currencies.every((block) => block.months.length === 13)).toBe(true);
  });
});

describe('/api/admin/reports and /api/client/reports over HTTP', () => {
  let server: HttpTestApp;
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
  });
  afterAll(async () => {
    await server.close();
  });

  it('admin routes: 401 / 403 for a client; client routes: 403 for the admin', async () => {
    const { client } = await setup();
    const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    const user = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id)).token;
    for (const path of [
      '/admin/reports/performance',
      '/admin/reports/campaigns',
      '/admin/reports/finance',
    ]) {
      expect((await httpCall(server.baseUrl, 'GET', path)).status).toBe(401);
      expect((await httpCall(server.baseUrl, 'GET', path, user)).status).toBe(403);
      expect((await httpCall(server.baseUrl, 'GET', path, admin)).status).toBe(200);
    }
    for (const path of ['/client/reports/performance', '/client/reports/campaigns']) {
      expect((await httpCall(server.baseUrl, 'GET', path, admin)).status).toBe(403);
    }
    const bad = await httpCall(
      server.baseUrl,
      'GET',
      '/admin/reports/performance?granularity=year',
      admin,
    );
    expect(bad).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
  });

  it('IDOR: a clientId in the portal query is ignored (the session decides)', async () => {
    const mine = await setup();
    const other = await setup();
    const user = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', mine.client.id))
      .token;
    const result = await httpCall(
      server.baseUrl,
      'GET',
      `/client/reports/campaigns?from=2026-10-01&to=2026-10-31&currency=USD&clientId=${other.client.id}`,
      user,
    );
    const items = result.body['items'] as { clientId: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.clientId === mine.client.id)).toBe(true);
  });
});
