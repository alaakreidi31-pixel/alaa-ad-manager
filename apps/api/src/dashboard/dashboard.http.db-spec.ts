// HTTP tests of the administration home page summary (step 3.2).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSessionToken,
  httpCall,
  startHttpTestApp,
  type HttpTestApp,
} from '../testing/http-test-app';
import { createTestPrisma } from '../testing/test-prisma';
import type { AdminDashboard } from './dashboard.service';

// The real PrismaService reads .env at import time: replace it by a token.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const prisma = createTestPrisma();
let server: HttpTestApp;
let adminToken: string;

async function summary(): Promise<AdminDashboard> {
  const result = await httpCall(server.baseUrl, 'GET', '/admin/dashboard', adminToken);
  expect(result.status).toBe(200);
  return result.body as unknown as AdminDashboard;
}

describe('GET /api/admin/dashboard (HTTP, test database)', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
    adminToken = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('refuses a request without a token (401) and a client account (403)', async () => {
    expect((await httpCall(server.baseUrl, 'GET', '/admin/dashboard')).status).toBe(401);
    const client = await prisma.client.create({ data: { name: `Dash ${randomUUID()}` } });
    const { token } = await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id);
    const result = await httpCall(server.baseUrl, 'GET', '/admin/dashboard', token);
    expect(result.status).toBe(403);
    expect(result.body).not.toHaveProperty('clients');
  });

  it('counts clients by status, from the real data', async () => {
    const before = await summary();
    await prisma.client.create({ data: { name: `Dash active ${randomUUID()}` } });
    await prisma.client.create({
      data: { name: `Dash suspended ${randomUUID()}`, status: 'SUSPENDED' },
    });
    await prisma.client.create({
      data: { name: `Dash archived ${randomUUID()}`, status: 'ARCHIVED' },
    });
    const after = await summary();

    expect(after.clients.ACTIVE - before.clients.ACTIVE).toBe(1);
    expect(after.clients.SUSPENDED - before.clients.SUSPENDED).toBe(1);
    expect(after.clients.ARCHIVED - before.clients.ARCHIVED).toBe(1);
    expect(after.clients.total - before.clients.total).toBe(3);
    expect(after.clients.total).toBe(
      after.clients.ACTIVE + after.clients.SUSPENDED + after.clients.ARCHIVED,
    );
  });

  it('counts client accounts, suspended ones, and temporary passwords', async () => {
    const client = await prisma.client.create({ data: { name: `Dash accounts ${randomUUID()}` } });
    const before = await summary();
    const base = { passwordHash: 'x', role: 'CLIENT_USER' as const, clientId: client.id };
    const email = () => `dash-${randomUUID().slice(0, 8)}@alaa.test`;
    await prisma.user.create({ data: { ...base, email: email(), fullName: 'A' } });
    await prisma.user.create({
      data: { ...base, email: email(), fullName: 'B', mustChangePassword: true },
    });
    await prisma.user.create({
      data: { ...base, email: email(), fullName: 'C', status: 'SUSPENDED' },
    });
    const after = await summary();

    expect(after.accounts.total - before.accounts.total).toBe(3);
    expect(after.accounts.active - before.accounts.active).toBe(2);
    expect(after.accounts.suspended - before.accounts.suspended).toBe(1);
    expect(after.accounts.pendingPasswordChange - before.accounts.pendingPasswordChange).toBe(1);
  });

  it('lists the 5 most recent clients first, without internal notes', async () => {
    const newest = await prisma.client.create({
      data: { name: `Dash newest ${randomUUID()}`, internalNotes: 'SECRET DASH NOTE' },
    });
    const result = await summary();

    expect(result.recentClients.length).toBeLessThanOrEqual(5);
    expect(result.recentClients[0]?.id).toBe(newest.id);
    expect(JSON.stringify(result)).not.toContain('SECRET DASH NOTE');
  });

  it('sums the current month: spend per currency, fees from the plans, active campaigns', async () => {
    const before = await summary();
    const client = await prisma.client.create({
      data: { name: `Dash fees ${randomUUID()}`, currency: 'USD' },
    });
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    await prisma.feePlan.create({
      data: {
        clientId: client.id,
        currency: 'USD',
        fixedFeeMinor: 10000n,
        percentBasisPoints: 1000,
        startsOn: thisMonth,
      },
    });
    const campaign = await prisma.campaign.create({
      data: { clientId: client.id, platform: 'META', name: 'Dash spend', currency: 'USD' },
    });
    await prisma.campaignDailyMetric.create({
      data: { campaignId: campaign.id, date: thisMonth, spendMinor: 123456n, source: 'MANUAL' },
    });
    const after = await summary();

    const usd = (rows: { currency: string; amount: string }[]) =>
      Math.round(Number(rows.find((row) => row.currency === 'USD')?.amount ?? '0') * 100);
    // Spend +1234.56; fee +100.00 fixed + 10% of 1234.56 = 123.456 -> 123.46 = 223.46
    expect(usd(after.month.spend) - usd(before.month.spend)).toBe(123456);
    expect(usd(after.month.fees) - usd(before.month.fees)).toBe(22346);
    expect(after.month.activeCampaigns - before.month.activeCampaigns).toBe(1);
    expect(after.month.month).toBe(thisMonth.toISOString().slice(0, 7));
  });
});
