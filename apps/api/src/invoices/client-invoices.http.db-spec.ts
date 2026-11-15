// HTTP tests of the client portal invoices (step 6.3).
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
import { InvoicesService } from './invoices.service';

// The real PrismaService reads .env at import time: replace it by a token.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const prisma = createTestPrisma();
const service = new InvoicesService(prisma as unknown as PrismaService);
const actor = { userId: randomUUID(), ip: '203.0.113.9', userAgent: 'ClientInvoicesTest/1.0' };
let server: HttpTestApp;

const monthStart = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
};

// A client with a plan from 2 months ago: two drafts; the last one issued,
// paid 50.00, plus a voided payment that the client must not see.
async function clientWithInvoices() {
  const client = await prisma.client.create({ data: { name: `Portal invoices ${randomUUID()}` } });
  await prisma.feePlan.create({
    data: { clientId: client.id, currency: 'USD', fixedFeeMinor: 20000n, startsOn: monthStart(-2) },
  });
  await service.prepareDrafts(actor);
  const { items } = await service.list({ clientId: client.id });
  const last = items.find((item) => item.month === monthStart(-1).toISOString().slice(0, 7))!;
  const draft = items.find((item) => item.id !== last.id)!;
  await service.issue(last.id, {}, actor);
  const today = new Date().toISOString().slice(0, 10);
  const withWrong = await service.recordPayment(
    last.id,
    { amount: '10', paidOn: today, method: 'CASH' },
    actor,
  );
  await service.voidPayment(withWrong.payments[0]!.id, { reason: 'SECRET REASON' }, actor);
  await service.recordPayment(last.id, { amount: '50', paidOn: today, method: 'CARD' }, actor);
  const { token } = await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id);
  return { token, issuedId: last.id, draftId: draft.id };
}

describe('/api/client/invoices over HTTP (client portal)', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('401 without a token, 403 for the administration', async () => {
    const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    expect((await httpCall(server.baseUrl, 'GET', '/client/invoices')).status).toBe(401);
    expect((await httpCall(server.baseUrl, 'GET', '/client/invoices', admin)).status).toBe(403);
  });

  it('lists only its own ISSUED invoices, never drafts', async () => {
    const mine = await clientWithInvoices();
    await clientWithInvoices();
    const list = await httpCall(server.baseUrl, 'GET', '/client/invoices', mine.token);
    const items = list.body as unknown as { id: string; status: string }[];
    expect(items.map((item) => item.id)).toEqual([mine.issuedId]);
    expect(items[0]).toMatchObject({
      status: 'ISSUED',
      total: '200.00',
      paid: '50.00',
      balance: '150.00',
    });
  });

  it('shows the live payments only, without any void reason', async () => {
    const mine = await clientWithInvoices();
    const detail = await httpCall(
      server.baseUrl,
      'GET',
      `/client/invoices/${mine.issuedId}`,
      mine.token,
    );
    expect(detail.status).toBe(200);
    expect(detail.body['payments']).toEqual([
      { amount: '50.00', paidOn: new Date().toISOString().slice(0, 10), method: 'CARD' },
    ]);
    expect(JSON.stringify(detail.body)).not.toContain('SECRET REASON');
    expect(detail.body).not.toHaveProperty('voidReason');
  });

  it('IDOR: another client invoice, a draft, or an unknown id is not found', async () => {
    const mine = await clientWithInvoices();
    const other = await clientWithInvoices();
    for (const id of [other.issuedId, mine.draftId, randomUUID(), 'not-a-uuid']) {
      const result = await httpCall(server.baseUrl, 'GET', `/client/invoices/${id}`, mine.token);
      expect(result).toMatchObject({ status: 404, body: { code: 'invoice_not_found' } });
    }
  });
});
