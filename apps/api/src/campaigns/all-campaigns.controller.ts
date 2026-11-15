import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { run } from '../clients/clients.http';
import { CampaignsService } from './campaigns.service';

// GET /api/admin/campaigns: every campaign of every client (step 4.4, the
// "Campaigns" page). Read only: changes go through the client's own routes.
@Controller('admin/campaigns')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class AllCampaignsController {
  constructor(@Inject(CampaignsService) private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Query() query: unknown) {
    return run(() => this.campaigns.listAll(query));
  }
}
