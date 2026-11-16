import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { auditRow, type AuditMetadata } from '../audit/audit';
import type { Actor } from '../clients/clients.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TaskNotFoundError,
  TaskRecurrenceNotFoundError,
  TaskValidationError,
} from './tasks.errors';
import {
  CommentSchema,
  CreateRecurrenceSchema,
  CreateTaskSchema,
  IdSchema,
  ListTasksQuerySchema,
  UpdateRecurrenceSchema,
  UpdateTaskSchema,
} from './tasks.schemas';
import { syncAll } from './tasks.sync';
import { notifyClient } from '../notifications/notify';

type Status = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

// What the ADMINISTRATION sees.
export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  dueOn: string | null;
  clientId: string | null;
  clientName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  visibleToClient: boolean;
  source: 'MANUAL' | 'RECURRING' | 'SYSTEM';
  // invoice-review, invoice-overdue, stale-campaign (SYSTEM tasks only).
  systemKind: string | null;
  recurrenceId: string | null;
  occurrenceOn: string | null;
  completedAt: string | null;
  createdByName: string | null;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends TaskView {
  comments: { id: string; body: string; authorName: string; createdAt: string }[];
}

// What the CLIENT sees: no comments, no author, no internal origin.
export interface ClientTaskView {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  dueOn: string | null;
  campaignName: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface RecurrenceView {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  clientId: string | null;
  clientName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  visibleToClient: boolean;
  frequency: 'WEEKLY' | 'MONTHLY';
  day: number;
  dueAfterDays: number;
  startsOn: string;
  endsOn: string | null;
  paused: boolean;
  createdAt: string;
}

const INCLUDE = {
  client: { select: { name: true } },
  campaign: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  _count: { select: { comments: true } },
} as const;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof INCLUDE }>;

const dateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const toDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);
const utcToday = () => new Date().toISOString().slice(0, 10);

function toView(row: TaskRow): TaskView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueOn: dateOnly(row.dueOn),
    clientId: row.clientId,
    clientName: row.client?.name ?? null,
    campaignId: row.campaignId,
    campaignName: row.campaign?.name ?? null,
    visibleToClient: row.visibleToClient,
    source: row.source,
    systemKind: row.systemKey ? (row.systemKey.split(':')[0] ?? null) : null,
    recurrenceId: row.recurrenceId,
    occurrenceOn: dateOnly(row.occurrenceOn),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdByName: row.createdBy?.fullName ?? null,
    commentsCount: row._count.comments,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function databaseMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const meta = (error as { meta?: unknown }).meta;
  const cause = (error as { cause?: unknown }).cause;
  return [
    error.message,
    JSON.stringify(meta ?? ''),
    cause instanceof Error ? cause.message : '',
  ].join(' ');
}

// PostgreSQL refusals as expected errors with the field concerned.
function translate(error: unknown): unknown {
  const text = databaseMessage(error);
  const rules: [string, string, string][] = [
    ['does not belong to the client', 'campaignId', 'the campaign does not belong to this client'],
    ['_campaign_check', 'campaignId', 'a campaign needs its client'],
    ['_visible_check', 'visibleToClient', 'only a task of a client can be shared with it'],
    ['_client_id_fkey', 'clientId', 'unknown client'],
    ['_campaign_id_fkey', 'campaignId', 'unknown campaign'],
    ['task_recurrences_dates_check', 'endsOn', 'cannot be before the start'],
  ];
  for (const [needle, field, message] of rules) {
    if (text.includes(needle)) return new TaskValidationError({ field, message });
  }
  return error;
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new TaskValidationError(result.error);
  return result.data;
}

function checkId(id: string, error: Error): void {
  if (!IdSchema.safeParse(id).success) throw error;
}

