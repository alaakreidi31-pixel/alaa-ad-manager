import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types';

// Administration routes: SUPER_ADMIN only (ADR 0016).
// Always used AFTER AccessTokenGuard, which identifies the user:
//   @UseGuards(AccessTokenGuard, SuperAdminGuard)
// A CLIENT_USER gets 403 and never reaches the route.
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Administrator access only',
        code: 'forbidden',
      });
    }
    return true;
  }
}
