import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './auth.constants';
import type { AuthRequest } from './auth.types';
import { FixedWindowRateLimiter } from './rate-limiter';

// One shared limiter for the whole API process.
@Injectable()
export class AuthRateLimiter extends FixedWindowRateLimiter {
  constructor() {
    super(RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  }
}

interface ResponseWithHeaders {
  setHeader(name: string, value: string): void;
}

// Limits login and refresh requests per IP address (ADR 0012).
// NOTE for production: behind a reverse proxy, Express must be configured
// ("trust proxy") so that request.ip is the visitor's real address.
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: AuthRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthRequest>();
    const key = `${context.getHandler().name}:${request.ip ?? 'unknown'}`;

    const result = this.limiter.hit(key);
    if (!result.allowed) {
      http
        .getResponse<ResponseWithHeaders>()
        .setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        'Too many attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
