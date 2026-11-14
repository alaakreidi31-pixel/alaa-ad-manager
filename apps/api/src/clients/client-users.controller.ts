import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { ClientUsersService } from './client-users.service';
import { actorOf, run } from './clients.http';

// Login accounts of a client: /api/admin/clients/:clientId/users.
// SUPER_ADMIN only (ADR 0016). The temporary password is returned ONCE in the
// answer to "create" and "reset-password", and stored nowhere in plain text.
@Controller('admin/clients/:clientId/users')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class ClientUsersController {
  constructor(@Inject(ClientUsersService) private readonly users: ClientUsersService) {}

  @Get()
  list(@Param('clientId') clientId: string) {
    return run(() => this.users.list(clientId));
  }

  @Post()
  create(
    @Param('clientId') clientId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.users.create(clientId, body, actorOf(req)));
  }

  @Post(':userId/reset-password')
  @HttpCode(200)
  resetPassword(
    @Param('clientId') clientId: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.users.resetPassword(clientId, userId, actorOf(req)));
  }

  @Post(':userId/suspend')
  @HttpCode(200)
  suspend(
    @Param('clientId') clientId: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.users.changeStatus(clientId, userId, 'SUSPENDED', actorOf(req)));
  }

  @Post(':userId/activate')
  @HttpCode(200)
  activate(
    @Param('clientId') clientId: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.users.changeStatus(clientId, userId, 'ACTIVE', actorOf(req)));
  }
}
