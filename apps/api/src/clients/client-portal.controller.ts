import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClientUserGuard } from '../auth/client-user.guard';
import { ClientPortalService } from './client-portal.service';
import { run } from './clients.http';

// The client portal: /api/client/... (ADR 0016). CLIENT_USER accounts only.
// NO route here takes a client id: it always comes from the session.
@Controller('client')
@UseGuards(AccessTokenGuard, ClientUserGuard)
export class ClientPortalController {
  constructor(@Inject(ClientPortalService) private readonly portal: ClientPortalService) {}

  // The client's own company profile, without the internal notes.
  @Get('profile')
  profile(@Req() req: AuthenticatedRequest) {
    // ClientUserGuard guarantees a clientId here.
    return run(() => this.portal.profile(req.auth?.clientId ?? ''));
  }
}
