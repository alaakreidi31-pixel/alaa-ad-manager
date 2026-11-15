import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { AllCampaignsController } from './all-campaigns.controller';
import { CampaignImportController } from './campaign-import.controller';
import { CampaignImportService } from './campaign-import.service';
import { CampaignMetricsController } from './campaign-metrics.controller';
import { CampaignMetricsService } from './campaign-metrics.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { ClientCampaignsController } from './client-campaigns.controller';
import { ClientCampaignsService } from './client-campaigns.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CampaignsController,
    CampaignMetricsController,
    AllCampaignsController,
    CampaignImportController,
    // Client portal (step 4.5)
    ClientCampaignsController,
  ],
  providers: [
    CampaignsService,
    CampaignMetricsService,
    CampaignImportService,
    ClientCampaignsService,
    SuperAdminGuard,
    ClientUserGuard,
  ],
})
export class CampaignsModule {}
