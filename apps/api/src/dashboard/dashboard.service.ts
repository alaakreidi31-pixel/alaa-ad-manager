import { Inject, Injectable } from '@nestjs/common';
import type { ClientStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// The administration home page (step 3.2). REAL numbers only (ADR 0017):
// everything is counted from the database at the moment of the request.
// Money, campaigns and invoices are added when their phases exist.
export interface AdminDashboard {
  clients: Record<ClientStatus, number> & { total: number };
  accounts: {
    total: number;
    active: number;
    suspended: number;
    // Accounts still on a temporary password (never signed in).
    pendingPasswordChange: number;
  };
  recentClients: { id: string; name: string; status: ClientStatus; createdAt: Date }[];
  generatedAt: Date;
}

const RECENT_CLIENTS = 5;

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async admin(): Promise<AdminDashboard> {
    const clientAccounts = { role: 'CLIENT_USER' as const };
    // One transaction: every number is read from the same moment.
    const [byStatus, accountsByStatus, pendingPasswordChange, recentClients] =
      await this.prisma.$transaction([
        this.prisma.client.groupBy({
          by: ['status'],
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.user.groupBy({
          by: ['status'],
          where: clientAccounts,
          _count: { _all: true },
          orderBy: { status: 'asc' },
        }),
        this.prisma.user.count({ where: { ...clientAccounts, mustChangePassword: true } }),
        this.prisma.client.findMany({
          select: { id: true, name: true, status: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: RECENT_CLIENTS,
        }),
      ]);

    const clients = { ACTIVE: 0, SUSPENDED: 0, ARCHIVED: 0, total: 0 };
    for (const row of byStatus) {
      const count = (row._count as { _all: number })._all;
      clients[row.status] = count;
      clients.total += count;
    }
    const accounts = { total: 0, active: 0, suspended: 0, pendingPasswordChange };
    for (const row of accountsByStatus) {
      const count = (row._count as { _all: number })._all;
      if (row.status === 'ACTIVE') accounts.active = count;
      else accounts.suspended = count;
      accounts.total += count;
    }

    return { clients, accounts, recentClients, generatedAt: new Date() };
  }
}
