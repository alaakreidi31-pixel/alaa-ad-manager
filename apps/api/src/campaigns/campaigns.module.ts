import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, SuperAdminGuard],
})
export class CampaignsModule {}
