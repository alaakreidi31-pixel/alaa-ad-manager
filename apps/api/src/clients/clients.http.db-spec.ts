// HTTP tests: a real NestJS server with the real guards, on a random port.
// They check what a browser (or an attacker) actually gets back:
// - no token: 401; a CLIENT_USER token: 403 on EVERY admin route;
// - ids that are not UUIDs, or belong to nothing: 404 (no database error).
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AuthService } from '../auth/auth.service';
import { SecretBox } from '../auth/secret-box';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

// The real PrismaService reads .env at import time: replace it by a token,
// and give the test database client under that token.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const prisma = createTestPrisma();
const jwt = new JwtService({
  secret: 'test-only-secret-at-least-32-characters-long',
  signOptions: { algorithm: 'HS256' },
  verifyOptions: { algorithms: ['HS256'] },
});
const box = new SecretBox(randomBytes(32).toString('base64'));

// Same controller and guards as production; dependencies given explicitly.
class ClientsHttpTestModule {}
Module({
  controllers: [ClientsController],
  providers: [
    { provide: PrismaService, useValue: prisma },
    { provide: AuditService, useFactory: () => new AuditService(prisma as never) },
    { provide: ClientsService, useFactory: () => new ClientsService(prisma as never) },
    {
      provide: AuthService,
      inject: [AuditService],
      useFactory: (audit: AuditService) => new AuthService(prisma as never, jwt, box, audit),
    },
    AccessTokenGuard,
    SuperAdminGuard,
  ],
})(ClientsHttpTestModule);

let app: INestApplication;
let baseUrl: string;
let adminToken: string;
let clientToken: string;

// A user with an open session, and a signed access token for it.
async function tokenFor(role: 'SUPER_ADMIN' | 'CLIENT_USER'): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `http-${role.toLowerCase().replace('_', '-')}-${randomUUID().slice(0, 8)}@alaa.test`,
      fullName: 'HTTP Test',
      passwordHash: 'not-a-real-hash',
      role,
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return jwt.signAsync({ sub: user.id, sid: session.id, role }, { expiresIn: 900 });
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/admin/clients${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, body: json as Record<string, unknown> };
}

describe('/api/admin/clients over HTTP (test database)', () => {
  beforeAll(async () => {
    app = await NestFactory.create(ClientsHttpTestModule, { logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    adminToken = await tokenFor('SUPER_ADMIN');
    clientToken = await tokenFor('CLIENT_USER');
  });

  afterAll(async () => {
    await app.close();
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
