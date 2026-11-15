import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClientUserGuard } from '../auth/client-user.guard';
import { run } from '../clients/clients.http';
import { ClientCampaignsService } from './client-campaigns.service';

// The client portal campaigns (step 4.5): /api/client/... CLIENT_USER only.
// Read only. NO route takes a client id: it always comes from the session.
@Controller('client')
@UseGuards(AccessTokenGuard, ClientUserGuard)
export class ClientCampaignsController {
  constructor(@Inject(ClientCampaignsService) private readonly campaigns: ClientCampaignsService) {}

  @Get('campaigns')
  list(@Req() req: AuthenticatedRequest) {
    return run(() => this.campaigns.list(req.auth?.clientId ?? ''));
  }

  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 30 days)
  @Get('campaign-summary')
  summary(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return run(() => this.campaigns.summary(req.auth?.clientId ?? '', query));
  }

  @Get('campaigns/:campaignId/metrics')
  metrics(
    @Req() req: AuthenticatedRequest,
    @Param('campaignId') campaignId: string,
    @Query() query: unknown,
  ) {
    return run(() => this.campaigns.campaignMetrics(req.auth?.clientId ?? '', campaignId, query));
  }
}
