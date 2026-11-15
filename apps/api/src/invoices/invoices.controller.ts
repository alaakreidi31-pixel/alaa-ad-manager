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
import { InvoicesService } from './invoices.service';

// Invoices and payments (step 6.1, ADR 0020). SUPER_ADMIN only.
// No route edits or deletes an invoice or a payment: void with a reason.
@Controller('admin')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class InvoicesController {
  constructor(@Inject(InvoicesService) private readonly invoices: InvoicesService) {}

  @Get('invoices')
  list(@Query() query: unknown) {
    return run(() => this.invoices.list(query));
  }

  // Creates the missing drafts and refreshes the existing drafts' spend.
  @Post('invoices/prepare')
  @HttpCode(200)
  prepare(@Req() req: AuthenticatedRequest) {
    return run(() => this.invoices.prepareDrafts(actorOf(req)));
  }

  @Get('invoices/:id')
  get(@Param('id') id: string) {
    return run(() => this.invoices.get(id));
  }

  @Post('invoices/:id/issue')
  @HttpCode(200)
  issue(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.invoices.issue(id, body, actorOf(req)));
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  void(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.invoices.void(id, body, actorOf(req)));
  }

  @Post('invoices/:id/payments')
  recordPayment(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.invoices.recordPayment(id, body, actorOf(req)));
  }

  @Post('payments/:paymentId/void')
  @HttpCode(200)
  voidPayment(
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.invoices.voidPayment(paymentId, body, actorOf(req)));
  }
}
