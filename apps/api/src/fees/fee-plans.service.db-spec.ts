import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ClientArchivedError, ClientNotFoundError } from '../clients/clients.errors';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import {
  FeePlanCannotCancelError,
  FeePlanNotFoundError,
  FeePlanOverlapError,
  FeePlanStartsTooEarlyError,
  FeePlanValidationError,
} from './fee-plans.errors';
import { FeePlansService } from './fee-plans.service';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const prisma = createTestPrisma();
const service = new FeePlansService(prisma as unknown as PrismaService);
const actor = { userId: randomUUID(), ip: '203.0.113.9', userAgent: 'FeesTest/1.0' };

// "YYYY-MM" N months from now (UTC).
function month(offset: number): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return date.toISOString().slice(0, 7);
}
const lastDay = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0))
    .toISOString()
    .slice(0, 10);
};

async function newClient(currency = 'USD') {
  return prisma.client.create({ data: { name: `Fees ${randomUUID()}`, currency } });
}

async function spend(clientId: string, currency: string, monthOffset: number, minor: bigint) {
  const campaign = await prisma.campaign.create({
    data: { clientId, platform: 'META', name: `Spend ${randomUUID()}`, currency },
  });
  await prisma.campaignDailyMetric.create({
    data: {
      campaignId: campaign.id,
      date: new Date(`${month(monthOffset)}-10T00:00:00Z`),
      spendMinor: minor,
      source: 'MANUAL',
    },
  });
}

