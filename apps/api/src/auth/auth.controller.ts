import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuditContext } from '../audit/audit';
import { env } from '../config/env';
import { AccessTokenGuard } from './access-token.guard';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';
import {
  AccountLockedError,
  AccountSuspendedError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidSessionError,
  InvalidTwoFactorCodeError,
  TwoFactorSetupRequiredError,
} from './auth.errors';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { AuthService, type IssuedTokens } from './auth.service';
import type { AuthRequest, AuthResponse, AuthenticatedRequest, CookieOptions } from './auth.types';
import { readCookie } from './tokens';

const LoginSchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(128),
});

const TwoFactorSchema = z.object({
  challengeToken: z.string().min(1).max(2000),
  // 6-digit app code, or a recovery code (XXXXX-XXXXX)
  code: z.string().min(1).max(32),
});

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true, // JavaScript in the browser can never read it
    secure: env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict', // never sent from another website (CSRF protection)
    path: REFRESH_COOKIE_PATH,
    ...(expires ? { expires } : {}),
  };
}

// Where the request came from, for the sessions and the audit log (ADR 0014).
function requestContext(req: AuthRequest): AuditContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

// Converts expected auth failures into HTTP answers.
function toHttpError(error: unknown): Error {
  if (
    error instanceof InvalidCredentialsError ||
    error instanceof InvalidSessionError ||
    error instanceof InvalidLoginChallengeError ||
    error instanceof InvalidTwoFactorCodeError
  ) {
    return new UnauthorizedException(error.message);
  }
  if (error instanceof AccountLockedError) {
    return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (error instanceof AccountSuspendedError || error instanceof TwoFactorSetupRequiredError) {
    return new ForbiddenException(error.message);
  }
  return error instanceof Error ? error : new Error('Unexpected error');
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: AuthResponse,
  ) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Email and password are required');

    try {
      const result = await this.auth.login(
        parsed.data.email,
        parsed.data.password,
        requestContext(req),
      );
      if (result.status === 'two_factor_required') {
        // No session and no cookie yet: the second step is still needed.
        return {
          status: result.status,
          challengeToken: result.challengeToken,
          expiresIn: result.expiresIn,
        };
      }
      return this.respond(result.tokens, res);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  // Second login step (ADR 0013): authenticator code or recovery code.
  @Post('2fa/verify')
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  async verifyTwoFactor(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: AuthResponse,
  ) {
    const parsed = TwoFactorSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Login step and code are required');

    try {
      const tokens = await this.auth.verifyTwoFactor(
        parsed.data.challengeToken,
        parsed.data.code,
        requestContext(req),
      );
      return this.respond(tokens, res);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  async refresh(@Req() req: AuthRequest, @Res({ passthrough: true }) res: AuthResponse) {
    const token = readCookie(req.headers.cookie, REFRESH_COOKIE_NAME);
    if (!token) throw new UnauthorizedException('Session is invalid or expired');

    try {
      const tokens = await this.auth.refresh(token, requestContext(req));
      return this.respond(tokens, res);
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
      throw toHttpError(error);
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: AuthResponse) {
    await this.auth.logout(
      readCookie(req.headers.cookie, REFRESH_COOKIE_NAME),
      requestContext(req),
    );
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@Req() req: AuthenticatedRequest) {
    if (!req.auth) throw new UnauthorizedException();
    const { id, email, fullName, role } = req.auth;
    return { id, email, fullName, role };
  }

  // The refresh token goes ONLY into the httpOnly cookie, never into the JSON body.
  private respond(tokens: IssuedTokens, res: AuthResponse) {
    res.cookie(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      cookieOptions(tokens.refreshTokenExpiresAt),
    );
    return {
      status: 'authenticated' as const,
      accessToken: tokens.accessToken,
      expiresIn: tokens.accessTokenExpiresIn,
      user: tokens.user,
    };
  }
}
