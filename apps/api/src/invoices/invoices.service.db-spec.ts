import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import {
  InvoiceHasPaymentsError,
  InvoiceNotFoundError,
  InvoiceStateError,
  InvoiceValidationError,
  PaymentExceedsTotalError,
} from './invoices.errors';
import { InvoicesService } from './invoices.service';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const prisma = createTestPrisma();
const service = new InvoicesService(prisma as unknown as PrismaService);
const actor = { userId: randomUUID(), ip: '203.0.113.9', userAgent: 'InvoicesTest/1.0' };

// First day of the month N months from now (UTC).
function monthStart(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}
const today = () => new Date().toISOString().slice(0, 10);

// A client with a plan (100.00 + 10%, minimum 300.00) from 3 months ago, and
// 1500.00 USD of spend last month (plus SAR spend that must be ignored).
async function setup() {
  const client = await prisma.client.create({ data: { name: `Invoices ${randomUUID()}` } });
  await prisma.feePlan.create({
    data: {
      clientId: client.id,
      currency: 'USD',
      fixedFeeMinor: 10000n,
      percentBasisPoints: 1000,
      minimumFeeMinor: 30000n,
      startsOn: monthStart(-3),
    },
  });
  const usd = await prisma.campaign.create({
    data: { clientId: client.id, platform: 'META', name: 'Usd', currency: 'USD' },
  });
  const sar = await prisma.campaign.create({
    data: { clientId: client.id, platform: 'META', name: 'Sar', currency: 'SAR' },
  });
  await prisma.campaignDailyMetric.createMany({
    data: [
      { campaignId: usd.id, date: monthStart(-1), spendMinor: 500000n, source: 'MANUAL' },
      { campaignId: sar.id, date: monthStart(-1), spendMinor: 999999n, source: 'MANUAL' },
    ],
  });
  await service.prepareDrafts(actor);
  const page = await service.list({ clientId: client.id, pageSize: 100 });
  const lastMonth = page.items.find(
    (item) => item.month === monthStart(-1).toISOString().slice(0, 7),
  );
  return { client, usd, items: page.items, lastMonth: lastMonth! };
}

