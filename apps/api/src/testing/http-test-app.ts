// A real NestJS HTTP server for the HTTP tests, with the PRODUCTION
// controllers and guards, connected to the test database (as alaa_app).
//
// The test file must replace PrismaService first (it reads .env at import):
//   vi.mock('../prisma/prisma.service', () => ({ PrismaService: class PrismaServiceToken {} }));
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AuthService } from '../auth/auth.service';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SecretBox } from '../auth/secret-box';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { AllCampaignsController } from '../campaigns/all-campaigns.controller';
import { CampaignImportController } from '../campaigns/campaign-import.controller';
import { CampaignImportService } from '../campaigns/campaign-import.service';
import { CampaignMetricsController } from '../campaigns/campaign-metrics.controller';
import { CampaignMetricsService } from '../campaigns/campaign-metrics.service';
import { ClientCampaignsController } from '../campaigns/client-campaigns.controller';
import { ClientCampaignsService } from '../campaigns/client-campaigns.service';
import { CampaignsController } from '../campaigns/campaigns.controller';
import { CampaignsService } from '../campaigns/campaigns.service';
import { ClientPortalController } from '../clients/client-portal.controller';
import { ClientPortalService } from '../clients/client-portal.service';
import { ClientUsersController } from '../clients/client-users.controller';
import { ClientUsersService } from '../clients/client-users.service';
import { ClientsController } from '../clients/clients.controller';
import { ClientsService } from '../clients/clients.service';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DashboardService } from '../dashboard/dashboard.service';
import { FeePlansController } from '../fees/fee-plans.controller';
import { FeePlansService } from '../fees/fee-plans.service';
import { InvoicesController } from '../invoices/invoices.controller';
import { InvoicesService } from '../invoices/invoices.service';
import type { PrismaClient } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface HttpTestApp {
  app: INestApplication;
  baseUrl: string;
  jwt: JwtService;
  auth: AuthService;
  close: () => Promise<void>;
}

export async function startHttpTestApp(prisma: PrismaClient): Promise<HttpTestApp> {
  const db = prisma as unknown as PrismaService;
  const jwt = new JwtService({
    secret: 'test-only-secret-at-least-32-characters-long',
    signOptions: { algorithm: 'HS256' },
    verifyOptions: { algorithms: ['HS256'] },
  });
  const box = new SecretBox(randomBytes(32).toString('base64'));
  const audit = new AuditService(db);
  const auth = new AuthService(db, jwt, box, audit);

  class HttpTestModule {}
  Module({
    controllers: [
      ClientsController,
      ClientUsersController,
      ClientPortalController,
      CampaignsController,
      CampaignMetricsController,
      AllCampaignsController,
      CampaignImportController,
      ClientCampaignsController,
      DashboardController,
      FeePlansController,
      InvoicesController,
    ],
    providers: [
      { provide: PrismaService, useValue: db },
      { provide: AuditService, useValue: audit },
      { provide: AuthService, useValue: auth },
      { provide: ClientsService, useValue: new ClientsService(db) },
      { provide: ClientUsersService, useValue: new ClientUsersService(db) },
      { provide: ClientPortalService, useValue: new ClientPortalService(db) },
      { provide: CampaignsService, useValue: new CampaignsService(db) },
      { provide: CampaignMetricsService, useValue: new CampaignMetricsService(db) },
      { provide: CampaignImportService, useValue: new CampaignImportService(db) },
      {
        provide: ClientCampaignsService,
        useValue: new ClientCampaignsService(db, new CampaignMetricsService(db)),
      },
      { provide: DashboardService, useValue: new DashboardService(db) },
      { provide: FeePlansService, useValue: new FeePlansService(db) },
      { provide: InvoicesService, useValue: new InvoicesService(db) },
      AccessTokenGuard,
      SuperAdminGuard,
      ClientUserGuard,
    ],
  })(HttpTestModule);

  const app = await NestFactory.create(HttpTestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, baseUrl, jwt, auth, close: () => app.close() };
}

// A user with an open session, and a signed access token for it.
export async function createSessionToken(
  prisma: PrismaClient,
  jwt: JwtService,
  role: 'SUPER_ADMIN' | 'CLIENT_USER',
  clientId: string | null = null,
): Promise<{ token: string; userId: string }> {
  const kind = role === 'SUPER_ADMIN' ? 'admin' : 'client';
  const user = await prisma.user.create({
    data: {
      email: `http-${kind}-${randomUUID().slice(0, 8)}@alaa.test`,
      fullName: 'HTTP Test',
      passwordHash: 'not-a-real-hash',
      role,
      clientId,
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const token = await jwt.signAsync({ sub: user.id, sid: session.id, role }, { expiresIn: 900 });
  return { token, userId: user.id };
}

export async function httpCall(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, body: (json ?? {}) as Record<string, unknown> };
}