async function auditFor(clientId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { action: { startsWith: 'admin.fee_plan.' } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.filter((row) => (row.metadata as { clientId?: string }).clientId === clientId);
}

describe('FeePlansService (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the first plan (it may start in a past month) and audits its terms', async () => {
    const client = await newClient();
    const plan = await service.create(
      client.id,
      { fixedFee: '100', percent: '7.5', minimumFee: '300', startsOn: month(-3) },
      actor,
    );
    expect(plan).toMatchObject({
      currency: 'USD',
      fixedFee: '100.00',
      percent: '7.50',
      minimumFee: '300.00',
      startsOn: `${month(-3)}-01`,
      endsOn: null,
      status: 'active',
    });
    const [created] = await auditFor(client.id);
    expect(created).toMatchObject({ action: 'admin.fee_plan.created', userId: actor.userId });
    expect(created?.metadata).toMatchObject({
      fixedFeeMinor: '10000',
      percentBasisPoints: 750,
      minimumFeeMinor: '30000',
      closedFeePlanId: null,
    });
  });

  it('a change applies from NEXT month: the old plan ends with the current month', async () => {
    const client = await newClient();
    const first = await service.create(client.id, { percent: 10, startsOn: month(-2) }, actor);

    await expect(
      service.create(client.id, { percent: 12, startsOn: month(0) }, actor),
    ).rejects.toBeInstanceOf(FeePlanStartsTooEarlyError);

    const second = await service.create(client.id, { percent: 12, startsOn: month(1) }, actor);
    const plans = await service.list(client.id);
    expect(plans.find((plan) => plan.id === first.id)?.endsOn).toBe(lastDay(0));
    expect(second.status).toBe('scheduled');

    const closed = (await auditFor(client.id)).find(
      (row) => row.action === 'admin.fee_plan.closed',
    );
    expect(closed?.metadata).toMatchObject({
      feePlanId: first.id,
      'before.endsOn': null,
      'after.endsOn': lastDay(0),
    });
  });

  it('refuses overlaps, a second plan in the past, and empty or invalid plans', async () => {
    const client = await newClient();
    await service.create(client.id, { fixedFee: '50', startsOn: month(1) }, actor);
    // The open plan starts next month: a replacement must start after it.
    await expect(
      service.create(client.id, { fixedFee: '60', startsOn: month(1) }, actor),
    ).rejects.toBeInstanceOf(FeePlanOverlapError);

    const other = await newClient();
    await service.create(other.id, { fixedFee: '50', startsOn: month(0) }, actor);
    await service.create(other.id, { fixedFee: '60', startsOn: month(2) }, actor);
    // Closed plans: a new one cannot be squeezed into the past
    await expect(
      service.create(other.id, { fixedFee: '70', startsOn: month(-6) }, actor),
    ).rejects.toBeInstanceOf(FeePlanStartsTooEarlyError);

    for (const body of [
      { startsOn: month(3) },
      { fixedFee: '-1', startsOn: month(3) },
      { percent: '100.5', startsOn: month(3) },
      { percent: '7.555', startsOn: month(3) },
      { fixedFee: '1.234', startsOn: month(3) },
      { fixedFee: '1', startsOn: '2026-13' },
      { fixedFee: '1', currency: 'HRK', startsOn: month(3) },
      { fixedFee: '1', startsOn: month(3), status: 'ACTIVE' },
    ]) {
      await expect(service.create(other.id, body, actor)).rejects.toBeInstanceOf(
        FeePlanValidationError,
      );
    }
  });

  it('cancels a future plan once, never a started one; IDOR through another client', async () => {
    const client = await newClient();
    const started = await service.create(client.id, { fixedFee: '10', startsOn: month(0) }, actor);
    const future = await service.create(client.id, { fixedFee: '20', startsOn: month(2) }, actor);

    await expect(service.cancel(client.id, started.id, actor)).rejects.toBeInstanceOf(
      FeePlanCannotCancelError,
    );
    const other = await newClient();
    await expect(service.cancel(other.id, future.id, actor)).rejects.toBeInstanceOf(
      FeePlanNotFoundError,
    );
    const cancelled = await service.cancel(client.id, future.id, actor);
    expect(cancelled.status).toBe('cancelled');
    await expect(service.cancel(client.id, future.id, actor)).rejects.toBeInstanceOf(
      FeePlanCannotCancelError,
    );
    const audit = (await auditFor(client.id)).find(
      (row) => row.action === 'admin.fee_plan.cancelled',
    );
    expect(audit?.metadata).toMatchObject({ feePlanId: future.id, 'before.cancelledAt': null });

    // History is complete: the cancelled plan is still listed
    expect((await service.list(client.id)).map((plan) => plan.status)).toContain('cancelled');
  });

  it('computes each month with ITS plan, from the real spend, rounded half up', async () => {
    const client = await newClient();
    // 7.5% + 100.00 fixed, minimum 300.00, from 3 months ago
    await service.create(
      client.id,
      { fixedFee: '100', percent: '7.5', minimumFee: '300', startsOn: month(-3) },
      actor,
    );
    await spend(client.id, 'USD', -3, 1333n); // 13.33: 100.00 + 1.00 = 101.00 -> minimum 300.00
    await spend(client.id, 'USD', -2, 500000n); // 5000.00: 100.00 + 375.00 = 475.00
    // month -1: no spend -> minimum 300.00
    await service.create(client.id, { percent: '10', startsOn: month(1) }, actor);
    await spend(client.id, 'USD', 1, 99n); // 0.99 at 10% = 0.099 -> 0.10

    const report = await service.fees(client.id, { from: month(-4), to: month(1) });
    const byMonth = Object.fromEntries(report.months.map((m) => [m.month, m]));
    expect(byMonth[month(-4)]).toMatchObject({ plan: null, fee: null });
    expect(byMonth[month(-3)]).toMatchObject({
      spend: '13.33',
      fee: '300.00',
      breakdown: { fixed: '100.00', variable: '1.00', minimumApplied: true },
    });
    expect(byMonth[month(-2)]).toMatchObject({
      spend: '5000.00',
      fee: '475.00',
      breakdown: { variable: '375.00', minimumApplied: false },
    });
    expect(byMonth[month(-1)]).toMatchObject({ spend: '0.00', fee: '300.00' });
    expect(byMonth[month(0)]).toMatchObject({ inProgress: true, fee: '300.00' });
    expect(byMonth[month(1)]).toMatchObject({ plan: { percent: '10.00' }, fee: '0.10' });
  });

  it('never converts currencies: other spend is excluded and reported with the client name', async () => {
    const client = await newClient();
    await service.create(client.id, { percent: '10', startsOn: month(-1) }, actor);
    await spend(client.id, 'USD', -1, 100000n);
    await spend(client.id, 'SAR', -1, 375000n);

    const report = await service.fees(client.id, { from: month(-1), to: month(-1) });
    expect(report.months[0]).toMatchObject({ spend: '1000.00', fee: '100.00' });
    expect(report.warnings).toEqual([
      { clientName: client.name, month: month(-1), currency: 'SAR', spend: '3750.00' },
    ]);
  });

  it('uses the decimals of the plan currency (JPY 0, KWD 3)', async () => {
    const yen = await newClient('JPY');
    await service.create(yen.id, { percent: '7.5', startsOn: month(0) }, actor);
    await spend(yen.id, 'JPY', 0, 1333n);
    expect((await service.fees(yen.id, { from: month(0), to: month(0) })).months[0]?.fee).toBe(
      '100',
    );

    const dinar = await newClient('KWD');
    await service.create(dinar.id, { fixedFee: '1.5', startsOn: month(0) }, actor);
    expect((await service.list(dinar.id))[0]?.fixedFee).toBe('1.500');
  });

  it('refuses unknown and archived clients, and too long periods', async () => {
    await expect(service.list(randomUUID())).rejects.toBeInstanceOf(ClientNotFoundError);
    const archived = await prisma.client.create({
      data: { name: `Fees archived ${randomUUID()}`, status: 'ARCHIVED' },
    });
    await expect(
      service.create(archived.id, { fixedFee: '1', startsOn: month(1) }, actor),
    ).rejects.toBeInstanceOf(ClientArchivedError);
    const client = await newClient();
    await expect(
      service.fees(client.id, { from: '2020-01', to: '2026-01' }),
    ).rejects.toBeInstanceOf(FeePlanValidationError);
  });
});