describe('InvoicesService (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('prepares one draft per ended month, from the plan and the spend in its currency only', async () => {
    const { items, lastMonth } = await setup();
    expect(items.map((item) => item.month).sort()).toEqual(
      [-3, -2, -1].map((offset) => monthStart(offset).toISOString().slice(0, 7)),
    );
    expect(items.every((item) => item.status === 'DRAFT' && item.number === null)).toBe(true);
    // 5000.00 USD: 100.00 + 500.00 = 600.00 (the SAR spend is not counted)
    expect(lastMonth).toMatchObject({ spend: '5000.00', variableFee: '500.00', total: '600.00' });
    // The current month is never invoiced (not over)
    expect(items.some((item) => item.month === monthStart(0).toISOString().slice(0, 7))).toBe(
      false,
    );
  });

  it('is idempotent and refreshes the spend of drafts only', async () => {
    const { client, usd, lastMonth } = await setup();
    await service.prepareDrafts(actor);
    expect((await service.list({ clientId: client.id })).total).toBe(3);

    await prisma.campaignDailyMetric.updateMany({
      where: { campaignId: usd.id },
      data: { spendMinor: 100000n },
    });
    const result = await service.prepareDrafts(actor);
    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    // 1000.00 USD: 100.00 + 100.00 = 200.00 -> minimum 300.00
    expect(await service.get(lastMonth.id)).toMatchObject({ spend: '1000.00', total: '300.00' });
  });

  it('issues with a database number, the due date +14 days, then never changes', async () => {
    const { lastMonth, usd } = await setup();
    const issued = await service.issue(lastMonth.id, {}, actor);
    expect(issued.status).toBe('ISSUED');
    expect(issued.number).toMatch(new RegExp(`^AMG-${new Date().getUTCFullYear()}-\\d{4}$`));
    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    expect(issued.dueOn).toBe(due);

    await expect(service.issue(lastMonth.id, {}, actor)).rejects.toBeInstanceOf(InvoiceStateError);
    // Spend corrected after issue: the invoice keeps its snapshot, and says so
    await prisma.campaignDailyMetric.updateMany({
      where: { campaignId: usd.id },
      data: { spendMinor: 1n },
    });
    await service.prepareDrafts(actor);
    const detail = await service.get(lastMonth.id);
    expect(detail).toMatchObject({
      total: '600.00',
      spendChangedSinceIssue: true,
      currentSpend: '0.01',
    });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'admin.invoice.issued', userId: actor.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({
      invoiceId: lastMonth.id,
      number: issued.number,
      totalMinor: '60000',
    });
  });

  it('numbers follow each other with no gap', async () => {
    const a = await setup();
    const b = await setup();
    const first = await service.issue(a.lastMonth.id, {}, actor);
    const second = await service.issue(b.lastMonth.id, { dueOn: today() }, actor);
    const order = (value: string | null) => Number(value?.split('-')[2]);
    expect(order(second.number) - order(first.number)).toBe(1);
    expect(second.dueOn).toBe(today());
    await expect(
      service.issue(
        b.items.find((item) => item.status === 'DRAFT' && item.id !== b.lastMonth.id)!.id,
        {
          dueOn: '2020-01-01',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(InvoiceValidationError);
  });

  it('records partial payments up to the total, and computes the state', async () => {
    const { lastMonth } = await setup();
    await expect(
      service.recordPayment(lastMonth.id, { amount: '10', paidOn: today(), method: 'CASH' }, actor),
    ).rejects.toBeInstanceOf(InvoiceStateError); // still a draft
    await service.issue(lastMonth.id, {}, actor);

    let detail = await service.recordPayment(
      lastMonth.id,
      { amount: '250.5', paidOn: today(), method: 'BANK_TRANSFER', reference: 'TRX-9' },
      actor,
    );
    expect(detail).toMatchObject({ paid: '250.50', balance: '349.50', paymentState: 'partial' });
    await expect(
      service.recordPayment(
        lastMonth.id,
        { amount: '349.51', paidOn: today(), method: 'CASH' },
        actor,
      ),
    ).rejects.toBeInstanceOf(PaymentExceedsTotalError);
    await expect(
      service.recordPayment(
        lastMonth.id,
        { amount: '1.234', paidOn: today(), method: 'CASH' },
        actor,
      ),
    ).rejects.toBeInstanceOf(InvoiceValidationError);
    await expect(
      service.recordPayment(
        lastMonth.id,
        { amount: '1', paidOn: '2999-01-01', method: 'CASH' },
        actor,
      ),
    ).rejects.toBeInstanceOf(InvoiceValidationError);
    detail = await service.recordPayment(
      lastMonth.id,
      { amount: '349.50', paidOn: today(), method: 'CARD' },
      actor,
    );
    expect(detail).toMatchObject({
      paid: '600.00',
      balance: '0.00',
      paymentState: 'paid',
      overdue: false,
    });
    expect(detail.payments).toHaveLength(2);
  });

  it('voids: never an invoice with live payments; a payment with a reason; a replacement gets a new number', async () => {
    const { client, lastMonth } = await setup();
    const issued = await service.issue(lastMonth.id, {}, actor);
    const paid = await service.recordPayment(
      lastMonth.id,
      { amount: '100', paidOn: today(), method: 'CASH' },
      actor,
    );
    await expect(
      service.void(lastMonth.id, { reason: 'wrong spend' }, actor),
    ).rejects.toBeInstanceOf(InvoiceHasPaymentsError);
    const payment = paid.payments[0]!;
    await expect(service.voidPayment(payment.id, { reason: '' }, actor)).rejects.toBeInstanceOf(
      InvoiceValidationError,
    );
    const afterVoid = await service.voidPayment(payment.id, { reason: 'refunded' }, actor);
    expect(afterVoid).toMatchObject({ paid: '0.00', paymentState: 'unpaid' });
    await expect(
      service.voidPayment(payment.id, { reason: 'again' }, actor),
    ).rejects.toBeInstanceOf(InvoiceStateError);

    const voided = await service.void(lastMonth.id, { reason: 'wrong spend' }, actor);
    expect(voided).toMatchObject({
      status: 'VOID',
      number: issued.number,
      voidReason: 'wrong spend',
    });
    await expect(service.void(lastMonth.id, { reason: 'again' }, actor)).rejects.toBeInstanceOf(
      InvoiceStateError,
    );

    // The month gets a new draft, then a NEW number
    await service.prepareDrafts(actor);
    const replacement = (await service.list({ clientId: client.id, status: 'DRAFT' })).items.find(
      (item) => item.month === lastMonth.month,
    )!;
    const reissued = await service.issue(replacement.id, {}, actor);
    expect(reissued.number).not.toBe(issued.number);
  });

  it('discards a draft by voiding it (no number); unknown ids are not found', async () => {
    const { items } = await setup();
    const draft = items[0]!;
    const discarded = await service.void(draft.id, { reason: 'not needed' }, actor);
    expect(discarded).toMatchObject({ status: 'VOID', number: null });
    await expect(service.get(randomUUID())).rejects.toBeInstanceOf(InvoiceNotFoundError);
    await expect(service.get('not-a-uuid')).rejects.toBeInstanceOf(InvoiceNotFoundError);
  });
});
