import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

// Root module: every feature module of the API is registered here.
@Module({
  imports: [PrismaModule, AuditModule, HealthModule, AuthModule, ClientsModule],
})
export class AppModule {}
