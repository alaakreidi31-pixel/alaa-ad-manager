import {
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
import { actorOf, run } from '../clients/clients.http';
import { NotificationsService } from './notifications.service';

// /api/notifications: for every signed-in account (administration and
// clients), each on its OWN notifications.
@Controller('notifications')
@UseGuards(AccessTokenGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  // ?unread=1&page&pageSize
  @Get()
  list(@Query() query: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.notifications.list(query, actorOf(req)));
  }

  @Get('unread-count')
  unread(@Req() req: AuthenticatedRequest) {
    return run(() => this.notifications.unreadCount(actorOf(req)));
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Req() req: AuthenticatedRequest) {
    return run(() => this.notifications.markAllRead(actorOf(req)));
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return run(() => this.notifications.markRead(actorOf(req), id));
  }
}
