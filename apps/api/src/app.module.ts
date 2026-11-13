import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

// Root module: every feature module of the API is registered here.
@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
