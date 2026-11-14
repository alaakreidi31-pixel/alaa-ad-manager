import { Inject, Injectable } from '@nestjs/common';
import { auditRow } from '../audit/audit';
import { hashPassword } from '../auth/password';
import { generateTemporaryPassword } from '../auth/temporary-password';
import type { UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClientArchivedError,
  ClientNotFoundError,
  ClientUserNotFoundError,
  ClientValidationError,
  EmailTakenError,
  InvalidUserStatusChangeError,
} from './clients.errors';
import { ClientIdSchema, CreateClientUserSchema } from './clients.schemas';
import type { Actor } from './clients.service';

// What the administration sees of a client login account. Never the hash.
export interface ClientUserView {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

// Returned ONCE, when the password is created or reset. Never stored, never logged.
export interface WithTemporaryPassword {
  user: ClientUserView;
  temporaryPassword: string;
}

const VIEW_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  mustChangePassword: true,
  totpEnabledAt: true,
  createdAt: true,
} as const;

function toView(user: {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  mustChangePassword: boolean;
  totpEnabledAt: Date | null;
  createdAt: Date;
}): ClientUserView {
  const { totpEnabledAt, ...rest } = user;
  return { ...rest, twoFactorEnabled: totpEnabledAt !== null };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

type Db = Pick<PrismaService, 'client' | 'user'>;

// Login accounts of a client, managed by the administration (ADR 0016).
// Every query is scoped by BOTH the client id and the user id: a user id of
// another client is "not found" (protection against IDOR).
@Injectable()
export class ClientUsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(clientId: string): Promise<ClientUserView[]> {
    await this.findClient(this.prisma, clientId);
    const users = await this.prisma.user.findMany({
      where: { clientId, role: 'CLIENT_USER' },
      select: VIEW_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
    return users.map(toView);
  }

  async create(clientId: string, input: unknown, actor: Actor): Promise<WithTemporaryPassword> {
    const parsed = CreateClientUserSchema.safeParse(input);
    if (!parsed.success) throw new ClientValidationError(parsed.error);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const client = await this.findClient(tx, clientId);
        if (client.status === 'ARCHIVED') throw new ClientArchivedError();

        const user = await tx.user.create({
          data: {
            ...parsed.data,
            passwordHash,
            role: 'CLIENT_USER',
            clientId: client.id,
            mustChangePassword: true,
          },
          select: VIEW_FIELDS,
        });
        await tx.auditLog.create({
          data: auditRow({
            ...actor,
            action: 'admin.client_user.created',
            metadata: { clientId: client.id, targetUserId: user.id, email: user.email },
          }),
        });
        return { user: toView(user), temporaryPassword };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenError();
      throw error;
    }
  }

  // New temporary password: the old one stops working, every session ends,
  // a lock is lifted, and the user must choose a new password at next login.
  async resetPassword(
    clientId: string,
    userId: string,
    actor: Actor,
  ): Promise<WithTemporaryPassword> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    return this.prisma.$transaction(async (tx) => {
      const client = await this.findClient(tx, clientId);
      if (client.status === 'ARCHIVED') throw new ClientArchivedError();
      await this.findUser(tx, clientId, userId);

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        select: VIEW_FIELDS,
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.client_user.password_reset',
          metadata: { clientId, targetUserId: userId },
        }),
      });
      return { user: toView(user), temporaryPassword };
    });
  }

  // Suspends or reactivates ONE account (the client itself is not changed).
  async changeStatus(
    clientId: string,
    userId: string,
    to: UserStatus,
    actor: Actor,
  ): Promise<ClientUserView> {
    return this.prisma.$transaction(async (tx) => {
      const client = await this.findClient(tx, clientId);
      if (client.status === 'ARCHIVED') throw new ClientArchivedError();
      const current = await this.findUser(tx, clientId, userId);
      if (current.status === to) throw new InvalidUserStatusChangeError(current.status, to);

      const user = await tx.user.update({
        where: { id: userId },
        data: { status: to },
        select: VIEW_FIELDS,
      });
      if (to === 'SUSPENDED') {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: auditRow({
          ...actor,
          action: 'admin.client_user.status_changed',
          metadata: { clientId, targetUserId: userId, from: current.status, to },
        }),
      });
      return toView(user);
    });
  }

  private async findClient(db: Db, clientId: string) {
    if (!ClientIdSchema.safeParse(clientId).success) throw new ClientNotFoundError();
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true, status: true },
    });
    if (!client) throw new ClientNotFoundError();
    return client;
  }

  // Scoped by client: the user must belong to THIS client.
  private async findUser(db: Db, clientId: string, userId: string) {
    if (!ClientIdSchema.safeParse(userId).success) throw new ClientUserNotFoundError();
    const user = await db.user.findFirst({
      where: { id: userId, clientId, role: 'CLIENT_USER' },
      select: { id: true, status: true },
    });
    if (!user) throw new ClientUserNotFoundError();
    return user;
  }
}
