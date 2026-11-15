import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { actorOf, run } from '../clients/clients.http';
import { CampaignsService, type CampaignAction } from './campaigns.service';

// Campaigns of a client: /api/admin/clients/:clientId/campaigns.
// SUPER_ADMIN only (ADR 0016, ADR 0018). No "ad" in the URLs (ADR 0006).
@Controller('admin/clients/:clientId/campaigns')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class CampaignsController {
  constructor(@Inject(CampaignsService) private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Param('clientId') clientId: string, @Query() query: unknown) {
    return run(() => this.campaigns.list(clientId, query));
  }

  @Post()
  create(
    @Param('clientId') clientId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.campaigns.create(clientId, body, actorOf(req)));
  }

  @Get(':campaignId')
  get(@Param('clientId') clientId: string, @Param('campaignId') campaignId: string) {
    return run(() => this.campaigns.get(clientId, campaignId));
  }

  @Patch(':campaignId')
  update(
    @Param('clientId') clientId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.campaigns.update(clientId, campaignId, body, actorOf(req)));
  }

  @Post(':campaignId/pause')
  @HttpCode(200)
  pause(
    @Param('clientId') clientId: string,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeStatus(clientId, campaignId, 'pause', req);
  }

  @Post(':campaignId/activate')
  @HttpCode(200)
  activate(
    @Param('clientId') clientId: string,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeStatus(clientId, campaignId, 'activate', req);
  }

  @Post(':campaignId/end')
  @HttpCode(200)
  end(
    @Param('clientId') clientId: string,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeStatus(clientId, campaignId, 'end', req);
  }

  @Post(':campaignId/archive')
  @HttpCode(200)
  archive(
    @Param('clientId') clientId: string,
    @Param('campaignId') campaignId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.changeStatus(clientId, campaignId, 'archive', req);
  }

  private changeStatus(
    clientId: string,
    campaignId: string,
    action: CampaignAction,
    req: AuthenticatedRequest,
  ) {
    return run(() => this.campaigns.changeStatus(clientId, campaignId, action, actorOf(req)));
  }
}
