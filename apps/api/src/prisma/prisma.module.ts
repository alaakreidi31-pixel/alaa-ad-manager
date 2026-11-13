import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global: every module can use PrismaService without importing this module.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
