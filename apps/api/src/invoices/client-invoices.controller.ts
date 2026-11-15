import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClientUserGuard } from '../auth/client-user.guard';
import { run } from '../clients/clients.http';
import { InvoicesService } from './invoices.service';

// The client portal invoices (step 6.3): /api/client/invoices. CLIENT_USER
// only, read only. NO route takes a client id: it comes from the session.
@Controller('client/invoices')
@UseGuards(AccessTokenGuard, ClientUserGuard)
export class ClientInvoicesController {
  constructor(@Inject(InvoicesService) private readonly invoices: InvoicesService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return run(() => this.invoices.listForClient(req.auth?.clientId ?? ''));
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return run(() => this.invoices.getForClient(req.auth?.clientId ?? '', id));
  }
}
