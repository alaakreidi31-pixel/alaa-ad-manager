// HTTP tests of the fee plan routes (step 5.1).
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

const nextMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 7);
};

describe('/api/admin/clients/:clientId/fee-plans over HTTP', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('401 without a token and 403 for a client account, on every route', async () => {
    const client = await prisma.client.create({ data: { name: `Http fees ${randomUUID()}` } });
    const token = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id)).token;
    const base = `/admin/clients/${client.id}`;
    for (const [method, path] of [
      ['GET', `${base}/fee-plans`],
      ['POST', `${base}/fee-plans`],
      ['POST', `${base}/fee-plans/${randomUUID()}/cancel`],
      ['GET', `${base}/fees`],
    ] as const) {
      expect((await httpCall(server.baseUrl, method, path)).status).toBe(401);
      const body = method === 'POST' ? {} : undefined;
      expect((await httpCall(server.baseUrl, method, path, token, body)).status).toBe(403);
    }
  });

  it('creates, lists, reports and cancels, with stable error codes', async () => {
    const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    const client = await prisma.client.create({ data: { name: `Http fees ${randomUUID()}` } });
    const base = `/admin/clients/${client.id}`;

    const created = await httpCall(server.baseUrl, 'POST', `${base}/fee-plans`, admin, {
      fixedFee: '250',
      percent: '5',
      startsOn: nextMonth(),
    });
    expect(created).toMatchObject({ status: 201, body: { fixedFee: '250.00', percent: '5.00' } });
    const id = created.body['id'] as string;

    const list = await httpCall(server.baseUrl, 'GET', `${base}/fee-plans`, admin);
    expect(list.body).toHaveLength(1);
    const fees = await httpCall(server.baseUrl, 'GET', `${base}/fees`, admin);
    expect(fees).toMatchObject({ status: 200, body: { clientName: client.name } });

    const overlap = await httpCall(server.baseUrl, 'POST', `${base}/fee-plans`, admin, {
      fixedFee: '1',
      startsOn: nextMonth(),
    });
    expect(overlap).toMatchObject({ status: 409, body: { code: 'fee_plan_overlap' } });
    const invalid = await httpCall(server.baseUrl, 'POST', `${base}/fee-plans`, admin, {
      startsOn: nextMonth(),
    });
    expect(invalid).toMatchObject({ status: 400, body: { code: 'invalid_input' } });

    const cancelled = await httpCall(
      server.baseUrl,
      'POST',
      `${base}/fee-plans/${id}/cancel`,
      admin,
    );
    expect(cancelled).toMatchObject({ status: 200, body: { status: 'cancelled' } });
    const again = await httpCall(server.baseUrl, 'POST', `${base}/fee-plans/${id}/cancel`, admin);
    expect(again).toMatchObject({ status: 409, body: { code: 'fee_plan_cannot_cancel' } });

    // No route changes or deletes a plan
    expect(
      (await httpCall(server.baseUrl, 'PATCH', `${base}/fee-plans/${id}`, admin, {})).status,
    ).toBe(404);
    expect(
      (await httpCall(server.baseUrl, 'DELETE', `${base}/fee-plans/${id}`, admin)).status,
    ).toBe(404);
  });
});
