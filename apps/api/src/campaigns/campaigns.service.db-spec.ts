import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ClientArchivedError, ClientNotFoundError } from '../clients/clients.errors';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import {
  CampaignArchivedError,
  CampaignNotFoundError,
  CampaignValidationError,
  ExternalIdTakenError,
  InvalidCampaignStatusChangeError,
} from './campaigns.errors';
import { CampaignsService } from './campaigns.service';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

// Connects as alaa_app, exactly like the running API.
const prisma = createTestPrisma();
const service = new CampaignsService(prisma as unknown as PrismaService);
const actor = { userId: randomUUID(), ip: '203.0.113.9', userAgent: 'CampaignsTest/1.0' };

// Nothing can be deleted: every test creates its own client.
const newClient = (data: { currency?: string; status?: 'ARCHIVED' } = {}) =>
  prisma.client.create({ data: { name: `Campaigns ${randomUUID()}`, ...data } });

async function auditFor(campaignId: string) {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.filter(
    (row) => (row.metadata as { campaignId?: string } | null)?.campaignId === campaignId,
  );
}

describe('CampaignsService (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an ACTIVE campaign in the client currency, and audits it', async () => {
    const client = await newClient({ currency: 'SAR' });
    const campaign = await service.create(
      client.id,
      {
        platform: 'META',
        name: '  Ramadan  ',
        externalId: '120210000001',
        dailyBudget: '150.5',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      },
      actor,
    );
    expect(campaign).toMatchObject({
      clientId: client.id,
      platform: 'META',
      name: 'Ramadan',
      status: 'ACTIVE',
      currency: 'SAR',
      dailyBudget: '150.50',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
    const [row] = await auditFor(campaign.id);
    expect(row).toMatchObject({ action: 'admin.campaign.created', userId: actor.userId });
  });

  it('keeps an explicit currency different from the client', async () => {
    const client = await newClient({ currency: 'SAR' });
    const campaign = await service.create(
      client.id,
      { platform: 'GOOGLE', name: 'Search', currency: 'usd' },
      actor,
    );
    expect(campaign.currency).toBe('USD');
  });

  it('refuses invalid data, an unknown client, and an archived client', async () => {
    const client = await newClient();
    await expect(service.create(client.id, { platform: 'META' }, actor)).rejects.toBeInstanceOf(
      CampaignValidationError,
    );
    await expect(
      service.create(randomUUID(), { platform: 'META', name: 'X campaign' }, actor),
    ).rejects.toBeInstanceOf(ClientNotFoundError);
    await expect(
      service.create('not-a-uuid', { platform: 'META', name: 'X campaign' }, actor),
    ).rejects.toBeInstanceOf(ClientNotFoundError);
    const archived = await newClient({ status: 'ARCHIVED' });
    await expect(
      service.create(archived.id, { platform: 'META', name: 'X campaign' }, actor),
    ).rejects.toBeInstanceOf(ClientArchivedError);
  });

  it('stores money in minor units with the decimals of the currency (ADR 0008)', async () => {
    const client = await newClient({ currency: 'USD' });
    const campaign = await service.create(
      client.id,
      { platform: 'META', name: 'Cents', dailyBudget: '150.5' },
      actor,
    );
    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(row.dailyBudgetMinor).toBe(15050n);
    expect(campaign.dailyBudget).toBe('150.50');

    // 1.5 yen does not exist: refused, and so is a change to JPY that would lose cents
    await expect(
      service.create(
        client.id,
        { platform: 'META', name: 'Yen', currency: 'JPY', dailyBudget: '1.5' },
        actor,
      ),
    ).rejects.toBeInstanceOf(CampaignValidationError);
    await expect(
      service.update(client.id, campaign.id, { currency: 'JPY' }, actor),
    ).rejects.toBeInstanceOf(CampaignValidationError);

    // A whole amount converts: 150.00 USD -> 150 SAR (the number, not an exchange rate)
    await service.update(client.id, campaign.id, { dailyBudget: '150' }, actor);
    const sar = await service.update(client.id, campaign.id, { currency: 'SAR' }, actor);
    expect(sar).toMatchObject({ currency: 'SAR', dailyBudget: '150.00' });
    // "150" and "150.00" are the same amount: nothing changes, nothing is logged
    const before = await auditFor(campaign.id);
    await service.update(client.id, campaign.id, { dailyBudget: '150.00' }, actor);
    expect(await auditFor(campaign.id)).toHaveLength(before.length);
  });

  it('refuses the same platform id twice for one client, but not for another', async () => {
    const client = await newClient();
    const other = await newClient();
    const data = { platform: 'META', name: 'Dup', externalId: 'ext-1' };
    await service.create(client.id, data, actor);
    await expect(service.create(client.id, data, actor)).rejects.toBeInstanceOf(
      ExternalIdTakenError,
    );
    await expect(
      service.create(client.id, { ...data, platform: 'GOOGLE' }, actor),
    ).resolves.toBeDefined();
    await expect(service.create(other.id, data, actor)).resolves.toBeDefined();
    // Manual campaigns without a platform id: as many as needed
    await service.create(client.id, { platform: 'META', name: 'Manual 1' }, actor);
    await service.create(client.id, { platform: 'META', name: 'Manual 2' }, actor);
  });

  it('lists only the campaigns of the client, with filters', async () => {
    const client = await newClient();
    const other = await newClient();
    await service.create(client.id, { platform: 'META', name: 'Meta one' }, actor);
    await service.create(client.id, { platform: 'GOOGLE', name: 'Google one' }, actor);
    await service.create(other.id, { platform: 'META', name: 'Not mine' }, actor);

    const all = await service.list(client.id, {});
    expect(all.total).toBe(2);
    expect(all.items.every((item) => item.clientId === client.id)).toBe(true);
    const google = await service.list(client.id, { platform: 'GOOGLE' });
    expect(google.items.map((item) => item.name)).toEqual(['Google one']);
    await expect(service.list(client.id, { status: 'BAD' })).rejects.toBeInstanceOf(
      CampaignValidationError,
    );
  });

  it('IDOR: a campaign is not found through another client', async () => {
    const client = await newClient();
    const other = await newClient();
    const campaign = await service.create(client.id, { platform: 'META', name: 'Mine' }, actor);

    await expect(service.get(other.id, campaign.id)).rejects.toBeInstanceOf(CampaignNotFoundError);
    await expect(
      service.update(other.id, campaign.id, { name: 'Stolen' }, actor),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
    await expect(
      service.changeStatus(other.id, campaign.id, 'pause', actor),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
    expect((await service.get(client.id, campaign.id)).name).toBe('Mine');
  });

  it('updates only what changed, logs field names, and checks dates with stored values', async () => {
    const client = await newClient();
    const campaign = await service.create(
      client.id,
      { platform: 'META', name: 'Before', startDate: '2026-11-10' },
      actor,
    );
    const updated = await service.update(
      client.id,
      campaign.id,
      { name: 'After', dailyBudget: 99 },
      actor,
    );
    expect(updated).toMatchObject({ name: 'After', dailyBudget: '99.00' });
    const rows = await auditFor(campaign.id);
    expect(rows.at(-1)?.metadata).toMatchObject({ fields: 'name,dailyBudget' });

    await expect(
      service.update(client.id, campaign.id, { endDate: '2026-11-01' }, actor),
    ).rejects.toBeInstanceOf(CampaignValidationError);
    // Same values: nothing written
    await service.update(client.id, campaign.id, { name: 'After' }, actor);
    expect(await auditFor(campaign.id)).toHaveLength(rows.length);
  });

  it('follows the allowed status changes; an archived campaign is read-only', async () => {
    const client = await newClient();
    const { id } = await service.create(client.id, { platform: 'GOOGLE', name: 'Life' }, actor);

    expect((await service.changeStatus(client.id, id, 'pause', actor)).status).toBe('PAUSED');
    await expect(service.changeStatus(client.id, id, 'pause', actor)).rejects.toBeInstanceOf(
      InvalidCampaignStatusChangeError,
    );
    expect((await service.changeStatus(client.id, id, 'end', actor)).status).toBe('ENDED');
    expect((await service.changeStatus(client.id, id, 'archive', actor)).status).toBe('ARCHIVED');
    await expect(service.update(client.id, id, { name: 'Changed' }, actor)).rejects.toBeInstanceOf(
      CampaignArchivedError,
    );
    expect((await service.changeStatus(client.id, id, 'activate', actor)).status).toBe('ACTIVE');

    const rows = await auditFor(id);
    expect(rows.filter((row) => row.action === 'admin.campaign.status_changed')).toHaveLength(4);
  });

  it('the database itself refuses DELETE and invalid rows', async () => {
    const client = await newClient();
    const { id } = await service.create(client.id, { platform: 'META', name: 'Kept' }, actor);
    await expect(prisma.campaign.delete({ where: { id } })).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE campaigns SET daily_budget_minor = -1 WHERE id = ${id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE campaigns SET start_date = '2026-12-01', end_date = '2026-11-01' WHERE id = ${id}::uuid`,
    ).rejects.toThrow();
    // A client with campaigns can never be deleted either (RESTRICT)
    await expect(prisma.client.delete({ where: { id: client.id } })).rejects.toThrow();
    expect(await prisma.campaign.count({ where: { id } })).toBe(1);
  });
});
