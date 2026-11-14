import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { env } from '../config/env';
import { AccessTokenGuard } from './access-token.guard';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.constants';
import { AccountSuspendedError, InvalidCredentialsError, InvalidSessionError } from './auth.errors';
import { AuthService, type IssuedTokens } from './auth.service';
import type { AuthRequest, AuthResponse, AuthenticatedRequest, CookieOptions } from './auth.types';
import { readCookie } from './tokens';

const LoginSchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(128),
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

// Converts expected auth failures into HTTP answers.
function toHttpError(error: unknown): Error {
  if (error instanceof InvalidCredentialsError || error instanceof InvalidSessionError) {
    return new UnauthorizedException(error.message);
  }
  if (error instanceof AccountSuspendedError) {
    return new ForbiddenException(error.message);
  }
  return error instanceof Error ? error : new Error('Unexpected error');
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: AuthResponse,
  ) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Email and password are required');

    try {
      const tokens = await this.auth.login(
        parsed.data.email,
        parsed.data.password,
        req.headers['user-agent'],
      );
      return this.respond(tokens, res);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: AuthRequest, @Res({ passthrough: true }) res: AuthResponse) {
    const token = readCookie(req.headers.cookie, REFRESH_COOKIE_NAME);
    if (!token) throw new UnauthorizedException('Session is invalid or expired');

    try {
      const tokens = await this.auth.refresh(token, req.headers['user-agent']);
      return this.respond(tokens, res);
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
      throw toHttpError(error);
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: AuthResponse) {
    await this.auth.logout(readCookie(req.headers.cookie, REFRESH_COOKIE_NAME));
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
      accessToken: tokens.accessToken,
      expiresIn: tokens.accessTokenExpiresIn,
      user: tokens.user,
    };
  }
}
