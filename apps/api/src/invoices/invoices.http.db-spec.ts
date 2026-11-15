// HTTP tests of the invoice and payment routes (step 6.1).
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

describe('/api/admin/invoices over HTTP', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('401 without a token and 403 for a client account, on every route', async () => {
    const client = await prisma.client.create({ data: { name: `Http invoices ${randomUUID()}` } });
    const token = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id)).token;
    const id = randomUUID();
    for (const [method, path] of [
      ['GET', '/admin/invoices'],
      ['POST', '/admin/invoices/prepare'],
      ['GET', `/admin/invoices/${id}`],
      ['POST', `/admin/invoices/${id}/issue`],
      ['POST', `/admin/invoices/${id}/void`],
      ['POST', `/admin/invoices/${id}/payments`],
      ['POST', `/admin/payments/${id}/void`],
    ] as const) {
      const body = method === 'POST' ? {} : undefined;
      expect((await httpCall(server.baseUrl, method, path, undefined, body)).status).toBe(401);
      expect((await httpCall(server.baseUrl, method, path, token, body)).status).toBe(403);
    }
  });

  it('prepares, issues, takes a payment, with stable error codes', async () => {
    const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    const client = await prisma.client.create({ data: { name: `Http invoices ${randomUUID()}` } });
    const now = new Date();
    await prisma.feePlan.create({
      data: {
        clientId: client.id,
        currency: 'USD',
        fixedFeeMinor: 25000n,
        startsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
      },
    });
    expect(
      (await httpCall(server.baseUrl, 'POST', '/admin/invoices/prepare', admin, {})).status,
    ).toBe(200);
    const list = await httpCall(
      server.baseUrl,
      'GET',
      `/admin/invoices?clientId=${client.id}`,
      admin,
    );
    const [draft] = list.body['items'] as { id: string; total: string; clientName: string }[];
    expect(draft).toMatchObject({ total: '250.00', clientName: client.name });

    const issued = await httpCall(
      server.baseUrl,
      'POST',
      `/admin/invoices/${draft!.id}/issue`,
      admin,
      {},
    );
    expect(issued).toMatchObject({ status: 200, body: { status: 'ISSUED' } });
    const paid = await httpCall(
      server.baseUrl,
      'POST',
      `/admin/invoices/${draft!.id}/payments`,
      admin,
      {
        amount: '100',
        paidOn: now.toISOString().slice(0, 10),
        method: 'CASH',
      },
    );
    expect(paid).toMatchObject({ status: 201, body: { paid: '100.00', balance: '150.00' } });

    const tooMuch = await httpCall(
      server.baseUrl,
      'POST',
      `/admin/invoices/${draft!.id}/payments`,
      admin,
      {
        amount: '200',
        paidOn: now.toISOString().slice(0, 10),
        method: 'CASH',
      },
    );
    expect(tooMuch).toMatchObject({ status: 409, body: { code: 'payment_exceeds_total' } });
    const withPayments = await httpCall(
      server.baseUrl,
      'POST',
      `/admin/invoices/${draft!.id}/void`,
      admin,
      {
        reason: 'test',
      },
    );
    expect(withPayments).toMatchObject({ status: 409, body: { code: 'invoice_has_payments' } });
    const again = await httpCall(
      server.baseUrl,
      'POST',
      `/admin/invoices/${draft!.id}/issue`,
      admin,
      {},
    );
    expect(again).toMatchObject({ status: 409, body: { code: 'invoice_state' } });
    const missing = await httpCall(server.baseUrl, 'GET', `/admin/invoices/${randomUUID()}`, admin);
    expect(missing).toMatchObject({ status: 404, body: { code: 'invoice_not_found' } });

    // No route edits or deletes an invoice
    expect(
      (await httpCall(server.baseUrl, 'PATCH', `/admin/invoices/${draft!.id}`, admin, {})).status,
    ).toBe(404);
    expect(
      (await httpCall(server.baseUrl, 'DELETE', `/admin/invoices/${draft!.id}`, admin)).status,
    ).toBe(404);
  });
});
