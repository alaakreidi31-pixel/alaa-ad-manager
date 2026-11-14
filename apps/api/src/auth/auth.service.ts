import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { AuditContext } from '../audit/audit';
import { AuditService } from '../audit/audit.service';
import type { UserRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from '../users/email';
import { hashPassword, PasswordSchema, verifyPassword } from './password';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  LOGIN_CHALLENGE_TTL_SECONDS,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  PASSWORD_CHANGE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants';
import {
  AccountLockedError,
  AccountSuspendedError,
  ClientInactiveError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidPasswordChangeError,
  InvalidSessionError,
  InvalidTwoFactorCodeError,
  PasswordReusedError,
  RefreshTokenReuseError,
  TwoFactorSetupRequiredError,
  WeakPasswordError,
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

// Short-lived "step" tokens: { sub: userId, purpose }. They have no "sid", so
// they can never be used as an access token, and each purpose is accepted
// only by its own step.
// - after the password, waiting for the 2FA code (ADR 0013)
const LOGIN_CHALLENGE_PURPOSE = 'two_factor_login';
// - after a temporary password, waiting for the new password (ADR 0016)
const PASSWORD_CHANGE_PURPOSE = 'password_change';
type StepPurpose = typeof LOGIN_CHALLENGE_PURPOSE | typeof PASSWORD_CHANGE_PURPOSE;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  // The client this account belongs to (CLIENT_USER), or null (SUPER_ADMIN).
  clientId: string | null;
}

// Account fields needed by the login checks.
interface LoginUser extends AuthUser {
  status: string;
  lockedUntil: Date | null;
  failedLoginAttempts: number;
  mustChangePassword: boolean;
  totpEnabledAt: Date | null;
  client: { status: string } | null;
}
const WITH_CLIENT_STATUS = { client: { select: { status: true } } } as const;

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthUser;
}

export type LoginResult =
  | { status: 'authenticated'; tokens: IssuedTokens }
  | { status: 'two_factor_required'; challengeToken: string; expiresIn: number }
  | { status: 'password_change_required'; changeToken: string; expiresIn: number };

const AUTH_USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  clientId: true,
} as const;

