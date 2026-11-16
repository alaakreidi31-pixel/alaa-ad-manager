import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CampaignsService } from '../campaigns/campaigns.service';
import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { createSessionToken, httpCall, startHttpTestApp } from '../testing/http-test-app';
import { inRollback } from '../testing/rollback-db';
import { createTestPrisma } from '../testing/test-prisma';
import { NotificationNotFoundError, NotificationsService } from './notifications.service';
import { deviceName, notifyAdmins, notifyClient } from './notify';

// The real PrismaService reads .env at import time: replace it by a token.
// Every test runs in a transaction that is rolled back (inRollback).
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const base = createTestPrisma();

async function account(
  prisma: PrismaClient,
  role: 'SUPER_ADMIN' | 'CLIENT_USER',
  clientId: string | null = null,
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
) {
  return prisma.user.create({
    data: {
      email: `notify-${randomUUID().slice(0, 8)}@alaa.test`,
      fullName: 'Notify Test',
      passwordHash: 'x',
      role,
      clientId,
      status,
    },
  });
}

const actorOf = (userId: string) => ({ userId, ip: '127.0.0.1', userAgent: 'vitest' });

describe('notifications (real PostgreSQL, test database)', () => {
  afterAll(async () => {
    await base.$disconnect();
  });

  it('a client event reaches only the ACTIVE accounts of THAT client; admin events only admins', () =>
    inRollback(base, async (prisma) => {
      const mine = await prisma.client.create({ data: { name: 'Mine' } });
      const other = await prisma.client.create({ data: { name: 'Other' } });
      const me = await account(prisma, 'CLIENT_USER', mine.id);
      const suspended = await account(prisma, 'CLIENT_USER', mine.id, 'SUSPENDED');
      const stranger = await account(prisma, 'CLIENT_USER', other.id);
      const admin = await account(prisma, 'SUPER_ADMIN');

      await notifyClient(prisma, mine.id, {
        kind: 'invoice.issued',
        params: { number: 'AMG-2026-0001' },
        link: '/invoices/x',
      });
      await notifyAdmins(prisma, { kind: 'campaign.import_done', params: { client: 'Mine' } });

      const of = async (userId: string) =>
        (await prisma.notification.findMany({ where: { userId } })).map((row) => row.kind);
      expect(await of(me.id)).toEqual(['invoice.issued']);
      expect(await of(suspended.id)).toEqual([]);
      expect(await of(stranger.id)).toEqual([]);
      expect(await of(admin.id)).toEqual(['campaign.import_done']);
    }));

  it('the same dedupe key is shown once per user', () =>
    inRollback(base, async (prisma) => {
      const client = await prisma.client.create({ data: { name: 'Dedupe' } });
      const user = await account(prisma, 'CLIENT_USER', client.id);
      const note = { kind: 'invoice.overdue' as const, dedupeKey: 'invoice-overdue:x' };
      await notifyClient(prisma, client.id, note);
      await notifyClient(prisma, client.id, note);
      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    }));

  it('list, unread count, read one, read all: on the user’s OWN notifications only', () =>
    inRollback(base, async (prisma) => {
      const service = new NotificationsService(prisma as unknown as PrismaService);
      const client = await prisma.client.create({ data: { name: 'Reader' } });
      const me = await account(prisma, 'CLIENT_USER', client.id);
      const other = await account(prisma, 'SUPER_ADMIN');
      await notifyClient(prisma, client.id, { kind: 'invoice.issued' });
      await notifyClient(prisma, client.id, { kind: 'invoice.payment_recorded' });
      await notifyAdmins(prisma, { kind: 'campaign.import_done' });
      const theirs = await prisma.notification.findFirstOrThrow({ where: { userId: other.id } });

      const page = await service.list({}, actorOf(me.id));
      expect(page.items.map((item) => item.kind).sort()).toEqual([
        'invoice.issued',
        'invoice.payment_recorded',
      ]);
      expect(page.unread).toBe(2);

      const first = page.items[0];
      expect((await service.markRead(actorOf(me.id), first?.id ?? '')).unread).toBe(1);
      await expect(service.markRead(actorOf(me.id), theirs.id)).rejects.toBeInstanceOf(
        NotificationNotFoundError,
      );
      await expect(service.markRead(actorOf(me.id), 'not-a-uuid')).rejects.toBeInstanceOf(
        NotificationNotFoundError,
      );
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
      ).toBeNull();

      expect(await service.markAllRead(actorOf(me.id))).toEqual({ unread: 0 });
      expect((await service.list({ unread: '1' }, actorOf(me.id))).items).toEqual([]);
      // The other account still has its own unread notification (the sync
      // may have added others for administrators).
      expect((await service.unreadCount(actorOf(other.id))).unread).toBeGreaterThanOrEqual(1);
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
      ).toBeNull();
    }));

  it('events: a campaign status change and a shared task reach the client', () =>
    inRollback(base, async (prisma) => {
      const db = prisma as unknown as PrismaService;
      const admin = await account(prisma, 'SUPER_ADMIN');
      const client = await prisma.client.create({ data: { name: 'Events' } });
      const user = await account(prisma, 'CLIENT_USER', client.id);
      const campaign = await prisma.campaign.create({
        data: { clientId: client.id, platform: 'META', name: 'Spring', currency: 'USD' },
      });
      await new CampaignsService(db).changeStatus(
        client.id,
        campaign.id,
        'pause',
        actorOf(admin.id),
      );
      const tasks = new TasksService(db);
      const task = await tasks.create(
        { title: 'Send new photos', clientId: client.id, visibleToClient: true },
        actorOf(admin.id),
      );
      await tasks.update(task.id, { status: 'IN_PROGRESS' }, actorOf(admin.id));
      await tasks.create({ title: 'Internal only', clientId: client.id }, actorOf(admin.id));

      const rows = await prisma.notification.findMany({ where: { userId: user.id } });
      expect(rows.map((row) => [row.kind, row.params, row.link]).sort()).toEqual(
        [
          [
            'campaign.status_changed',
            { name: 'Spring', status: 'PAUSED' },
            `/campaigns/${campaign.id}`,
          ],
          ['task.shared', { title: 'Send new photos' }, '/tasks'],
          ['task.status_changed', { title: 'Send new photos', status: 'IN_PROGRESS' }, '/tasks'],
        ].sort(),
      );
      expect(JSON.stringify(rows)).not.toContain('Internal only');
    }));

  it('deviceName keeps only the browser and the system', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      ),
    ).toBe('Chrome / Windows');
    expect(
      deviceName(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari / iOS');
  });
});

