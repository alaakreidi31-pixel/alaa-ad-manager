import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { AllCampaignsController } from './all-campaigns.controller';
import { CampaignImportController } from './campaign-import.controller';
import { CampaignImportService } from './campaign-import.service';
import { CampaignMetricsController } from './campaign-metrics.controller';
import { CampaignMetricsService } from './campaign-metrics.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CampaignsController,
    CampaignMetricsController,
    AllCampaignsController,
    CampaignImportController,
  ],
  providers: [CampaignsService, CampaignMetricsService, CampaignImportService, SuperAdminGuard],
})
export class CampaignsModule {}
