import { Inject, Injectable } from '@nestjs/common';
import { auditRow, type AuditContext } from '../audit/audit';
import type { Client, ClientStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClientArchivedError,
  ClientNotFoundError,
  ClientValidationError,
  InvalidClientStatusChangeError,
} from './clients.errors';
import {
  ClientIdSchema,
  CreateClientSchema,
  ListClientsQuerySchema,
  UpdateClientSchema,
} from './clients.schemas';

// The administrator doing the change, for the audit log.
export interface Actor extends AuditContext {
  userId: string;
}

// What the ADMINISTRATION sees, including the secret internal notes.
// A client-facing view (step 2.2) must NEVER reuse this shape.
export interface AdminClient {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  currency: string;
  timezone: string;
  website: string | null;
  businessIndustry: string | null;
  status: ClientStatus;
  internalNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientPage {
  items: AdminClient[];
  total: number;
  page: number;
  pageSize: number;
}

export type StatusAction = 'suspend' | 'activate' | 'archive';

// Allowed status changes. ARCHIVED can only be reactivated.
const TRANSITIONS: Record<StatusAction, { from: ClientStatus[]; to: ClientStatus }> = {
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  activate: { from: ['SUSPENDED', 'ARCHIVED'], to: 'ACTIVE' },
  archive: { from: ['ACTIVE', 'SUSPENDED'], to: 'ARCHIVED' },
};

const EDITABLE_FIELDS = [
  'name',
  'contactName',
  'email',
  'phone',
  'country',
  'currency',
  'timezone',
  'website',
  'businessIndustry',
  'internalNotes',
] as const;

function toAdminClient(client: Client): AdminClient {
  return {
    id: client.id,
    name: client.name,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone,
    country: client.country,
    currency: client.currency,
    timezone: client.timezone,
    website: client.website,
    businessIndustry: client.businessIndustry,
    status: client.status,
    internalNotes: client.internalNotes,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

// Client management for the administration (ADR 0016).
// Every change is written to the audit log in the SAME transaction.
// Clients are never deleted: there is no delete method, and the database
// refuses DELETE for the application user.
@Injectable()
export class ClientsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Inputs are "unknown": they come from HTTP requests, and are validated here.
  async list(query: unknown): Promise<ClientPage> {
    const parsed = ListClientsQuerySchema.safeParse(query);
    if (!parsed.success) throw new ClientValidationError(parsed.error);
    const { search, status, page, pageSize } = parsed.data;

    const where = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { contactName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.count({ where }),
    ]);
    return { items: rows.map(toAdminClient), total, page, pageSize };
  }

  async get(id: string): Promise<AdminClient> {
    return toAdminClient(await this.find(this.prisma, id));
  }

  async create(input: unknown, actor: Actor): Promise<AdminClient> {
    const parsed = CreateClientSchema.safeParse(input);
    if (!parsed.success) throw new ClientValidationError(parsed.error);

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.create({ data: parsed.data });
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.client.created',
          metadata: { clientId: client.id, name: client.name },
        }),
      });
      return toAdminClient(client);
    });
  }

  async update(id: string, input: unknown, actor: Actor): Promise<AdminClient> {
    const parsed = UpdateClientSchema.safeParse(input);
    if (!parsed.success) throw new ClientValidationError(parsed.error);
    const changes = parsed.data;

    return this.prisma.$transaction(async (tx) => {
      const current = await this.find(tx, id);
      if (current.status === 'ARCHIVED') throw new ClientArchivedError();

      const changed = EDITABLE_FIELDS.filter(
        (field) => changes[field] !== undefined && changes[field] !== current[field],
      );
      if (changed.length === 0) return toAdminClient(current);

      const client = await tx.client.update({ where: { id: current.id }, data: changes });
      // Only the NAMES of the changed fields: never their values
      // (the internal notes are secret, and the log is kept forever).
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.client.updated',
          metadata: { clientId: client.id, fields: changed.join(',') },
        }),
      });
      return toAdminClient(client);
    });
  }

  async changeStatus(id: string, action: StatusAction, actor: Actor): Promise<AdminClient> {
    const transition = TRANSITIONS[action];

    return this.prisma.$transaction(async (tx) => {
      const current = await this.find(tx, id);
      if (!transition.from.includes(current.status)) {
        throw new InvalidClientStatusChangeError(current.status, transition.to);
      }
      const client = await tx.client.update({
        where: { id: current.id },
        data: { status: transition.to },
      });
      // Suspended or archived: every open session of its accounts ends NOW
      // (and new logins are refused, ADR 0016).
      const sessionsClosed =
        transition.to === 'ACTIVE'
          ? 0
          : (
              await tx.session.updateMany({
                where: { revokedAt: null, user: { clientId: current.id } },
                data: { revokedAt: new Date() },
              })
            ).count;
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.client.status_changed',
          metadata: {
            clientId: client.id,
            from: current.status,
            to: transition.to,
            sessionsClosed,
          },
        }),
      });
      return toAdminClient(client);
    });
  }

  // An id that is not a UUID is simply "not found" (no database error).
  private async find(db: Pick<PrismaService, 'client'>, id: string): Promise<Client> {
    if (!ClientIdSchema.safeParse(id).success) throw new ClientNotFoundError();
    const client = await db.client.findUnique({ where: { id } });
    if (!client) throw new ClientNotFoundError();
    return client;
  }
}
