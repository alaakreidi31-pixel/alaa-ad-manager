import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { run } from '../clients/clients.http';
import { ReportsService } from './reports.service';

// Administration reports (phase 7): every client, filters in the query.
@Controller('admin/reports')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class AdminReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  // ?from&to&granularity=day|week|month&currency&clientId&platform
  @Get('performance')
  performance(@Query() query: unknown) {
    return run(() => this.reports.performance(query));
  }

  @Get('campaigns')
  campaigns(@Query() query: unknown) {
    return run(() => this.reports.campaigns(query));
  }

  // ?from=YYYY-MM&to=YYYY-MM (default: the last 13 months)
  @Get('finance')
  finance(@Query() query: unknown) {
    return run(() => this.reports.finance(query));
  }
}

// Client portal reports: its own campaigns only (client id from the session;
// a clientId in the query is ignored), archived campaigns hidden.
@Controller('client/reports')
@UseGuards(AccessTokenGuard, ClientUserGuard)
export class ClientReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get('performance')
  performance(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return run(() =>
      this.reports.performance(query, { portal: true, clientId: req.auth?.clientId ?? '' }),
    );
  }

  @Get('campaigns')
  campaigns(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return run(() =>
      this.reports.campaigns(query, { portal: true, clientId: req.auth?.clientId ?? '' }),
    );
  }
}
