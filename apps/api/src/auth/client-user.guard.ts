import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types';

// Client portal routes (/api/client/...): CLIENT_USER accounts only (ADR 0016).
// Always used AFTER AccessTokenGuard:
//   @UseGuards(AccessTokenGuard, ClientUserGuard)
// The client id is ALWAYS taken from the session (req.auth.clientId), never
// from the URL or the body: a client cannot even ask for another client.
@Injectable()
export class ClientUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth?.role !== 'CLIENT_USER' || !request.auth.clientId) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Client accounts only',
        code: 'forbidden',
      });
    }
    return true;
  }
}
