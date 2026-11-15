import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { AdminReportsController, ClientReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminReportsController, ClientReportsController],
  providers: [ReportsService, SuperAdminGuard, ClientUserGuard],
})
export class ReportsModule {}
