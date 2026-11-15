// HTTP tests of the client portal campaigns (step 4.5).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSessionToken,
  httpCall,
  startHttpTestApp,
  type HttpTestApp,
} from '../testing/http-test-app';
import { createTestPrisma } from '../testing/test-prisma';

// The real PrismaService reads .env at import time: replace it by a token.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const prisma = createTestPrisma();
let server: HttpTestApp;

async function clientWithCampaigns() {
  const client = await prisma.client.create({ data: { name: `Portal ${randomUUID()}` } });
  const make = (name: string, currency: string, status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') =>
    prisma.campaign.create({
      data: {
        clientId: client.id,
        platform: 'META',
        name,
        currency,
        status,
        externalId: randomUUID(),
      },
    });
  const usd = await make('Usd active', 'USD', 'ACTIVE');
  const sar = await make('Sar paused', 'SAR', 'PAUSED');
  const archived = await make('Old archived', 'USD', 'ARCHIVED');
  const day = (campaignId: string, date: string, spendMinor: bigint, conversions: string) =>
    prisma.campaignDailyMetric.create({
      data: {
        campaignId,
        date: new Date(`${date}T00:00:00Z`),
        spendMinor,
        impressions: 1000n,
        clicks: 10n,
        conversions,
        source: 'MANUAL',
      },
    });
  await day(usd.id, '2026-10-01', 1010n, '0.1');
  await day(usd.id, '2026-10-02', 2020n, '0.2');
  await day(sar.id, '2026-10-01', 50000n, '3');
  await day(archived.id, '2026-10-01', 999999n, '9');
  const { token } = await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id);
  return { token, usd, sar, archived };
}

describe('/api/client/campaigns over HTTP (client portal)', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('401 without a token, 403 for the administration (client accounts only)', async () => {
    const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    for (const path of ['/client/campaigns', '/client/campaign-summary']) {
      expect((await httpCall(server.baseUrl, 'GET', path)).status).toBe(401);
      expect((await httpCall(server.baseUrl, 'GET', path, admin)).status).toBe(403);
    }
  });

  it('lists only its own campaigns, never the archived ones nor the platform id', async () => {
    const mine = await clientWithCampaigns();
    await clientWithCampaigns(); // another client
    const result = await httpCall(server.baseUrl, 'GET', '/client/campaigns', mine.token);
    expect(result.status).toBe(200);
    const items = result.body as unknown as { name: string }[];
    expect(items.map((item) => item.name).sort()).toEqual(['Sar paused', 'Usd active']);
    expect(JSON.stringify(items)).not.toContain('externalId');
  });

  it('sums the period per currency, without the archived campaign', async () => {
    const { token } = await clientWithCampaigns();
    const result = await httpCall(
      server.baseUrl,
      'GET',
      '/client/campaign-summary?from=2026-10-01&to=2026-10-31',
      token,
    );
    expect(result.body).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      activeCampaigns: 1,
      totals: [
        { currency: 'SAR', spend: '500.00', impressions: 1000, clicks: 10, conversions: '3.00' },
        // 10.10 + 20.20 and 0.1 + 0.2: exact
        { currency: 'USD', spend: '30.30', impressions: 2000, clicks: 20, conversions: '0.30' },
      ],
    });
  });

  it('IDOR: daily numbers only for its own visible campaigns', async () => {
    const mine = await clientWithCampaigns();
    const other = await clientWithCampaigns();
    const range = '?from=2026-10-01&to=2026-10-31';
    const own = await httpCall(
      server.baseUrl,
      'GET',
      `/client/campaigns/${mine.usd.id}/metrics${range}`,
      mine.token,
    );
    expect(own).toMatchObject({ status: 200, body: { totals: { spend: '30.30' } } });

    for (const id of [other.usd.id, mine.archived.id, randomUUID(), 'not-a-uuid']) {
      const refused = await httpCall(
        server.baseUrl,
        'GET',
        `/client/campaigns/${id}/metrics${range}`,
        mine.token,
      );
      expect(refused).toMatchObject({ status: 404, body: { code: 'campaign_not_found' } });
    }
  });
});
