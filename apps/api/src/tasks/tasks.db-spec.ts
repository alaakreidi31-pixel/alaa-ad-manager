import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { createSessionToken, httpCall, startHttpTestApp } from '../testing/http-test-app';
import { inRollback } from '../testing/rollback-db';
import { createTestPrisma } from '../testing/test-prisma';
import { TaskNotFoundError, TaskValidationError } from './tasks.errors';
import { TasksService } from './tasks.service';

// The real PrismaService reads .env at import time: replace it by a token.
// Every test runs in a transaction that is rolled back (inRollback): tasks
// and comments can never be deleted, so a test must leave none behind.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));

const base = createTestPrisma();
const today = new Date().toISOString().slice(0, 10);
const plusDays = (days: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const isoWeekday = (() => {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
})();

async function admin(prisma: PrismaClient) {
  const user = await prisma.user.create({
    data: {
      email: `tasks-${randomUUID().slice(0, 8)}@alaa.test`,
      fullName: 'Tasks Admin',
      passwordHash: 'x',
      role: 'SUPER_ADMIN',
    },
  });
  return { userId: user.id, ip: '127.0.0.1', userAgent: 'vitest' };
}

async function clientWithCampaign(prisma: PrismaClient, createdDaysAgo = 0) {
  const client = await prisma.client.create({
    data: { name: `Tasks ${randomUUID().slice(0, 8)}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      clientId: client.id,
      platform: 'META',
      name: `Campaign ${randomUUID().slice(0, 8)}`,
      currency: 'USD',
      createdAt: new Date(Date.now() - createdDaysAgo * 86_400_000),
    },
  });
  return { client, campaign };
}

describe('TasksService (real PostgreSQL, test database)', () => {
  it('creates a task for a campaign of a client, lists it with counts, and audits it', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const actor = await admin(prisma);
      const { client, campaign } = await clientWithCampaign(prisma);
      const task = await service.create(
        {
          title: 'New creatives',
          description: 'Three images',
          priority: 'HIGH',
          dueOn: plusDays(-1),
          clientId: client.id,
          campaignId: campaign.id,
          visibleToClient: true,
        },
        actor,
      );
      expect(task).toMatchObject({
        status: 'TODO',
        source: 'MANUAL',
        clientName: client.name,
        campaignName: campaign.name,
        createdByName: 'Tasks Admin',
        dueOn: plusDays(-1),
        completedAt: null,
      });
      const page = await service.list({ clientId: client.id }, actor);
      expect(page.items.map((item) => item.id)).toEqual([task.id]);
      expect(page.counts).toMatchObject({ TODO: 1, overdue: 1 });
      const overdue = await service.list({ clientId: client.id, due: 'overdue' }, actor);
      expect(overdue.total).toBe(1);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'admin.task.created', userId: actor.userId },
      });
      expect(audit?.metadata).toMatchObject({
        taskId: task.id,
        clientId: client.id,
        priority: 'HIGH',
      });
    }));

  it('refuses a campaign of another client, a shared task without client, bad input', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const actor = await admin(prisma);
      const a = await clientWithCampaign(prisma);
      const b = await clientWithCampaign(prisma);
      await expect(
        service.create({ title: 'x', clientId: a.client.id, campaignId: b.campaign.id }, actor),
      ).rejects.toMatchObject({ fields: [{ field: 'campaignId' }] });
      await expect(
        service.create({ title: 'x', visibleToClient: true }, actor),
      ).rejects.toMatchObject({
        fields: [{ field: 'visibleToClient' }],
      });
      await expect(service.create({ title: '' }, actor)).rejects.toBeInstanceOf(
        TaskValidationError,
      );
      await expect(
        service.create({ title: 'x', priority: 'URGENT' }, actor),
      ).rejects.toBeInstanceOf(TaskValidationError);
      await expect(
        service.create({ title: 'x', clientId: randomUUID() }, actor),
      ).rejects.toMatchObject({
        fields: [{ field: 'clientId' }],
      });
      await expect(service.get('not-a-uuid')).rejects.toBeInstanceOf(TaskNotFoundError);
    }));

  it('status: DONE sets the completion time, reopening clears it; every change is audited', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const actor = await admin(prisma);
      const task = await service.create({ title: 'Status task' }, actor);
      const done = await service.update(task.id, { status: 'DONE' }, actor);
      expect(done.completedAt).not.toBeNull();
      const reopened = await service.update(
        task.id,
        { status: 'IN_PROGRESS', priority: 'LOW' },
        actor,
      );
      expect(reopened).toMatchObject({ completedAt: null, priority: 'LOW' });
      const audits = await prisma.auditLog.findMany({
        where: { action: 'admin.task.status_changed', userId: actor.userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((row) => row.metadata)).toEqual([
        expect.objectContaining({ 'before.status': 'TODO', 'after.status': 'DONE' }),
        expect.objectContaining({
          'before.status': 'DONE',
          'after.status': 'IN_PROGRESS',
          'before.priority': 'MEDIUM',
          'after.priority': 'LOW',
        }),
      ]);
      await expect(service.update(task.id, {}, actor)).rejects.toBeInstanceOf(TaskValidationError);
      await expect(service.update(randomUUID(), { title: 'x' }, actor)).rejects.toBeInstanceOf(
        TaskNotFoundError,
      );
    }));

  it('removing the client also removes its campaign and the sharing', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const actor = await admin(prisma);
      const { client, campaign } = await clientWithCampaign(prisma);
      const task = await service.create(
        { title: 'Linked', clientId: client.id, campaignId: campaign.id, visibleToClient: true },
        actor,
      );
      const updated = await service.update(task.id, { clientId: '' }, actor);
      expect(updated).toMatchObject({ clientId: null, campaignId: null, visibleToClient: false });
    }));

  it('comments: kept in order with their author; the log never holds the text', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const actor = await admin(prisma);
      const task = await service.create({ title: 'Commented' }, actor);
      await service.addComment(task.id, { body: 'First note' }, actor);
      const detail = await service.addComment(task.id, { body: 'Secret second note' }, actor);
      expect(detail.comments.map((comment) => [comment.body, comment.authorName])).toEqual([
        ['First note', 'Tasks Admin'],
        ['Secret second note', 'Tasks Admin'],
      ]);
      expect(detail.commentsCount).toBe(2);
      const audits = await prisma.auditLog.findMany({
        where: { action: 'admin.task.comment_added', userId: actor.userId },
      });
      expect(audits).toHaveLength(2);
      expect(JSON.stringify(audits)).not.toContain('Secret');
      await expect(service.addComment(task.id, { body: '   ' }, actor)).rejects.toBeInstanceOf(
        TaskValidationError,
      );
    }));

  it('recurring: today’s occurrence is created once, with its due date; paused rules stop', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const actor = await admin(prisma);
      const { client } = await clientWithCampaign(prisma);
      const rule = await service.createRecurrence(
        {
          title: 'Weekly check',
          clientId: client.id,
          frequency: 'WEEKLY',
          day: isoWeekday,
          dueAfterDays: 2,
          startsOn: plusDays(-14),
        },
        actor,
      );
      expect(rule).toMatchObject({ frequency: 'WEEKLY', day: isoWeekday, paused: false });
      await service.list({ clientId: client.id }, actor);
      await service.list({ clientId: client.id }, actor); // twice: still one
      const made = await prisma.task.findMany({ where: { recurrenceId: rule.id } });
      // The rule was created today: no occurrence before it existed.
      expect(
        made.map((task) => [
          task.source,
          task.occurrenceOn?.toISOString().slice(0, 10),
          task.dueOn?.toISOString().slice(0, 10),
        ]),
      ).toEqual([['RECURRING', today, plusDays(2)]]);
      const paused = await service.updateRecurrence(rule.id, { paused: true }, actor);
      expect(paused.paused).toBe(true);
      await expect(
        service.createRecurrence(
          { title: 'x', frequency: 'WEEKLY', day: 8, startsOn: today },
          actor,
        ),
      ).rejects.toMatchObject({ fields: [{ field: 'day' }] });
      await expect(
        service.createRecurrence(
          { title: 'x', frequency: 'MONTHLY', day: 31, startsOn: today },
          actor,
        ),
      ).rejects.toBeInstanceOf(TaskValidationError);
    }));

  it('system: a campaign without numbers gets a task, closed by itself when numbers arrive', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const actor = await admin(prisma);
      const { client, campaign } = await clientWithCampaign(prisma, 10);
      await service.list({ clientId: client.id }, actor);
      const key = `stale-campaign:${campaign.id}:none`;
      const task = await prisma.task.findUnique({ where: { systemKey: key } });
      expect(task).toMatchObject({
        source: 'SYSTEM',
        status: 'TODO',
        campaignId: campaign.id,
        createdById: null,
      });
      await prisma.campaignDailyMetric.create({
        data: {
          campaignId: campaign.id,
          date: new Date(`${today}T00:00:00Z`),
          spendMinor: 100n,
          impressions: 10n,
          clicks: 1n,
          conversions: '0',
          source: 'MANUAL',
        },
      });
      const page = await service.list({ clientId: client.id, source: 'SYSTEM' }, actor);
      expect(page.items.find((item) => item.id === task?.id)).toMatchObject({
        status: 'DONE',
        systemKind: 'stale-campaign',
      });
    }));
});

describe('/api/admin/tasks and /api/client/tasks over HTTP', () => {
  afterAll(async () => {
    await base.$disconnect();
  });

  it('admin routes: 401 without token, 403 for a client account', () =>
    inRollback(base, async (prisma) => {
      const server = await startHttpTestApp(prisma);
      try {
        const { client } = await clientWithCampaign(prisma);
        const user = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', client.id)).token;
        for (const [method, path] of [
          ['GET', '/admin/tasks'],
          ['POST', '/admin/tasks'],
          ['GET', '/admin/task-recurrences'],
        ] as const) {
          expect((await httpCall(server.baseUrl, method, path)).status).toBe(401);
          expect(
            (await httpCall(server.baseUrl, method, path, user, method === 'POST' ? {} : undefined))
              .status,
          ).toBe(403);
        }
        const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
        expect((await httpCall(server.baseUrl, 'GET', '/client/tasks', admin)).status).toBe(403);
      } finally {
        await server.close();
      }
    }));

  it('create, update and comment with stable error codes', () =>
    inRollback(base, async (prisma) => {
      const server = await startHttpTestApp(prisma);
      try {
        const admin = (await createSessionToken(prisma, server.jwt, 'SUPER_ADMIN')).token;
        const created = await httpCall(server.baseUrl, 'POST', '/admin/tasks', admin, {
          title: 'HTTP task',
        });
        expect(created).toMatchObject({
          status: 201,
          body: { title: 'HTTP task', status: 'TODO' },
        });
        const id = created.body['id'] as string;
        const patched = await httpCall(server.baseUrl, 'PATCH', `/admin/tasks/${id}`, admin, {
          status: 'DONE',
        });
        expect(patched).toMatchObject({ status: 200, body: { status: 'DONE' } });
        const commented = await httpCall(
          server.baseUrl,
          'POST',
          `/admin/tasks/${id}/comments`,
          admin,
          {
            body: 'ok',
          },
        );
        expect(commented).toMatchObject({ status: 201, body: { commentsCount: 1 } });
        const bad = await httpCall(server.baseUrl, 'POST', '/admin/tasks', admin, { title: '' });
        expect(bad).toMatchObject({ status: 400, body: { code: 'invalid_input' } });
        const missing = await httpCall(
          server.baseUrl,
          'GET',
          `/admin/tasks/${randomUUID()}`,
          admin,
        );
        expect(missing).toMatchObject({ status: 404, body: { code: 'task_not_found' } });
      } finally {
        await server.close();
      }
    }));

  it('IDOR: a client sees only ITS shared tasks, never comments, never another client’s', () =>
    inRollback(base, async (prisma) => {
      const service = new TasksService(prisma as unknown as PrismaService);
      const server = await startHttpTestApp(prisma);
      try {
        const actor = await admin(prisma);
        const mine = await clientWithCampaign(prisma);
        const other = await clientWithCampaign(prisma);
        const shared = await service.create(
          {
            title: 'Shared with me',
            clientId: mine.client.id,
            campaignId: mine.campaign.id,
            visibleToClient: true,
          },
          actor,
        );
        await service.addComment(shared.id, { body: 'Internal: client is late' }, actor);
        const internal = await service.create(
          { title: 'Internal only', clientId: mine.client.id },
          actor,
        );
        const cancelled = await service.create(
          { title: 'Cancelled', clientId: mine.client.id, visibleToClient: true },
          actor,
        );
        await service.update(cancelled.id, { status: 'CANCELLED' }, actor);
        const foreign = await service.create(
          { title: 'Other client', clientId: other.client.id, visibleToClient: true },
          actor,
        );
        const user = (await createSessionToken(prisma, server.jwt, 'CLIENT_USER', mine.client.id))
          .token;

        const list = await httpCall(server.baseUrl, 'GET', '/client/tasks', user);
        expect(list.status).toBe(200);
        const items = list.body as unknown as Record<string, unknown>[];
        expect(items.map((item) => item['title'])).toEqual(['Shared with me']);
        expect(Object.keys(items[0] ?? {}).sort()).toEqual(
          [
            'campaignName',
            'completedAt',
            'description',
            'dueOn',
            'id',
            'priority',
            'status',
            'title',
            'updatedAt',
          ].sort(),
        );
        expect(JSON.stringify(list.body)).not.toContain('Internal');

        const one = await httpCall(server.baseUrl, 'GET', `/client/tasks/${shared.id}`, user);
        expect(one).toMatchObject({
          status: 200,
          body: { title: 'Shared with me', campaignName: mine.campaign.name },
        });
        for (const id of [internal.id, cancelled.id, foreign.id, 'not-a-uuid']) {
          const refused = await httpCall(server.baseUrl, 'GET', `/client/tasks/${id}`, user);
          expect(refused).toMatchObject({ status: 404, body: { code: 'task_not_found' } });
        }
      } finally {
        await server.close();
      }
    }));
});
