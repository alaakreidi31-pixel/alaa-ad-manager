import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InvalidSessionError } from './auth.errors';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { readBearerToken } from './tokens';

// Protects a route: requires a valid access token for an active session.
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Missing access token');

    try {
      request.auth = await this.auth.validateAccessToken(token);
      return true;
    } catch (error) {
      if (error instanceof InvalidSessionError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }
}
