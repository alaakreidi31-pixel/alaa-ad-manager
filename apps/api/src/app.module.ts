import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ClientsModule } from './clients/clients.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FeesModule } from './fees/fees.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

// Root module: every feature module of the API is registered here.
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    ClientsModule,
    CampaignsModule,
    DashboardModule,
    FeesModule,
  ],
})
export class AppModule {}
