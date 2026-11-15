import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { DashboardService } from './dashboard.service';

// GET /api/admin/dashboard: summary for the administration home page.
// SUPER_ADMIN only, like every /api/admin route (ADR 0016).
@Controller('admin/dashboard')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  summary() {
    return this.dashboard.admin();
  }
}
