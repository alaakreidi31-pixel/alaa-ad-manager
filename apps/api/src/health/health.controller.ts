import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  database: 'up' | 'down';
  timestamp: string;
  uptimeSeconds: number;
}

// Handles GET /api/health  (the "api" prefix is added in main.ts)
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const database = await this.checkDatabase();
    const body: HealthResponse = {
      status: database === 'up' ? 'ok' : 'error',
      service: 'alaa-ad-manager-api',
      database,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };

    // 503 = "Service Unavailable": the standard answer when a dependency is down.
    if (database === 'down') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Database check failed: ${reason}`);
      return 'down';
    }
  }
}
