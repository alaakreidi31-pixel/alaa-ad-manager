import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClientUserGuard } from '../auth/client-user.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { actorOf, run } from '../clients/clients.http';
import { TasksService } from './tasks.service';

// Tasks (step 8.2, ADR 0022). SUPER_ADMIN only. No route deletes: a task is
// cancelled, a rule is paused or ended, a comment never changes.
@Controller('admin')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  // Also creates the due recurring and system tasks (idempotent).
  @Get('tasks')
  list(@Query() query: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.tasks.list(query, actorOf(req)));
  }

  @Post('tasks')
  create(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.tasks.create(body, actorOf(req)));
  }

  @Get('tasks/:id')
  get(@Param('id') id: string) {
    return run(() => this.tasks.get(id));
  }

  @Patch('tasks/:id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.tasks.update(id, body, actorOf(req)));
  }

  @Post('tasks/:id/comments')
  comment(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.tasks.addComment(id, body, actorOf(req)));
  }

  @Get('task-recurrences')
  listRecurrences() {
    return run(() => this.tasks.listRecurrences());
  }

  @Post('task-recurrences')
  createRecurrence(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.tasks.createRecurrence(body, actorOf(req)));
  }

  @Patch('task-recurrences/:id')
  updateRecurrence(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return run(() => this.tasks.updateRecurrence(id, body, actorOf(req)));
  }
}

// Client portal: only the tasks shared with the client of the session.
// Comments, authors and internal origins are never sent.
@Controller('client/tasks')
@UseGuards(AccessTokenGuard, ClientUserGuard)
export class ClientTasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return run(() => this.tasks.listForClient(req.auth?.clientId ?? ''));
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return run(() => this.tasks.getForClient(req.auth?.clientId ?? '', id));
  }
}
