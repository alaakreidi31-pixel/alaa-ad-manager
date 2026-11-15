// HTTP tests of the daily numbers of a campaign (step 4.2).
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
let adminToken: string;
let clientToken: string;
let path: string;
let clientId: string;
let campaignId: string;

describe('/api/admin/clients/:clientId/campaigns/:campaignId/metrics over HTTP', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
    adminToken = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    clientId = (await prisma.client.create({ data: { name: `Http metrics ${randomUUID()}` } })).id;
    clientToken = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', clientId)).token;
    campaignId = (
      await prisma.campaign.create({
        data: { clientId, platform: 'GOOGLE', name: 'Http daily', currency: 'USD' },
      })
    ).id;
    path = `/admin/clients/${clientId}/campaigns/${campaignId}/metrics`;
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('refuses no token (401) and a client account (403)', async () => {
    for (const [method, url, body] of [
      ['GET', path, undefined],
      ['PUT', `${path}/2026-10-01`, { spend: '1' }],
    ] as const) {
      expect((await httpCall(server.baseUrl, method, url, undefined, body)).status).toBe(401);
      expect((await httpCall(server.baseUrl, method, url, clientToken, body)).status).toBe(403);
    }
  });

  it('saves a day with PUT and reports it with totals', async () => {
    const saved = await httpCall(server.baseUrl, 'PUT', `${path}/2026-10-04`, adminToken, {
      spend: '45.5',
      impressions: 9000,
      clicks: 210,
      conversions: '3',
    });
    expect(saved).toMatchObject({ status: 200, body: { spend: '45.50', conversions: '3.00' } });

    const report = await httpCall(
      server.baseUrl,
      'GET',
      `${path}?from=2026-10-01&to=2026-10-31`,
      adminToken,
    );
    expect(report.status).toBe(200);
    expect(report.body['totals']).toEqual({
      spend: '45.50',
      impressions: 9000,
      clicks: 210,
      conversions: '3.00',
    });
  });

  it('answers with stable error codes', async () => {
    const bad = await httpCall(server.baseUrl, 'PUT', `${path}/2026-10-01`, adminToken, {
      spend: 'abc',
    });
    expect(bad).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
    const future = await httpCall(server.baseUrl, 'PUT', `${path}/2999-01-01`, adminToken, {
      spend: '1',
    });
    expect(future).toMatchObject({ status: 400, body: { code: 'future_day' } });

    const locked = await httpCall(
      server.baseUrl,
      'PATCH',
      `/admin/clients/${clientId}/campaigns/${campaignId}`,
      adminToken,
      { currency: 'EUR' },
    );
    expect(locked).toMatchObject({ status: 409, body: { code: 'currency_locked' } });
  });

  it('IDOR: another client id gives 404, and nothing is written', async () => {
    const otherId = (await prisma.client.create({ data: { name: `Other ${randomUUID()}` } })).id;
    const other = `/admin/clients/${otherId}/campaigns/${campaignId}/metrics`;
    expect((await httpCall(server.baseUrl, 'GET', other, adminToken)).status).toBe(404);
    const write = await httpCall(server.baseUrl, 'PUT', `${other}/2026-10-20`, adminToken, {
      spend: '1',
    });
    expect(write).toMatchObject({ status: 404, body: { code: 'campaign_not_found' } });
    expect(
      await prisma.campaignDailyMetric.count({
        where: { campaignId, date: new Date('2026-10-20T00:00:00Z') },
      }),
    ).toBe(0);
  });
});
