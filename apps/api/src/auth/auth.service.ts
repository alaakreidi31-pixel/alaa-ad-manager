import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { AuditContext } from '../audit/audit';
import { AuditService } from '../audit/audit.service';
import type { UserRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../users/email';
import { hashPassword, verifyPassword } from './password';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  LOGIN_CHALLENGE_TTL_SECONDS,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants';
import {
  AccountLockedError,
  AccountSuspendedError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidSessionError,
  InvalidTwoFactorCodeError,
  RefreshTokenReuseError,
  TwoFactorSetupRequiredError,
} from './auth.errors';
import { hashRecoveryCode, isRecoveryCodeFormat, normalizeRecoveryCode } from './recovery-codes';
import { SecretBox } from './secret-box';
import { generateRefreshToken, hashRefreshToken } from './tokens';
import { findTotpTimeStep } from './totp';

export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // session id
  role: UserRole;
}

// Short-lived token proving the password step succeeded (ADR 0013).
// It has no "sid", so it can never be used as an access token.
const LOGIN_CHALLENGE_PURPOSE = 'two_factor_login';
interface LoginChallengePayload {
  sub: string;
  purpose: typeof LOGIN_CHALLENGE_PURPOSE;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthUser;
}

export type LoginResult =
  | { status: 'authenticated'; tokens: IssuedTokens }
  | { status: 'two_factor_required'; challengeToken: string; expiresIn: number };

const AUTH_USER_FIELDS = { id: true, email: true, fullName: true, role: true } as const;

