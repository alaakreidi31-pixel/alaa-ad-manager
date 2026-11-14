// HTTP tests of the client portal and of the isolation between clients (IDOR).
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
let tokenA: string;
let tokenB: string;
let clientA: { id: string };
let clientB: { id: string };

const call = (method: string, path: string, token?: string, body?: unknown) =>
  httpCall(server.baseUrl, method, path, token, body);

describe('client portal and isolation between clients (HTTP, test database)', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
    adminToken = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    clientA = await prisma.client.create({
      data: { name: `Client A ${randomUUID()}`, internalNotes: 'SECRET NOTE A' },
    });
    clientB = await prisma.client.create({
      data: { name: `Client B ${randomUUID()}`, internalNotes: 'SECRET NOTE B' },
    });
    tokenA = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', clientA.id)).token;
    tokenB = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', clientB.id)).token;
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('each client sees ONLY its own profile, without the internal notes', async () => {
    const a = await call('GET', '/client/profile', tokenA);
    const b = await call('GET', '/client/profile', tokenB);
    expect(a).toMatchObject({ status: 200, body: { id: clientA.id } });
    expect(b).toMatchObject({ status: 200, body: { id: clientB.id } });
    for (const result of [a, b]) {
      expect(result.body).not.toHaveProperty('internalNotes');
      expect(JSON.stringify(result.body)).not.toContain('SECRET NOTE');
    }
  });

  it('a client id in the request is ignored: the session decides', async () => {
    const result = await call('GET', `/client/profile?clientId=${clientB.id}`, tokenA);
    expect(result.body['id']).toBe(clientA.id);
  });

  it('client A cannot reach client B through the admin routes (403)', async () => {
    for (const [method, path] of [
      ['GET', `/admin/clients/${clientB.id}`],
      ['GET', `/admin/clients/${clientB.id}/users`],
      ['POST', `/admin/clients/${clientB.id}/users`],
      ['POST', `/admin/clients/${clientB.id}/suspend`],
    ] as const) {
      const body = method === 'POST' ? { email: 'x@y.z', fullName: 'X' } : undefined;
      const result = await call(method, path, tokenA, body);
      expect(result.status).toBe(403);
      expect(JSON.stringify(result.body)).not.toContain('SECRET NOTE');
    }
  });

  it('an administrator cannot use the client portal (403)', async () => {
    expect((await call('GET', '/client/profile', adminToken)).status).toBe(403);
  });

  it('the temporary password appears once, in the creation answer only', async () => {
    const created = await call('POST', `/admin/clients/${clientA.id}/users`, adminToken, {
      email: `portal-${randomUUID().slice(0, 8)}@alaa.test`,
      fullName: 'Sara',
    });
    expect(created.status).toBe(201);
    const temporaryPassword = created.body['temporaryPassword'] as string;
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9-]{23}$/);

    const list = await call('GET', `/admin/clients/${clientA.id}/users`, adminToken);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(temporaryPassword);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
  });

  it('a user of client B is not found under client A (404)', async () => {
    const created = await call('POST', `/admin/clients/${clientB.id}/users`, adminToken, {
      email: `idor-${randomUUID().slice(0, 8)}@alaa.test`,
      fullName: 'Omar',
    });
    const userOfB = (created.body['user'] as { id: string }).id;
    for (const action of ['reset-password', 'suspend', 'activate']) {
      const result = await call(
        'POST',
        `/admin/clients/${clientA.id}/users/${userOfB}/${action}`,
        adminToken,
      );
      expect(result).toMatchObject({ status: 404, body: { code: 'user_not_found' } });
    }
  });

  it('suspending the client stops its open session immediately (401)', async () => {
    const client = await prisma.client.create({ data: { name: `Stop ${randomUUID()}` } });
    const { token } = await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id);
    expect((await call('GET', '/client/profile', token)).status).toBe(200);

    await call('POST', `/admin/clients/${client.id}/suspend`, adminToken);
    expect((await call('GET', '/client/profile', token)).status).toBe(401);
  });
});
