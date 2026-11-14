import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AccessTokenGuard } from './access-token.guard';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRateLimiter, LoginRateLimitGuard } from './login-rate-limit.guard';
import { SecretBox } from './secret-box';

@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      // Only HS256 is accepted (blocks "alg: none" and algorithm confusion)
      verifyOptions: { algorithms: ['HS256'] },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    AuthRateLimiter,
    LoginRateLimitGuard,
    // Encrypts the 2FA secrets with the key from .env (ADR 0013)
    { provide: SecretBox, useFactory: () => new SecretBox(env.TOTP_ENCRYPTION_KEY) },
  ],
  exports: [AuthService, AccessTokenGuard],
})
export class AuthModule {}
