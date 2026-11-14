import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import {
  ClientArchivedError,
  ClientNotFoundError,
  ClientValidationError,
  InvalidClientStatusChangeError,
} from './clients.errors';
import { ClientsService } from './clients.service';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

// Connects as alaa_app, exactly like the running API.
const prisma = createTestPrisma();
const service = new ClientsService(prisma as unknown as PrismaService);
const actor = { userId: randomUUID(), ip: '203.0.113.9', userAgent: 'ClientsTest/1.0' };

// Clients cannot be deleted (not even by the tests): every test uses its own
// unique tag in the names, and searches by that tag.
const tag = () => `t${randomUUID().slice(0, 8)}`;

async function auditFor(clientId: string) {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.filter(
    (row) => (row.metadata as { clientId?: string } | null)?.clientId === clientId,
  );
}

describe('ClientsService (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('create', () => {
    it('creates an ACTIVE client with the default currency and time zone', async () => {
      const client = await service.create({ name: `Coffee ${tag()}` }, actor);
      expect(client).toMatchObject({ status: 'ACTIVE', currency: 'USD', timezone: 'UTC' });
      expect(client.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('stores every field, normalized', async () => {
      const client = await service.create(
        {
          name: `  Coffee ${tag()}  `,
          contactName: 'Sara',
          email: ' Sara@Coffee.SA ',
          phone: '+966 50 123 4567',
          country: 'sa',
          currency: 'sar',
          timezone: 'Asia/Riyadh',
          website: 'https://coffee.sa',
          businessIndustry: 'Food',
          internalNotes: 'Secret note',
        },
        actor,
      );
      expect(client).toMatchObject({
        email: 'sara@coffee.sa',
        country: 'SA',
        currency: 'SAR',
        timezone: 'Asia/Riyadh',
        internalNotes: 'Secret note',
      });
      expect(client.name.startsWith('Coffee ')).toBe(true);
    });

    it('refuses invalid data, lists the wrong fields, and writes nothing', async () => {
      const name = `Bad ${tag()}`;
      const error: unknown = await service
        .create({ name, email: 'nope', currency: 'ABC' }, actor)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ClientValidationError);
      expect((error as ClientValidationError).fields.map((f) => f.field)).toEqual(
        expect.arrayContaining(['email', 'currency']),
      );
      expect(await prisma.client.count({ where: { name } })).toBe(0);
    });

    it('writes the creation to the audit log, with the administrator and IP', async () => {
      const client = await service.create(
        { name: `Coffee ${tag()}`, internalNotes: 'Secret note' },
        actor,
      );
      const [row] = await auditFor(client.id);
      expect(row).toMatchObject({
        action: 'admin.client.created',
        userId: actor.userId,
        ip: actor.ip,
      });
      expect(JSON.stringify(row)).not.toContain('Secret note');
    });
  });

  describe('update', () => {
    it('changes only the given fields; an empty text clears a field', async () => {
      const client = await service.create(
        { name: `Coffee ${tag()}`, phone: '+966500000000', website: 'https://a.sa' },
        actor,
      );
      const updated = await service.update(client.id, { phone: '', contactName: 'Omar' }, actor);
      expect(updated).toMatchObject({ phone: null, contactName: 'Omar', website: 'https://a.sa' });
    });

    it('logs the NAMES of the changed fields, never their values', async () => {
      const client = await service.create({ name: `Coffee ${tag()}` }, actor);
      await service.update(
        client.id,
        { internalNotes: 'Very secret', phone: '+966511111111' },
        actor,
      );

      const rows = await auditFor(client.id);
      const updatedRow = rows.find((row) => row.action === 'admin.client.updated');
      expect(updatedRow?.metadata).toEqual({
        clientId: client.id,
        fields: 'phone,internalNotes',
      });
      expect(JSON.stringify(rows)).not.toContain('Very secret');
    });

    it('writes nothing when nothing really changes', async () => {
      const client = await service.create(
        { name: `Coffee ${tag()}`, phone: '+966500000000' },
        actor,
      );
      await service.update(client.id, { phone: '+966500000000' }, actor);
      expect((await auditFor(client.id)).map((row) => row.action)).toEqual([
        'admin.client.created',
      ]);
    });

    it('refuses invalid data', async () => {
      const client = await service.create({ name: `Coffee ${tag()}` }, actor);
      await expect(service.update(client.id, { timezone: 'Mars/Base' }, actor)).rejects.toThrow(
        ClientValidationError,
      );
      await expect(service.update(client.id, {}, actor)).rejects.toThrow(ClientValidationError);
    });
  });

  describe('status (suspend, activate, archive)', () => {
    it('suspends and reactivates, and logs both changes', async () => {
      const client = await service.create({ name: `Coffee ${tag()}` }, actor);
      expect((await service.changeStatus(client.id, 'suspend', actor)).status).toBe('SUSPENDED');
      expect((await service.changeStatus(client.id, 'activate', actor)).status).toBe('ACTIVE');

      const changes = (await auditFor(client.id))
        .filter((row) => row.action === 'admin.client.status_changed')
        .map((row) => row.metadata as { from: string; to: string });
      expect(changes).toEqual([
        expect.objectContaining({ from: 'ACTIVE', to: 'SUSPENDED' }),
        expect.objectContaining({ from: 'SUSPENDED', to: 'ACTIVE' }),
      ]);
    });

    it('an archived client is read-only, but can be reactivated', async () => {
      const client = await service.create({ name: `Coffee ${tag()}` }, actor);
      await service.changeStatus(client.id, 'archive', actor);

      await expect(service.update(client.id, { phone: '+966500000000' }, actor)).rejects.toThrow(
        ClientArchivedError,
      );
      await expect(service.changeStatus(client.id, 'suspend', actor)).rejects.toThrow(
        InvalidClientStatusChangeError,
      );
      expect((await service.changeStatus(client.id, 'activate', actor)).status).toBe('ACTIVE');
    });

    it('refuses a change to the same status', async () => {
      const client = await service.create({ name: `Coffee ${tag()}` }, actor);
      await expect(service.changeStatus(client.id, 'activate', actor)).rejects.toThrow(
        InvalidClientStatusChangeError,
      );
    });
  });

  describe('list and get', () => {
    it('searches name, contact and email, without case', async () => {
      const t = tag();
      await service.create({ name: `Alpha ${t}` }, actor);
      await service.create({ name: 'Beta Ltd', contactName: `Contact ${t}` }, actor);
      await service.create({ name: 'Gamma Ltd', email: `info@${t}.com` }, actor);
      await service.create({ name: 'Unrelated Ltd' }, actor);

      const page = await service.list({ search: t.toUpperCase() });
      expect(page.total).toBe(3);
    });

    it('filters by status and splits into pages', async () => {
      const t = tag();
      for (let i = 0; i < 3; i += 1) await service.create({ name: `Page ${t} ${i}` }, actor);
      const archived = await service.create({ name: `Page ${t} archived` }, actor);
      await service.changeStatus(archived.id, 'archive', actor);

      const first = await service.list({ search: t, status: 'ACTIVE', pageSize: '2' });
      expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(first.items).toHaveLength(2);
      const second = await service.list({ search: t, status: 'ACTIVE', page: '2', pageSize: '2' });
      expect(second.items).toHaveLength(1);
      expect((await service.list({ search: t, status: 'ARCHIVED' })).total).toBe(1);
    });

    it('"not found" for an unknown id and for a value that is not an id', async () => {
      await expect(service.get(randomUUID())).rejects.toThrow(ClientNotFoundError);
      await expect(service.get('../../users')).rejects.toThrow(ClientNotFoundError);
      await expect(service.update('1 OR 1=1', { name: 'Hack' }, actor)).rejects.toThrow(
        ClientNotFoundError,
      );
    });
  });

  describe('database protections', () => {
    it('the application CANNOT delete a client (archive only)', async () => {
      const client = await service.create({ name: `Coffee ${tag()}` }, actor);
      await expect(prisma.client.delete({ where: { id: client.id } })).rejects.toThrow();
      await expect(prisma.client.deleteMany()).rejects.toThrow();
      expect(await prisma.client.count({ where: { id: client.id } })).toBe(1);
    });

    it('the database refuses invalid data even without the application checks', async () => {
      await expect(
        prisma.client.create({ data: { name: `Raw ${tag()}`, currency: 'usd' } }),
      ).rejects.toThrow();
      await expect(
        prisma.client.create({ data: { name: `Raw ${tag()}`, email: 'UPPER@CASE.COM' } }),
      ).rejects.toThrow();
      await expect(prisma.client.create({ data: { name: '  padded  ' } })).rejects.toThrow();
    });
  });
});
