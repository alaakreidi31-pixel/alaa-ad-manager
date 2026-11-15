import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { CampaignMetricsController } from './campaign-metrics.controller';
import { CampaignMetricsService } from './campaign-metrics.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController, CampaignMetricsController],
  providers: [CampaignsService, CampaignMetricsService, SuperAdminGuard],
})
export class CampaignsModule {}
