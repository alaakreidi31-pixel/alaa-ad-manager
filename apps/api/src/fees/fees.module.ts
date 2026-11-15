import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { FeePlansController } from './fee-plans.controller';
import { FeePlansService } from './fee-plans.service';

@Module({
  imports: [AuthModule],
  controllers: [FeePlansController],
  providers: [FeePlansService, SuperAdminGuard],
})
export class FeesModule {}