// Tasks (step 8.2, ADR 0022). PostgreSQL enforces the rules (links, sources,
// completion time, no delete); this service validates, audits every change
// in the same transaction, and never shows comments to a client.
@Injectable()
export class TasksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Creates the due recurring and system tasks, closes the solved ones,
  // and writes the notifications they lead to.
  sync(actor: Actor | null) {
    return syncAll(this.prisma, actor);
  }

  async list(query: unknown, actor: Actor) {
    const q = parse(ListTasksQuerySchema, query);
    await this.sync(actor);
    const today = new Date(`${utcToday()}T00:00:00Z`);
    const week = new Date(today.getTime() + 7 * 86_400_000);
    const open: Status[] = ['TODO', 'IN_PROGRESS'];
    const base: Prisma.TaskWhereInput = {
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.campaignId ? { campaignId: q.campaignId } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.due === 'overdue' ? { dueOn: { lt: today }, status: { in: open } } : {}),
      ...(q.due === 'today' ? { dueOn: today } : {}),
      ...(q.due === 'week' ? { dueOn: { gte: today, lte: week } } : {}),
      ...(q.due === 'none' ? { dueOn: null } : {}),
    };
    const where: Prisma.TaskWhereInput = q.status
      ? { AND: [base, { status: { in: q.status } }] }
      : base;
    const [rows, total, byStatus, overdue] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: INCLUDE,
        orderBy: [
          { dueOn: { sort: 'asc', nulls: 'last' } },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.task.count({ where }),
      this.prisma.task.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.task.count({
        where: { AND: [base, { dueOn: { lt: today }, status: { in: open } }] },
      }),
    ]);
    const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0, overdue };
    for (const row of byStatus) counts[row.status] = row._count._all;
    return { items: rows.map(toView), total, page: q.page, pageSize: q.pageSize, counts };
  }

  async get(id: string): Promise<TaskDetail> {
    checkId(id, new TaskNotFoundError());
    const row = await this.prisma.task.findUnique({
      where: { id },
      include: {
        ...INCLUDE,
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { fullName: true } } },
        },
      },
    });
    if (!row) throw new TaskNotFoundError();
    return {
      ...toView(row),
      comments: row.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorName: comment.author.fullName,
        createdAt: comment.createdAt.toISOString(),
      })),
    };
  }

  async create(input: unknown, actor: Actor): Promise<TaskView> {
    const data = parse(CreateTaskSchema, input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.task.create({
          data: {
            title: data.title,
            description: data.description ?? null,
            priority: data.priority,
            dueOn: toDate(data.dueOn) ?? null,
            clientId: data.clientId ?? null,
            campaignId: data.campaignId ?? null,
            visibleToClient: data.visibleToClient,
            source: 'MANUAL',
            createdById: actor.userId,
          },
          include: INCLUDE,
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.task.created',
            metadata: {
              taskId: row.id,
              clientId: row.clientId,
              campaignId: row.campaignId,
              title: row.title,
              priority: row.priority,
              dueOn: dateOnly(row.dueOn),
              visibleToClient: row.visibleToClient,
            },
          }),
        });
        if (row.visibleToClient && row.clientId) {
          await notifyClient(tx, row.clientId, {
            kind: 'task.shared',
            params: { title: row.title },
            link: '/tasks',
            dedupeKey: `task-shared:${row.id}`,
          });
        }
        return toView(row);
      });
    } catch (error) {
      throw translate(error);
    }
  }

  async update(id: string, input: unknown, actor: Actor): Promise<TaskView> {
    checkId(id, new TaskNotFoundError());
    const data = parse(UpdateTaskSchema, input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.task.findUnique({ where: { id }, include: INCLUDE });
        if (!before) throw new TaskNotFoundError();
        // Removing the client removes its campaign and the sharing too.
        const clearsClient = data.clientId === null;
        const row = await tx.task.update({
          where: { id },
          data: {
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.priority !== undefined ? { priority: data.priority } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.dueOn !== undefined ? { dueOn: toDate(data.dueOn) } : {}),
            ...(data.clientId !== undefined ? { clientId: data.clientId } : {}),
            ...(data.campaignId !== undefined ? { campaignId: data.campaignId } : {}),
            ...(data.visibleToClient !== undefined
              ? { visibleToClient: data.visibleToClient }
              : {}),
            ...(clearsClient ? { campaignId: null, visibleToClient: false } : {}),
          },
          include: INCLUDE,
        });
        const changes: AuditMetadata = { taskId: id };
        const compare: [string, unknown, unknown][] = [
          ['title', before.title, row.title],
          ['status', before.status, row.status],
          ['priority', before.priority, row.priority],
          ['dueOn', dateOnly(before.dueOn), dateOnly(row.dueOn)],
          ['clientId', before.clientId, row.clientId],
          ['campaignId', before.campaignId, row.campaignId],
          ['visibleToClient', before.visibleToClient, row.visibleToClient],
        ];
        for (const [field, old, now] of compare) {
          if (old !== now) {
            changes[`before.${field}`] = old as string | boolean | null;
            changes[`after.${field}`] = now as string | boolean | null;
          }
        }
        // The text of a description is not copied into the log.
        if (before.description !== row.description) changes['descriptionChanged'] = true;
        // The client hears about its shared tasks: newly shared, or a new status.
        if (row.visibleToClient && row.clientId) {
          if (!before.visibleToClient || before.clientId !== row.clientId) {
            await notifyClient(tx, row.clientId, {
              kind: 'task.shared',
              params: { title: row.title },
              link: '/tasks',
              dedupeKey: `task-shared:${row.id}`,
            });
          } else if (before.status !== row.status && row.status !== 'CANCELLED') {
            await notifyClient(tx, row.clientId, {
              kind: 'task.status_changed',
              params: { title: row.title, status: row.status },
              link: '/tasks',
            });
          }
        }
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action:
              before.status !== row.status ? 'admin.task.status_changed' : 'admin.task.updated',
            metadata: changes,
          }),
        });
        return toView(row);
      });
    } catch (error) {
      throw translate(error);
    }
  }

  async addComment(id: string, input: unknown, actor: Actor): Promise<TaskDetail> {
    checkId(id, new TaskNotFoundError());
    const data = parse(CommentSchema, input);
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id },
        select: { id: true, clientId: true },
      });
      if (!task) throw new TaskNotFoundError();
      const comment = await tx.taskComment.create({
        data: { taskId: id, authorId: actor.userId, body: data.body },
      });
      // Comments are internal: the log keeps their id and length, not their text.
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.task.comment_added',
          metadata: {
            taskId: id,
            clientId: task.clientId,
            commentId: comment.id,
            length: data.body.length,
          },
        }),
      });
    });
    return this.get(id);
  }

  // ---- Recurring rules -------------------------------------------------

  private toRecurrenceView(
    row: Prisma.TaskRecurrenceGetPayload<{
      include: { client: { select: { name: true } }; campaign: { select: { name: true } } };
    }>,
  ): RecurrenceView {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      priority: row.priority,
      clientId: row.clientId,
      clientName: row.client?.name ?? null,
      campaignId: row.campaignId,
      campaignName: row.campaign?.name ?? null,
      visibleToClient: row.visibleToClient,
      frequency: row.frequency,
      day: (row.frequency === 'WEEKLY' ? row.dayOfWeek : row.dayOfMonth) ?? 1,
      dueAfterDays: row.dueAfterDays,
      startsOn: dateOnly(row.startsOn) ?? '',
      endsOn: dateOnly(row.endsOn),
      paused: row.pausedAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listRecurrences(): Promise<RecurrenceView[]> {
    const rows = await this.prisma.taskRecurrence.findMany({
      include: { client: { select: { name: true } }, campaign: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toRecurrenceView(row));
  }

  async createRecurrence(input: unknown, actor: Actor): Promise<RecurrenceView> {
    const data = parse(CreateRecurrenceSchema, input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.taskRecurrence.create({
          data: {
            title: data.title,
            description: data.description ?? null,
            priority: data.priority,
            clientId: data.clientId ?? null,
            campaignId: data.campaignId ?? null,
            visibleToClient: data.visibleToClient,
            frequency: data.frequency,
            dayOfWeek: data.frequency === 'WEEKLY' ? data.day : null,
            dayOfMonth: data.frequency === 'MONTHLY' ? data.day : null,
            dueAfterDays: data.dueAfterDays,
            startsOn: new Date(`${data.startsOn}T00:00:00Z`),
            endsOn: toDate(data.endsOn) ?? null,
            createdById: actor.userId,
          },
          include: { client: { select: { name: true } }, campaign: { select: { name: true } } },
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.task_recurrence.created',
            metadata: {
              recurrenceId: row.id,
              clientId: row.clientId,
              title: row.title,
              frequency: row.frequency,
              day: data.day,
              startsOn: data.startsOn,
            },
          }),
        });
        return this.toRecurrenceView(row);
      });
    } catch (error) {
      throw translate(error);
    }
  }

  // Changes apply to the next occurrences; tasks already made stay as they are.
  async updateRecurrence(id: string, input: unknown, actor: Actor): Promise<RecurrenceView> {
    checkId(id, new TaskRecurrenceNotFoundError());
    const data = parse(UpdateRecurrenceSchema, input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.taskRecurrence.findUnique({ where: { id } });
        if (!before) throw new TaskRecurrenceNotFoundError();
        const frequency = data.frequency ?? before.frequency;
        const day =
          data.day ??
          (frequency === before.frequency ? (before.dayOfWeek ?? before.dayOfMonth) : null);
        if (day === null || (frequency === 'WEEKLY' && day > 7)) {
          throw new TaskValidationError({
            field: 'day',
            message: 'choose the day of the new frequency',
          });
        }
        const clearsClient = data.clientId === null;
        const row = await tx.taskRecurrence.update({
          where: { id },
          data: {
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.priority !== undefined ? { priority: data.priority } : {}),
            ...(data.clientId !== undefined ? { clientId: data.clientId } : {}),
            ...(data.campaignId !== undefined ? { campaignId: data.campaignId } : {}),
            ...(data.visibleToClient !== undefined
              ? { visibleToClient: data.visibleToClient }
              : {}),
            ...(clearsClient ? { campaignId: null, visibleToClient: false } : {}),
            frequency,
            dayOfWeek: frequency === 'WEEKLY' ? day : null,
            dayOfMonth: frequency === 'MONTHLY' ? day : null,
            ...(data.dueAfterDays !== undefined ? { dueAfterDays: data.dueAfterDays } : {}),
            ...(data.endsOn !== undefined ? { endsOn: toDate(data.endsOn) } : {}),
            ...(data.paused !== undefined
              ? { pausedAt: data.paused ? (before.pausedAt ?? new Date()) : null }
              : {}),
          },
          include: { client: { select: { name: true } }, campaign: { select: { name: true } } },
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.task_recurrence.updated',
            metadata: {
              recurrenceId: id,
              changed: Object.keys(data).join(','),
              'before.paused': before.pausedAt !== null,
              'after.paused': row.pausedAt !== null,
              'before.frequency': before.frequency,
              'after.frequency': row.frequency,
            },
          }),
        });
        return this.toRecurrenceView(row);
      });
    } catch (error) {
      throw translate(error);
    }
  }

  // ---- Client portal ---------------------------------------------------

  private toClientView(row: TaskRow): ClientTaskView {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueOn: dateOnly(row.dueOn),
      campaignName: row.campaign?.name ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // Only the tasks shared with this client, never cancelled ones.
  private clientWhere(clientId: string): Prisma.TaskWhereInput {
    return { clientId, visibleToClient: true, status: { not: 'CANCELLED' } };
  }

  async listForClient(clientId: string): Promise<ClientTaskView[]> {
    const rows = await this.prisma.task.findMany({
      where: this.clientWhere(clientId),
      include: INCLUDE,
      orderBy: [
        { status: 'asc' },
        { dueOn: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: 200,
    });
    return rows.map((row) => this.toClientView(row));
  }

  async getForClient(clientId: string, id: string): Promise<ClientTaskView> {
    checkId(id, new TaskNotFoundError());
    const row = await this.prisma.task.findFirst({
      where: { ...this.clientWhere(clientId), id },
      include: INCLUDE,
    });
    // Another client's task, or one not shared: the same 404 (no hint).
    if (!row) throw new TaskNotFoundError();
    return this.toClientView(row);
  }
}
