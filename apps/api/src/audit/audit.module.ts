import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// @Global: every module can record audit events without importing this module.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
