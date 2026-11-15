import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { actorOf, run } from '../clients/clients.http';
import { FeePlansService } from './fee-plans.service';

// Fee plans and monthly fees of a client (step 5.1). SUPER_ADMIN only.
// No update and no delete route: terms never change (ADR 0019).
@Controller('admin/clients/:clientId')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class FeePlansController {
  constructor(@Inject(FeePlansService) private readonly plans: FeePlansService) {}

  @Get('fee-plans')
  list(@Param('clientId') clientId: string) {
    return run(() => this.plans.list(clientId));
  }

  @Post('fee-plans')
  create(
    @Param('clientId') clientId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.plans.create(clientId, body, actorOf(req)));
  }

  @Post('fee-plans/:planId/cancel')
  @HttpCode(200)
  cancel(
    @Param('clientId') clientId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.plans.cancel(clientId, planId, actorOf(req)));
  }

  // ?from=YYYY-MM&to=YYYY-MM (default: the last 6 months)
  @Get('fees')
  fees(@Param('clientId') clientId: string, @Query() query: unknown) {
    return run(() => this.plans.fees(clientId, query));
  }
}
