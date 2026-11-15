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
import { CampaignImportService } from './campaign-import.service';
import { CampaignValidationError, ImportHasErrorsError } from './campaigns.errors';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const prisma = createTestPrisma();
const service = new CampaignImportService(prisma as unknown as PrismaService);
const actor = { userId: randomUUID(), ip: '203.0.113.9', userAgent: 'ImportTest/1.0' };

const HEADER = 'Day,Campaign ID,Cost,Impr.,Clicks,Conversions';

async function setup() {
  const client = await prisma.client.create({ data: { name: `Import ${randomUUID()}` } });
  const ext = `ext-${randomUUID().slice(0, 8)}`;
  const campaign = await prisma.campaign.create({
    data: {
      clientId: client.id,
      platform: 'GOOGLE',
      name: 'Imported',
      currency: 'USD',
      externalId: ext,
    },
  });
  return { clientId: client.id, campaignId: campaign.id, ext };
}

const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

describe('CampaignImportService (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('preview writes nothing and marks new days and corrections', async () => {
    const { clientId, campaignId, ext } = await setup();
    await prisma.campaignDailyMetric.create({
      data: {
        campaignId,
        date: new Date('2026-10-02T00:00:00Z'),
        spendMinor: 100n,
        source: 'MANUAL',
      },
    });
    const preview = await service.preview(clientId, {
      platform: 'GOOGLE',
      csv: csv(`2026-10-01,${ext},10.5,100,4,1`, `2026-10-02,${ext},20,200,8,2.5`),
    });
    expect(preview.summary).toEqual({ newDays: 1, corrections: 1, errors: 0, campaigns: 1 });
    expect(preview.rows[0]).toMatchObject({ spend: '10.50', conversions: '1.00', change: 'new' });
    expect(preview.rows[1]).toMatchObject({ change: 'correction', conversions: '2.50' });
    expect(await prisma.campaignDailyMetric.count({ where: { campaignId } })).toBe(1);
  });

  it('commit saves every line as CSV, and importing again never duplicates', async () => {
    const { clientId, campaignId, ext } = await setup();
    const file = {
      platform: 'GOOGLE',
      csv: csv(`2026-10-01,${ext},10,100,4,1`, `2026-10-02,${ext},20,200,8,2`),
    };
    await service.commit(clientId, file, actor);
    const again = await service.commit(clientId, file, actor);
    expect(again.summary).toMatchObject({ newDays: 0, corrections: 2 });

    const rows = await prisma.campaignDailyMetric.findMany({
      where: { campaignId },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((row) => [row.spendMinor, row.source])).toEqual([
      [1000n, 'CSV'],
      [2000n, 'CSV'],
    ]);
    const audits = (
      await prisma.auditLog.findMany({ where: { action: 'admin.campaign_metrics.imported' } })
    )
      .map((row) => row.metadata as { clientId: string })
      .filter((meta) => meta.clientId === clientId);
    expect(audits).toHaveLength(2);
  });

  it('all or nothing: one bad line and NOTHING is saved', async () => {
    const { clientId, campaignId, ext } = await setup();
    const file = {
      platform: 'GOOGLE',
      csv: csv(
        `2026-10-01,${ext},10,100,4,1`,
        '2026-10-02,unknown-id,20,200,8,2',
        `2026-10-03,${ext},1.234,1,1,0`,
      ),
    };
    const preview = await service.preview(clientId, file);
    expect(preview.errors).toEqual([
      { line: 3, reason: 'unknown_campaign', externalId: 'unknown-id' },
      { line: 4, reason: 'bad_amount', externalId: ext },
    ]);
    await expect(service.commit(clientId, file, actor)).rejects.toBeInstanceOf(
      ImportHasErrorsError,
    );
    expect(await prisma.campaignDailyMetric.count({ where: { campaignId } })).toBe(0);
  });

  it('IDOR: matches only campaigns of THIS client and platform', async () => {
    const mine = await setup();
    const other = await setup();
    // The other client's platform id, and my id on the wrong platform: unknown
    const result = await service.preview(mine.clientId, {
      platform: 'GOOGLE',
      csv: csv(`2026-10-01,${other.ext},10,100,4,1`),
    });
    expect(result.errors[0]).toMatchObject({ reason: 'unknown_campaign' });
    const wrongPlatform = await service.preview(mine.clientId, {
      platform: 'META',
      csv: csv(`2026-10-01,${mine.ext},10,100,4,1`),
    });
    expect(wrongPlatform.errors[0]).toMatchObject({ reason: 'unknown_campaign' });
  });

  it('refuses archived campaigns, future days, and files without the columns', async () => {
    const { clientId, campaignId, ext } = await setup();
    const preview = await service.preview(clientId, {
      platform: 'GOOGLE',
      csv: csv(`2999-01-01,${ext},1,1,1,0`),
    });
    expect(preview.errors[0]).toMatchObject({ reason: 'future_day' });
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ARCHIVED' } });
    const archived = await service.preview(clientId, {
      platform: 'GOOGLE',
      csv: csv(`2026-10-01,${ext},1,1,1,0`),
    });
    expect(archived.errors[0]).toMatchObject({ reason: 'archived_campaign' });
    await expect(
      service.preview(clientId, { platform: 'GOOGLE', csv: 'Day,Cost\n2026-10-01,5' }),
    ).rejects.toBeInstanceOf(CampaignValidationError);
  });
});

describe('/api/admin/clients/:clientId/campaign-imports over HTTP', () => {
  let server: HttpTestApp;
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
  });
  afterAll(async () => {
    await server.close();
  });

  it('401 without a token, 403 for a client, 200 then 409 codes for the admin', async () => {
    const { clientId, ext } = await setup();
    const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    const client = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', clientId)).token;
    const base = `/admin/clients/${clientId}/campaign-imports`;
    const good = { platform: 'GOOGLE', csv: csv(`2026-10-01,${ext},10,100,4,1`) };

    expect(
      (await httpCall(server.baseUrl, 'POST', `${base}/preview`, undefined, good)).status,
    ).toBe(401);
    expect((await httpCall(server.baseUrl, 'POST', `${base}/commit`, client, good)).status).toBe(
      403,
    );
    const preview = await httpCall(server.baseUrl, 'POST', `${base}/preview`, admin, good);
    expect(preview).toMatchObject({ status: 200, body: { summary: { newDays: 1 } } });
    const committed = await httpCall(server.baseUrl, 'POST', `${base}/commit`, admin, good);
    expect(committed.status).toBe(200);

    const bad = { platform: 'GOOGLE', csv: csv('2026-10-01,nope,10,100,4,1') };
    const refused = await httpCall(server.baseUrl, 'POST', `${base}/commit`, admin, bad);
    expect(refused).toMatchObject({ status: 409, body: { code: 'import_has_errors' } });
  });
});
