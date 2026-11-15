import { Body, Controller, Get, Inject, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { actorOf, run } from '../clients/clients.http';
import { CampaignMetricsService } from './campaign-metrics.service';

// Daily numbers of a campaign (step 4.2). SUPER_ADMIN only.
@Controller('admin/clients/:clientId/campaigns/:campaignId/metrics')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class CampaignMetricsController {
  constructor(@Inject(CampaignMetricsService) private readonly metrics: CampaignMetricsService) {}

  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 30 days)
  @Get()
  report(
    @Param('clientId') clientId: string,
    @Param('campaignId') campaignId: string,
    @Query() query: unknown,
  ) {
    return run(() => this.metrics.report(clientId, campaignId, query));
  }

  // Enters or corrects one day: PUT, because saving it again gives the same row.
  @Put(':date')
  save(
    @Param('clientId') clientId: string,
    @Param('campaignId') campaignId: string,
    @Param('date') date: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.metrics.saveDay(clientId, campaignId, date, body, actorOf(req)));
  }
}