@Injectable()
export class AuthService {
  // Used when the email does not exist, so the response takes about the same
  // time as a wrong password (prevents discovering emails by timing).
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly secretBox: SecretBox,
    private readonly audit: AuditService,
  ) {}

  // Step 1: email and password. Returns the tokens directly, or asks for the
  // second step when the account uses two-factor authentication.
  // Every outcome is written to the audit log (ADR 0014).
  async login(email: string, password: string, ctx: AuditContext = {}): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
      await verifyPassword(await this.dummyHash, password);
      await this.audit.record({
        ...ctx,
        action: 'auth.login.failed',
        metadata: { reason: 'unknown_email', email: normalizedEmail.slice(0, 320) },
      });
      throw new InvalidCredentialsError();
    }
    const fail = (reason: string) =>
      this.audit.record({
        ...ctx,
        action: 'auth.login.failed',
        userId: user.id,
        metadata: { reason },
      });

    // While locked, the password is not checked at all (ADR 0012).
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await fail('account_locked');
      throw new AccountLockedError();
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      await fail('wrong_password');
      if (await this.recordFailedLogin(user.id, ctx)) throw new AccountLockedError();
      throw new InvalidCredentialsError();
    }
    if (user.status !== 'ACTIVE') {
      await fail('account_suspended');
      throw new AccountSuspendedError();
    }

    // With 2FA, the failure counter is NOT reset here: otherwise someone who
    // knows the password could guess codes forever (4 wrong codes, correct
    // password, 4 wrong codes...). It is reset only after the second step.
    if (user.totpEnabledAt) {
      const payload: LoginChallengePayload = { sub: user.id, purpose: LOGIN_CHALLENGE_PURPOSE };
      const challengeToken = await this.jwt.signAsync(payload, {
        expiresIn: LOGIN_CHALLENGE_TTL_SECONDS,
      });
      await this.audit.record({ ...ctx, action: 'auth.login.password_verified', userId: user.id });
      return {
        status: 'two_factor_required',
        challengeToken,
        expiresIn: LOGIN_CHALLENGE_TTL_SECONDS,
      };
    }
    if (user.role === 'SUPER_ADMIN') {
      await fail('two_factor_setup_required');
      throw new TwoFactorSetupRequiredError();
    }

    await this.resetFailedLogins(user);
    const tokens = await this.startSession(user, ctx);
    await this.audit.record({
      ...ctx,
      action: 'auth.login.succeeded',
      userId: user.id,
      metadata: { method: 'password' },
    });
    return { status: 'authenticated', tokens };
  }

  // Step 2: a code from the authenticator app, or a one-time recovery code.
  async verifyTwoFactor(
    challengeToken: string,
    code: string,
    ctx: AuditContext = {},
  ): Promise<IssuedTokens> {
    let payload: LoginChallengePayload | undefined;
    try {
      payload = await this.jwt.verifyAsync<LoginChallengePayload>(challengeToken);
    } catch {
      payload = undefined;
    }
    if (payload?.purpose !== LOGIN_CHALLENGE_PURPOSE || typeof payload.sub !== 'string') {
      await this.audit.record({
        ...ctx,
        action: 'auth.two_factor.failed',
        metadata: { reason: 'invalid_challenge' },
      });
      throw new InvalidLoginChallengeError();
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.totpSecretEncrypted) throw new InvalidLoginChallengeError();
    const fail = (reason: string) =>
      this.audit.record({
        ...ctx,
        action: 'auth.two_factor.failed',
        userId: user.id,
        metadata: { reason },
      });

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await fail('account_locked');
      throw new AccountLockedError();
    }
    if (user.status !== 'ACTIVE') {
      await fail('account_suspended');
      throw new AccountSuspendedError();
    }

    const method = await this.consumeSecondFactor(user.id, user.totpSecretEncrypted, code);
    if (!method) {
      // Wrong codes count toward the same lock as wrong passwords.
      await fail('invalid_code');
      if (await this.recordFailedLogin(user.id, ctx)) throw new AccountLockedError();
      throw new InvalidTwoFactorCodeError();
    }

    await this.resetFailedLogins(user);
    const tokens = await this.startSession(user, ctx);
    await this.audit.record({
      ...ctx,
      action: 'auth.login.succeeded',
      userId: user.id,
      metadata: { method },
    });
    return tokens;
  }

  // Accepts each code only once. Both updates are conditional, so two
  // parallel requests with the same code cannot both succeed.
  private async consumeSecondFactor(
    userId: string,
    secretEncrypted: string,
    input: string,
  ): Promise<'totp' | 'recovery_code' | null> {
    const code = normalizeRecoveryCode(input);

    if (/^\d{6}$/.test(code)) {
      const step = findTotpTimeStep(this.secretBox.decrypt(secretEncrypted), code);
      if (step === null) return null;
      const used = await this.prisma.user.updateMany({
        where: {
          id: userId,
          OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
        },
        data: { totpLastUsedStep: step },
      });
      return used.count === 1 ? 'totp' : null;
    }

    if (isRecoveryCodeFormat(code)) {
      const used = await this.prisma.recoveryCode.updateMany({
        where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
        data: { usedAt: new Date() },
      });
      return used.count === 1 ? 'recovery_code' : null;
    }
    return null;
  }

  private async resetFailedLogins(user: {
    id: string;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  }): Promise<void> {
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }
  }

  // Counts a wrong password. The increment is atomic in PostgreSQL, so
  // parallel attempts are all counted. On the last allowed attempt, locks the
  // account and restarts the counter. Returns true when this attempt locked it.
  private async recordFailedLogin(userId: string, ctx: AuditContext): Promise<boolean> {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts < MAX_FAILED_LOGIN_ATTEMPTS) return false;

    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
    });
    await this.audit.record({
      ...ctx,
      action: 'auth.account.locked',
      userId,
      metadata: { minutes: LOCKOUT_DURATION_MS / 60_000 },
    });
    return true;
  }

  // Rotation: every refresh token works once. Using an old one again means it
  // may have been stolen, so every session of that user is closed.
  async refresh(refreshToken: string, ctx: AuditContext = {}): Promise<IssuedTokens> {
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });

    if (!session) throw new InvalidSessionError();
    if (session.revokedAt) {
      await this.revokeAllSessions(session.userId);
      await this.recordReuse(session.userId, ctx);
      throw new RefreshTokenReuseError();
    }
    if (session.expiresAt <= now) throw new InvalidSessionError();
    if (session.user.status !== 'ACTIVE') {
      await this.revokeAllSessions(session.userId);
      throw new AccountSuspendedError();
    }

    const refreshTokenValue = generateRefreshToken();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

    const next = await this.prisma.$transaction(async (tx) => {
      // Only one request can consume a token, even if two arrive together.
      const consumed = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) return null;

      const created = await tx.session.create({
        data: {
          userId: session.userId,
          refreshTokenHash: hashRefreshToken(refreshTokenValue),
          userAgent: ctx.userAgent ?? null,
          expiresAt,
        },
      });
      await tx.session.update({ where: { id: session.id }, data: { replacedById: created.id } });
      return created;
    });

    if (!next) {
      await this.revokeAllSessions(session.userId);
      await this.recordReuse(session.userId, ctx);
      throw new RefreshTokenReuseError();
    }

    return this.buildTokens(session.user, next.id, refreshTokenValue, expiresAt);
  }

  private recordReuse(userId: string, ctx: AuditContext): Promise<void> {
    return this.audit.record({ ...ctx, action: 'auth.session.reuse_detected', userId });
  }

  // Never fails: logging out with an unknown or old token simply does nothing.
  async logout(refreshToken: string | undefined, ctx: AuditContext = {}): Promise<void> {
    if (!refreshToken) return;
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      select: { id: true, userId: true },
    });
    if (!session) return;
    const closed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (closed.count === 1) {
      await this.audit.record({ ...ctx, action: 'auth.logout', userId: session.userId });
    }
  }

  // Checks an access token on every protected request: valid signature, and the
  // session and the account are still active (logout and suspension apply at once).
  async validateAccessToken(token: string): Promise<AuthUser & { sessionId: string }> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new InvalidSessionError();
    }
    // A login challenge (or any other token without a session id) is refused.
    if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string') {
      throw new InvalidSessionError();
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: { select: { ...AUTH_USER_FIELDS, status: true } } },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new InvalidSessionError();
    }

    const { id, email, fullName, role } = session.user;
    return { id, email, fullName, role, sessionId: session.id };
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async startSession(user: AuthUser, ctx: AuditContext): Promise<IssuedTokens> {
    const refreshTokenValue = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshTokenValue),
        userAgent: ctx.userAgent ?? null,
        expiresAt,
      },
    });
    return this.buildTokens(user, session.id, refreshTokenValue, expiresAt);
  }

  private async buildTokens(
    user: AuthUser,
    sessionId: string,
    refreshToken: string,
    refreshTokenExpiresAt: Date,
  ): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = { sub: user.id, sid: sessionId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    return {
      accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshTokenExpiresAt,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    };
  }
}
