import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
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
import { SuperAdminGuard } from '../auth/super-admin.guard';
import {
  ClientArchivedError,
  ClientNotFoundError,
  ClientValidationError,
  InvalidClientStatusChangeError,
} from './clients.errors';
import { ClientsService, type Actor, type StatusAction } from './clients.service';

// Turns expected failures into HTTP answers with a stable "code" for the web app.
function toHttpError(error: unknown): Error {
  if (error instanceof ClientValidationError) {
    return new HttpException(
      { statusCode: 400, message: error.message, code: 'invalid_input', fields: error.fields },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (error instanceof ClientNotFoundError) {
    return new HttpException(
      { statusCode: 404, message: error.message, code: 'client_not_found' },
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof ClientArchivedError) {
    return new HttpException(
      { statusCode: 409, message: error.message, code: 'client_archived' },
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof InvalidClientStatusChangeError) {
    return new HttpException(
      { statusCode: 409, message: error.message, code: 'invalid_status_change' },
      HttpStatus.CONFLICT,
    );
  }
  return error instanceof Error ? error : new Error('Unexpected error');
}

function actorOf(req: AuthenticatedRequest): Actor {
  // AccessTokenGuard always sets req.auth before this runs.
  return { userId: req.auth?.id ?? '', ip: req.ip, userAgent: req.headers['user-agent'] };
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toHttpError(error);
  }
}

// Client management: /api/admin/clients. SUPER_ADMIN only (ADR 0016).
// The guards run on EVERY route of this controller, in this order:
// 1) a valid access token for an active session, 2) the SUPER_ADMIN role.
@Controller('admin/clients')
@UseGuards(AccessTokenGuard, SuperAdminGuard)
export class ClientsController {
  constructor(@Inject(ClientsService) private readonly clients: ClientsService) {}

  @Get()
  list(@Query() query: unknown) {
    return run(() => this.clients.list(query));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return run(() => this.clients.get(id));
  }

  @Post()
  create(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.clients.create(body, actorOf(req)));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return run(() => this.clients.update(id, body, actorOf(req)));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.changeStatus(id, 'suspend', req);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.changeStatus(id, 'activate', req);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.changeStatus(id, 'archive', req);
  }

  private changeStatus(id: string, action: StatusAction, req: AuthenticatedRequest) {
    return run(() => this.clients.changeStatus(id, action, actorOf(req)));
  }
}
