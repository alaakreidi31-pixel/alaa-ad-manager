// HTTP tests of /api/admin/clients/:clientId/campaigns (step 4.1).
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
let clientId: string;

const base = () => `/admin/clients/${clientId}/campaigns`;

describe('/api/admin/clients/:clientId/campaigns over HTTP (test database)', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
    adminToken = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    clientId = (await prisma.client.create({ data: { name: `Http campaigns ${randomUUID()}` } }))
      .id;
    // A client account of the SAME client: still refused on admin routes.
    clientToken = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', clientId)).token;
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('refuses no token (401) and a client account (403) on every route', async () => {
    const id = randomUUID();
    const routes: [string, string][] = [
      ['GET', ''],
      ['POST', ''],
      ['GET', `/${id}`],
      ['PATCH', `/${id}`],
      ['POST', `/${id}/pause`],
      ['POST', `/${id}/activate`],
      ['POST', `/${id}/end`],
      ['POST', `/${id}/archive`],
    ];
    for (const [method, path] of routes) {
      const body = method === 'GET' ? undefined : { name: 'x' };
      expect((await httpCall(server.baseUrl, method, base() + path, undefined, body)).status).toBe(
        401,
      );
      expect(
        (await httpCall(server.baseUrl, method, base() + path, clientToken, body)).status,
      ).toBe(403);
    }
  });

  it('creates, reads, updates and pauses a campaign', async () => {
    const created = await httpCall(server.baseUrl, 'POST', base(), adminToken, {
      platform: 'GOOGLE',
      name: 'Search brand',
      dailyBudget: '75',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Search brand', dailyBudget: '75.00' });
    const id = created.body['id'] as string;

    expect((await httpCall(server.baseUrl, 'GET', `${base()}/${id}`, adminToken)).status).toBe(200);
    const updated = await httpCall(server.baseUrl, 'PATCH', `${base()}/${id}`, adminToken, {
      objective: 'Sales',
    });
    expect(updated.body).toMatchObject({ objective: 'Sales' });
    const paused = await httpCall(server.baseUrl, 'POST', `${base()}/${id}/pause`, adminToken);
    expect(paused).toMatchObject({ status: 200, body: { status: 'PAUSED' } });
    const list = await httpCall(server.baseUrl, 'GET', `${base()}?status=PAUSED`, adminToken);
    expect(list.body['total']).toBe(1);
  });

  it('answers with stable error codes', async () => {
    const bad = await httpCall(server.baseUrl, 'POST', base(), adminToken, { platform: 'X' });
    expect(bad).toMatchObject({ status: 400, body: { code: 'invalid_input' } });

    const missing = await httpCall(server.baseUrl, 'GET', `${base()}/${randomUUID()}`, adminToken);
    expect(missing).toMatchObject({ status: 404, body: { code: 'campaign_not_found' } });
    const notUuid = await httpCall(server.baseUrl, 'GET', `${base()}/abc`, adminToken);
    expect(notUuid.status).toBe(404);

    const noClient = await httpCall(
      server.baseUrl,
      'GET',
      `/admin/clients/${randomUUID()}/campaigns`,
      adminToken,
    );
    expect(noClient).toMatchObject({ status: 404, body: { code: 'client_not_found' } });

    const data = { platform: 'META', name: 'Dup http', externalId: 'http-dup' };
    await httpCall(server.baseUrl, 'POST', base(), adminToken, data);
    const dup = await httpCall(server.baseUrl, 'POST', base(), adminToken, data);
    expect(dup).toMatchObject({ status: 409, body: { code: 'external_id_taken' } });
  });

  it('IDOR: a campaign of client A is not reachable through client B', async () => {
    const created = await httpCall(server.baseUrl, 'POST', base(), adminToken, {
      platform: 'META',
      name: 'Owned by A',
    });
    const id = created.body['id'] as string;
    const otherId = (await prisma.client.create({ data: { name: `Other ${randomUUID()}` } })).id;
    const other = `/admin/clients/${otherId}/campaigns/${id}`;

    expect((await httpCall(server.baseUrl, 'GET', other, adminToken)).status).toBe(404);
    expect(
      (await httpCall(server.baseUrl, 'PATCH', other, adminToken, { name: 'Moved' })).status,
    ).toBe(404);
    expect((await httpCall(server.baseUrl, 'POST', `${other}/archive`, adminToken)).status).toBe(
      404,
    );
    const still = await httpCall(server.baseUrl, 'GET', `${base()}/${id}`, adminToken);
    expect(still.body).toMatchObject({ name: 'Owned by A', status: 'ACTIVE' });
  });
});
