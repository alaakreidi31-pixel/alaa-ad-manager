import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { actorOf, run } from '../clients/clients.http';
import { CampaignImportService } from './campaign-import.service';

// CSV import of daily numbers for a client's campaigns (step 4.3).
// Body: { platform: "META" | "GOOGLE", csv: "<file text>" }. SUPER_ADMIN only.
@Controller('admin/clients/:clientId/campaign-imports')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class CampaignImportController {
  constructor(@Inject(CampaignImportService) private readonly imports: CampaignImportService) {}

  // Checks the file and shows what would change. Writes NOTHING.
  @Post('preview')
  @HttpCode(200)
  preview(@Param('clientId') clientId: string, @Body() body: unknown) {
    return run(() => this.imports.preview(clientId, body));
  }

  // Saves every line in one transaction, or none (409 if a line has a problem).
  @Post('commit')
  @HttpCode(200)
  commit(
    @Param('clientId') clientId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.imports.commit(clientId, body, actorOf(req)));
  }
}