describe('/api/notifications over HTTP', () => {
  afterAll(async () => {
    await base.$disconnect();
  });

  it('401 without token; IDOR: nobody reads or marks another account’s notifications', () =>
    inRollback(base, async (prisma) => {
      const server = await startHttpTestApp(prisma);
      try {
        expect((await httpCall(server.baseUrl, 'GET', '/notifications')).status).toBe(401);
        const client = await prisma.client.create({ data: { name: 'HTTP notify' } });
        const mine = await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id);
        const admin = await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN');
        await notifyClient(prisma, client.id, {
          kind: 'invoice.issued',
          params: { number: 'AMG-1' },
        });
        await notifyAdmins(prisma, { kind: 'security.account_locked', params: { email: 'x@y.z' } });
        const adminNote = await prisma.notification.findFirstOrThrow({
          where: { userId: admin.userId },
        });

        const list = await httpCall(server.baseUrl, 'GET', '/notifications', mine.token);
        expect(list.status).toBe(200);
        const items = list.body['items'] as { kind: string; id: string }[];
        expect(items.map((item) => item.kind)).toEqual(['invoice.issued']);

        const refused = await httpCall(
          server.baseUrl,
          'POST',
          `/notifications/${adminNote.id}/read`,
          mine.token,
        );
        expect(refused).toMatchObject({ status: 404, body: { code: 'notification_not_found' } });

        const read = await httpCall(
          server.baseUrl,
          'POST',
          `/notifications/${items[0]?.id ?? ''}/read`,
          mine.token,
        );
        expect(read).toMatchObject({ status: 200, body: { unread: 0 } });
        const count = await httpCall(
          server.baseUrl,
          'GET',
          '/notifications/unread-count',
          admin.token,
        );
        expect(count.body['unread']).toBeGreaterThanOrEqual(1);
      } finally {
        await server.close();
      }
    }));
});
