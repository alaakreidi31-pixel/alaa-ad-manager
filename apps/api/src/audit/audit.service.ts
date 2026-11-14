import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { writeAuditLog, type AuditEvent } from './audit';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // A failure to write the log never breaks the user's request: it is reported
  // in the server output instead (without the event details).
  async record(event: AuditEvent): Promise<void> {
    try {
      await writeAuditLog(this.prisma, event);
    } catch {
      this.logger.error(`Could not write audit event "${event.action}"`);
    }
  }
}