// A client account works only while its client is ACTIVE (ADR 0016).
function clientInactive(user: { client: { status: string } | null }): boolean {
  return user.client !== null && user.client.status !== 'ACTIVE';
}

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
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: WITH_CLIENT_STATUS,
    });

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
    if (clientInactive(user)) {
      await fail('client_inactive');
      throw new ClientInactiveError();
    }

    // Temporary password (ADR 0016): no session until a new password is chosen.
    // The failure counter is not reset yet (same reason as for 2FA below).
    if (user.mustChangePassword) {
      const changeToken = await this.signStepToken(
        user.id,
        PASSWORD_CHANGE_PURPOSE,
        PASSWORD_CHANGE_TTL_SECONDS,
      );
      await this.audit.record({
        ...ctx,
        action: 'auth.login.password_change_required',
        userId: user.id,
      });
      return {
        status: 'password_change_required',
        changeToken,
        expiresIn: PASSWORD_CHANGE_TTL_SECONDS,
      };
    }

    return this.finishPasswordStep(user, ctx, 'password');
  }

  // After a correct password (or a new password): the 2FA step when enabled,
  // otherwise the session.
  private async finishPasswordStep(
    user: LoginUser,
    ctx: AuditContext,
    method: 'password' | 'password_change',
  ): Promise<LoginResult> {
    // With 2FA, the failure counter is NOT reset here: otherwise someone who
    // knows the password could guess codes forever (4 wrong codes, correct
    // password, 4 wrong codes...). It is reset only after the second step.
    if (user.totpEnabledAt) {
      const challengeToken = await this.signStepToken(
        user.id,
        LOGIN_CHALLENGE_PURPOSE,
        LOGIN_CHALLENGE_TTL_SECONDS,
      );
      await this.audit.record({ ...ctx, action: 'auth.login.password_verified', userId: user.id });
      return {
        status: 'two_factor_required',
        challengeToken,
        expiresIn: LOGIN_CHALLENGE_TTL_SECONDS,
      };
    }
    if (user.role === 'SUPER_ADMIN') {
      await this.audit.record({
        ...ctx,
        action: 'auth.login.failed',
        userId: user.id,
        metadata: { reason: 'two_factor_setup_required' },
      });
      throw new TwoFactorSetupRequiredError();
    }

    await this.resetFailedLogins(user);
    const tokens = await this.startSession(user, ctx);
    await this.audit.record({
      ...ctx,
      action: 'auth.login.succeeded',
      userId: user.id,
      metadata: { method },
    });
    return { status: 'authenticated', tokens };
  }

  // After a temporary password: the user chooses a new password (ADR 0016).
  // Works once (the change is conditional on must_change_password), closes
  // every other session, then continues like a normal login (2FA if enabled).
  async completePasswordChange(
    changeToken: string,
    newPassword: string,
    ctx: AuditContext = {},
  ): Promise<LoginResult> {
    const userId = await this.readStepToken(changeToken, PASSWORD_CHANGE_PURPOSE);
    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, include: WITH_CLIENT_STATUS })
      : null;
    if (!user?.mustChangePassword) throw new InvalidPasswordChangeError();
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new AccountLockedError();
    if (user.status !== 'ACTIVE') throw new AccountSuspendedError();
    if (clientInactive(user)) throw new ClientInactiveError();

    const policy = PasswordSchema.safeParse(newPassword);
    if (!policy.success) {
      throw new WeakPasswordError(policy.error.issues[0]?.message ?? 'is not valid');
    }
    if (await verifyPassword(user.passwordHash, newPassword)) throw new PasswordReusedError();

    const passwordHash = await hashPassword(newPassword);
    const changed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: user.id, mustChangePassword: true },
        data: { passwordHash, mustChangePassword: false },
      });
      if (updated.count !== 1) return false;
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    });
    if (!changed) throw new InvalidPasswordChangeError();

    await this.audit.record({
      ...ctx,
      action: 'auth.password.changed',
      userId: user.id,
      metadata: { reason: 'temporary_password' },
    });
    return this.finishPasswordStep({ ...user, mustChangePassword: false }, ctx, 'password_change');
  }

  private signStepToken(userId: string, purpose: StepPurpose, ttlSeconds: number) {
    return this.jwt.signAsync({ sub: userId, purpose }, { expiresIn: ttlSeconds });
  }

  // Returns the user id, or null for an invalid, expired or other-purpose token.
  private async readStepToken(token: string, purpose: StepPurpose): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown; purpose?: unknown }>(token);
      return payload.purpose === purpose && typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  // Step 2: a code from the authenticator app, or a one-time recovery code.
  async verifyTwoFactor(
    challengeToken: string,
    code: string,
    ctx: AuditContext = {},
  ): Promise<IssuedTokens> {
    const userId = await this.readStepToken(challengeToken, LOGIN_CHALLENGE_PURPOSE);
    if (!userId) {
      await this.audit.record({
        ...ctx,
        action: 'auth.two_factor.failed',
        metadata: { reason: 'invalid_challenge' },
      });
      throw new InvalidLoginChallengeError();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: WITH_CLIENT_STATUS,
    });
    if (!user?.totpSecretEncrypted || user.mustChangePassword) {
      throw new InvalidLoginChallengeError();
    }
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
    if (clientInactive(user)) {
      await fail('client_inactive');
      throw new ClientInactiveError();
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
      include: { user: { include: WITH_CLIENT_STATUS } },
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
    if (clientInactive(session.user)) {
      await this.revokeAllSessions(session.userId);
      throw new ClientInactiveError();
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
      include: {
        user: {
          select: {
            ...AUTH_USER_FIELDS,
            status: true,
            mustChangePassword: true,
            ...WITH_CLIENT_STATUS,
          },
        },
      },
    });
    // Checked on EVERY request: logout, suspension of the account, and
    // suspension or archiving of its client all apply immediately.
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE' ||
      session.user.mustChangePassword ||
      clientInactive(session.user)
    ) {
      throw new InvalidSessionError();
    }

    const { id, email, fullName, role, clientId } = session.user;
    return { id, email, fullName, role, clientId, sessionId: session.id };
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
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        clientId: user.clientId,
      },
    };
  }
}
