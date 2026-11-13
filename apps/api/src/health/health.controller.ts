import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
}

// Handles GET /api/health  (the "api" prefix is added in main.ts)
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'alaa-ad-manager-api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
