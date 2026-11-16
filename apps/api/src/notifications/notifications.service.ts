import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Actor } from '../clients/clients.service';
import { PrismaService } from '../prisma/prisma.service';
import { syncAll } from '../tasks/tasks.sync';

export class NotificationNotFoundError extends Error {
  constructor() {
    super('Notification not found');
  }
}

export interface NotificationView {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const ListQuerySchema = z.object({
  unread: z.enum(['1', 'true']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

// The bell asks often: the sync (recurring and system tasks, overdue
// invoices...) runs at most once a minute per server.
const SYNC_EVERY_MS = 60_000;

// In-app notifications (step 9.2, ADR 0023). Every route works on the
// notifications of the signed-in user ONLY: the user id comes from the
// session, never from the request.
@Injectable()
export class NotificationsService {
  private lastSync = 0;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async syncSometimes(actor: Actor): Promise<void> {
    if (Date.now() - this.lastSync < SYNC_EVERY_MS) return;
    this.lastSync = Date.now();
    await syncAll(this.prisma, actor);
  }

  async list(query: unknown, actor: Actor) {
    await this.syncSometimes(actor);
    // A malformed query falls back to the first page.
    const parsed = ListQuerySchema.safeParse(query);
    const q = parsed.success ? parsed.data : { unread: undefined, page: 1, pageSize: 20 };
    const where = { userId: actor.userId, ...(q.unread ? { readAt: null } : {}) };
    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
    ]);
    return {
      items: rows.map((row): NotificationView => ({
        id: row.id,
        kind: row.kind,
        params: (row.params ?? {}) as Record<string, unknown>,
        link: row.link,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      unread,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async unreadCount(actor: Actor): Promise<{ unread: number }> {
    await this.syncSometimes(actor);
    return {
      unread: await this.prisma.notification.count({
        where: { userId: actor.userId, readAt: null },
      }),
    };
  }

  // Another user's notification is "not found" (no hint that it exists).
  async markRead(actor: Actor, id: string): Promise<{ unread: number }> {
    if (!z.uuid().safeParse(id).success) throw new NotificationNotFoundError();
    // read_at is set by the database (its own time, once).
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId: actor.userId },
      data: { readAt: new Date() },
    });
    if (count === 0) throw new NotificationNotFoundError();
    return this.unreadCount(actor);
  }

  async markAllRead(actor: Actor): Promise<{ unread: number }> {
    await this.prisma.notification.updateMany({
      where: { userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { unread: 0 };
  }
}
