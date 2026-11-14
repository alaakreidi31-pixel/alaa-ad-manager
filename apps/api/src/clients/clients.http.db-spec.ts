// HTTP tests: a real NestJS server with the real guards, on a random port.
// They check what a browser (or an attacker) actually gets back:
// - no token: 401; a CLIENT_USER token: 403 on EVERY admin route;
// - ids that are not UUIDs, or belong to nothing: 404 (no database error).
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestPrisma } from '../testing/test-prisma';
import {
  createSessionToken,
  httpCall,
  startHttpTestApp,
  type HttpTestApp,
} from '../testing/http-test-app';

// The real PrismaService reads .env at import time: replace it by a token.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const prisma = createTestPrisma();
let server: HttpTestApp;
let adminToken: string;
let clientToken: string;

function call(method: string, path: string, token?: string, body?: unknown) {
  return httpCall(server.baseUrl, method, `/admin/clients${path}`, token, body);
}

describe('/api/admin/clients over HTTP (test database)', () => {
  beforeAll(async () => {
    server = await startHttpTestApp(prisma);
    adminToken = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
    const ownClient = await prisma.client.create({ data: { name: `Own ${randomUUID()}` } });
    clientToken = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', ownClient.id)).token;
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('refuses a request without a token (401)', async () => {
    expect((await call('GET', '')).status).toBe(401);
  });

  it('refuses a forged token (401)', async () => {
    const forged = await new JwtService({ secret: 'x'.repeat(40) }).signAsync({
      sub: randomUUID(),
      sid: randomUUID(),
      role: 'SUPER_ADMIN',
    });
    expect((await call('GET', '', forged)).status).toBe(401);
  });

  it('a CLIENT_USER gets 403 on EVERY admin route, and changes nothing', async () => {
    const created = await call('POST', '', adminToken, { name: `Target ${randomUUID()}` });
    const id = created.body['id'] as string;

    const attempts = [
      call('GET', '', clientToken),
      call('GET', `/${id}`, clientToken),
      call('POST', '', clientToken, { name: 'Injected client' }),
      call('PATCH', `/${id}`, clientToken, { name: 'Hijacked' }),
      call('POST', `/${id}/suspend`, clientToken),
      call('POST', `/${id}/archive`, clientToken),
      call('POST', `/${id}/activate`, clientToken),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.status).toBe(403);
      expect(result.body).not.toHaveProperty('internalNotes');
    }
    const unchanged = await call('GET', `/${id}`, adminToken);
    expect(unchanged.body).toMatchObject({ status: 'ACTIVE' });
    expect((unchanged.body['name'] as string).startsWith('Target ')).toBe(true);
    expect(await prisma.client.count({ where: { name: 'Injected client' } })).toBe(0);
  });

  it('a SUPER_ADMIN can create, read, update and archive', async () => {
    const created = await call('POST', '', adminToken, {
      name: `Http ${randomUUID()}`,
      internalNotes: 'Agency only',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'ACTIVE', internalNotes: 'Agency only' });
    const id = created.body['id'] as string;

    expect((await call('GET', `/${id}`, adminToken)).status).toBe(200);
    expect(
      (await call('PATCH', `/${id}`, adminToken, { phone: '+966500000000' })).body,
    ).toMatchObject({ phone: '+966500000000' });
    expect((await call('POST', `/${id}/archive`, adminToken)).body).toMatchObject({
      status: 'ARCHIVED',
    });
    const refused = await call('PATCH', `/${id}`, adminToken, { phone: '+966511111111' });
    expect(refused).toMatchObject({ status: 409, body: { code: 'client_archived' } });
  });

  it('answers 404 for unknown ids and for values that are not ids', async () => {
    for (const id of [randomUUID(), 'not-a-uuid', "1' OR '1'='1"]) {
      const result = await call('GET', `/${encodeURIComponent(id)}`, adminToken);
      expect(result).toMatchObject({ status: 404, body: { code: 'client_not_found' } });
    }
  });

  it('answers 400 with the wrong fields for invalid data', async () => {
    const result = await call('POST', '', adminToken, { name: 'X', status: 'ARCHIVED' });
    expect(result.status).toBe(400);
    expect(result.body['code']).toBe('invalid_input');
  });

  it('lists with search and pages', async () => {
    const t = randomUUID().slice(0, 8);
    await call('POST', '', adminToken, { name: `List ${t} one` });
    await call('POST', '', adminToken, { name: `List ${t} two` });
    const result = await call('GET', `?search=${t}&pageSize=1`, adminToken);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
  });
});
