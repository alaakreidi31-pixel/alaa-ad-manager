import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
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
import { AuthService, type AccessTokenPayload, type IssuedTokens } from './auth.service';
import { hashPassword } from './password';
import { SecretBox } from './secret-box';
import { base32Decode, currentTimeStep, generateTotpSecret, totpCode } from './totp';
import { enableTwoFactor } from './two-factor';

// The real PrismaService reads .env at import time: replace it (the test
// database client is passed in directly).
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const prisma = createTestPrisma();
const jwt = new JwtService({
  secret: 'test-only-secret-at-least-32-characters-long',
  signOptions: { algorithm: 'HS256' },
  verifyOptions: { algorithms: ['HS256'] },
});
const box = new SecretBox(randomBytes(32).toString('base64'));
const audit = new AuditService(prisma as unknown as PrismaService);
const auth = new AuthService(prisma as unknown as PrismaService, jwt, box, audit);

const PASSWORD = 'a long enough password';
let passwordHash: string;

// A client account (no 2FA needed). The SUPER_ADMIN cases are in the
// "two-factor authentication" tests below.
async function createUser(
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  role: 'SUPER_ADMIN' | 'CLIENT_USER' = 'CLIENT_USER',
) {
  passwordHash ??= await hashPassword(PASSWORD);
  return prisma.user.create({
    data: {
      email: 'owner@alaa.test',
      fullName: 'Alaa Owner',
      passwordHash,
      role,
      status,
    },
  });
}

// Logs in an account without 2FA and returns its tokens.
async function signIn(email = 'owner@alaa.test', password = PASSWORD): Promise<IssuedTokens> {
  const result = await auth.login(email, password);
  if (result.status !== 'authenticated') throw new Error('Expected direct login');
  return result.tokens;
}

// The authenticator code for the current 30 seconds (offset -1 = previous code).
function codeFor(secret: string, offset = 0): string {
  return totpCode(base32Decode(secret), currentTimeStep() + offset);
}

describe('AuthService (real PostgreSQL, test database)', () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.recoveryCode.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('login', () => {
    it('returns tokens and stores only the hash of the refresh token', async () => {
      const user = await createUser();
      const result = await signIn();

      expect(result.user).toEqual({
        id: user.id,
        email: 'owner@alaa.test',
        fullName: 'Alaa Owner',
        role: 'CLIENT_USER',
      });
      const sessions = await prisma.session.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.refreshTokenHash).not.toBe(result.refreshToken);
      expect(sessions[0]?.refreshTokenHash).toHaveLength(64);
    });

    it('signs an access token with ids and role only (no personal data)', async () => {
      const user = await createUser();
      const { accessToken } = await signIn();
      const payload = await jwt.verifyAsync<AccessTokenPayload & { exp: number; iat: number }>(
        accessToken,
      );
      expect(payload.sub).toBe(user.id);
      expect(payload.role).toBe('CLIENT_USER');
      expect(JSON.stringify(payload)).not.toContain('owner@alaa.test');
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('normalizes the email', async () => {
      await createUser();
      await expect(auth.login('  OWNER@Alaa.test ', PASSWORD)).resolves.toBeDefined();
    });

    it('refuses a wrong password with a generic error', async () => {
      await createUser();
      await expect(auth.login('owner@alaa.test', 'wrong password!!')).rejects.toThrow(
        InvalidCredentialsError,
      );
      expect(await prisma.session.count()).toBe(0);
    });

    it('refuses an unknown email with the SAME generic error', async () => {
      await createUser();
      const error: unknown = await auth
        .login('nobody@alaa.test', PASSWORD)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect((error as Error).message).toBe('Invalid email or password');
    });

    it('refuses a suspended account and creates no session', async () => {
      await createUser('SUSPENDED');
      await expect(auth.login('owner@alaa.test', PASSWORD)).rejects.toThrow(AccountSuspendedError);
      expect(await prisma.session.count()).toBe(0);
    });
  });

  describe('brute-force protection (account lock)', () => {
    async function failTimes(count: number) {
      for (let i = 0; i < count; i += 1) {
        await auth.login('owner@alaa.test', 'wrong password!!').catch(() => undefined);
      }
    }

    it('counts wrong passwords but does not lock before 5', async () => {
      await createUser();
      await failTimes(4);
      const user = await prisma.user.findFirstOrThrow();
      expect(user.failedLoginAttempts).toBe(4);
      expect(user.lockedUntil).toBeNull();
    });

    it('locks the account for 15 minutes on the 5th wrong password', async () => {
      await createUser();
      await failTimes(4);
      const before = Date.now();
      await expect(auth.login('owner@alaa.test', 'wrong password!!')).rejects.toThrow(
        AccountLockedError,
      );

      const user = await prisma.user.findFirstOrThrow();
      expect(user.failedLoginAttempts).toBe(0);
      const lockMs = (user.lockedUntil?.getTime() ?? 0) - before;
      expect(lockMs).toBeGreaterThan(14 * 60 * 1000);
      expect(lockMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    });

    it('refuses even the CORRECT password while locked, and creates no session', async () => {
      await createUser();
      await failTimes(5);
      await expect(auth.login('owner@alaa.test', PASSWORD)).rejects.toThrow(AccountLockedError);
      expect(await prisma.session.count()).toBe(0);
    });

    it('allows login again after the lock expires, and resets the counters', async () => {
      await createUser();
      await failTimes(5);
      await prisma.user.updateMany({ data: { lockedUntil: new Date(Date.now() - 1000) } });

      await expect(auth.login('owner@alaa.test', PASSWORD)).resolves.toBeDefined();
      const user = await prisma.user.findFirstOrThrow();
      expect(user.lockedUntil).toBeNull();
      expect(user.failedLoginAttempts).toBe(0);
    });

    it('a successful login resets the counter', async () => {
      await createUser();
      await failTimes(3);
      await signIn();
      expect((await prisma.user.findFirstOrThrow()).failedLoginAttempts).toBe(0);
    });

    it('counts parallel wrong attempts correctly', async () => {
      await createUser();
      await Promise.all(
        Array.from({ length: 4 }, () =>
          auth.login('owner@alaa.test', 'wrong password!!').catch(() => undefined),
        ),
      );
      expect((await prisma.user.findFirstOrThrow()).failedLoginAttempts).toBe(4);
    });
  });

  describe('refresh (rotation)', () => {
    it('issues new tokens and revokes the old session', async () => {
      await createUser();
      const first = await signIn();
      const second = await auth.refresh(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      const sessions = await prisma.session.findMany({ orderBy: { createdAt: 'asc' } });
      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.revokedAt).not.toBeNull();
      expect(sessions[0]?.replacedById).toBe(sessions[1]?.id);
      expect(sessions[1]?.revokedAt).toBeNull();
    });

    it('detects reuse of an old token and closes every session', async () => {
      await createUser();
      const first = await signIn();
      const second = await auth.refresh(first.refreshToken);

      await expect(auth.refresh(first.refreshToken)).rejects.toThrow(RefreshTokenReuseError);
      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
      await expect(auth.refresh(second.refreshToken)).rejects.toThrow(InvalidSessionError);
    });

    it('refuses an unknown token', async () => {
      await expect(auth.refresh('not-a-real-token')).rejects.toThrow(InvalidSessionError);
    });

    it('refuses an expired session', async () => {
      await createUser();
      const { refreshToken } = await signIn();
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(auth.refresh(refreshToken)).rejects.toThrow(InvalidSessionError);
    });

    it('refuses and closes sessions of an account suspended after login', async () => {
      const user = await createUser();
      const { refreshToken } = await signIn();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

      await expect(auth.refresh(refreshToken)).rejects.toThrow(AccountSuspendedError);
      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    });
  });

  describe('access token validation and logout', () => {
    it('accepts a valid access token', async () => {
      const user = await createUser();
      const { accessToken } = await signIn();
      await expect(auth.validateAccessToken(accessToken)).resolves.toMatchObject({ id: user.id });
    });

    it('rejects the access token immediately after logout', async () => {
      await createUser();
      const { accessToken, refreshToken } = await signIn();
      await auth.logout(refreshToken);

      await expect(auth.validateAccessToken(accessToken)).rejects.toThrow(InvalidSessionError);
      await expect(auth.refresh(refreshToken)).rejects.toThrow(InvalidSessionError);
    });

    it('rejects the access token immediately after suspension', async () => {
      const user = await createUser();
      const { accessToken } = await signIn();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
      await expect(auth.validateAccessToken(accessToken)).rejects.toThrow(InvalidSessionError);
    });

    it('rejects a token signed with another secret', async () => {
      await createUser();
      await signIn();
      const forged = await new JwtService({
        secret: 'another-secret-another-secret-123',
      }).signAsync({ sub: 'x', sid: 'y', role: 'SUPER_ADMIN' });
      await expect(auth.validateAccessToken(forged)).rejects.toThrow(InvalidSessionError);
    });

    it('logout with an unknown token does nothing and does not fail', async () => {
      await expect(auth.logout('unknown')).resolves.toBeUndefined();
      await expect(auth.logout(undefined)).resolves.toBeUndefined();
    });
  });
  describe('two-factor authentication (ADR 0013)', () => {
    // SUPER_ADMIN with 2FA enabled. The setup uses the PREVIOUS code, so the
    // current code is still unused for the login tests.
    async function createAdminWith2fa() {
      const user = await createUser('ACTIVE', 'SUPER_ADMIN');
      const secret = generateTotpSecret();
      const recoveryCodes = await enableTwoFactor(
        prisma,
        box,
        user.id,
        secret,
        codeFor(secret, -1),
      );
      return { user, secret, recoveryCodes };
    }

    async function challenge(): Promise<string> {
      const result = await auth.login('owner@alaa.test', PASSWORD);
      if (result.status !== 'two_factor_required') throw new Error('Expected 2FA step');
      return result.challengeToken;
    }

    it('refuses a SUPER_ADMIN without 2FA, and creates no session', async () => {
      await createUser('ACTIVE', 'SUPER_ADMIN');
      await expect(auth.login('owner@alaa.test', PASSWORD)).rejects.toThrow(
        TwoFactorSetupRequiredError,
      );
      expect(await prisma.session.count()).toBe(0);
    });

    it('setup stores the secret encrypted, and 10 hashed recovery codes', async () => {
      const { user, secret, recoveryCodes } = await createAdminWith2fa();
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      expect(stored.totpEnabledAt).not.toBeNull();
      expect(stored.totpSecretEncrypted).not.toContain(secret);
      expect(box.decrypt(stored.totpSecretEncrypted ?? '')).toBe(secret);
      expect(recoveryCodes).toHaveLength(10);
      const hashes = await prisma.recoveryCode.findMany();
      expect(hashes).toHaveLength(10);
      expect(hashes.map((row) => row.codeHash)).not.toContain(recoveryCodes[0]);
    });

    it('setup refuses a wrong code and changes nothing', async () => {
      const user = await createUser('ACTIVE', 'SUPER_ADMIN');
      await expect(
        enableTwoFactor(prisma, box, user.id, generateTotpSecret(), '000000'),
      ).rejects.toThrow(InvalidTwoFactorCodeError);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.totpEnabledAt).toBeNull();
      expect(await prisma.recoveryCode.count()).toBe(0);
    });

    it('the database refuses a half-enabled 2FA (CHECK constraint)', async () => {
      const user = await createUser('ACTIVE', 'SUPER_ADMIN');
      await expect(
        prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } }),
      ).rejects.toThrow();
    });

    it('password step gives a challenge only: no session, no tokens', async () => {
      await createAdminWith2fa();
      const result = await auth.login('owner@alaa.test', PASSWORD);
      expect(result.status).toBe('two_factor_required');
      expect(result).not.toHaveProperty('tokens');
      expect(await prisma.session.count()).toBe(0);
    });

    it('a correct authenticator code completes the login', async () => {
      const { user, secret } = await createAdminWith2fa();
      const tokens = await auth.verifyTwoFactor(await challenge(), codeFor(secret));
      expect(tokens.user.id).toBe(user.id);
      expect(tokens.user.role).toBe('SUPER_ADMIN');
      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(1);
    });

    it('refuses the same authenticator code twice', async () => {
      const { secret } = await createAdminWith2fa();
      const code = codeFor(secret);
      await auth.verifyTwoFactor(await challenge(), code);
      await expect(auth.verifyTwoFactor(await challenge(), code)).rejects.toThrow(
        InvalidTwoFactorCodeError,
      );
    });

    it('refuses the code that was used during setup', async () => {
      const { secret } = await createAdminWith2fa();
      await expect(auth.verifyTwoFactor(await challenge(), codeFor(secret, -1))).rejects.toThrow(
        InvalidTwoFactorCodeError,
      );
    });

    it('refuses a wrong code and creates no session', async () => {
      const { secret } = await createAdminWith2fa();
      const wrong = codeFor(secret) === '000000' ? '111111' : '000000';
      await expect(auth.verifyTwoFactor(await challenge(), wrong)).rejects.toThrow(
        InvalidTwoFactorCodeError,
      );
      expect(await prisma.session.count()).toBe(0);
    });

    it('accepts a recovery code once only (typed with spaces or lowercase)', async () => {
      const { recoveryCodes } = await createAdminWith2fa();
      const code = recoveryCodes[0] ?? '';

      await expect(
        auth.verifyTwoFactor(await challenge(), code.toLowerCase().replace('-', ' ')),
      ).resolves.toBeDefined();
      await expect(auth.verifyTwoFactor(await challenge(), code)).rejects.toThrow(
        InvalidTwoFactorCodeError,
      );
      expect(await prisma.recoveryCode.count({ where: { usedAt: { not: null } } })).toBe(1);
    });

    it('refuses an expired or forged challenge', async () => {
      const { user, secret } = await createAdminWith2fa();
      const expired = await jwt.signAsync(
        { sub: user.id, purpose: 'two_factor_login' },
        { expiresIn: -10 },
      );
      await expect(auth.verifyTwoFactor(expired, codeFor(secret))).rejects.toThrow(
        InvalidLoginChallengeError,
      );
      await expect(auth.verifyTwoFactor('not-a-token', codeFor(secret))).rejects.toThrow(
        InvalidLoginChallengeError,
      );
    });

    it('an access token is not accepted as a challenge, and the reverse', async () => {
      const { secret } = await createAdminWith2fa();
      const challengeToken = await challenge();
      const tokens = await auth.verifyTwoFactor(challengeToken, codeFor(secret));

      await expect(auth.verifyTwoFactor(tokens.accessToken, codeFor(secret, 1))).rejects.toThrow(
        InvalidLoginChallengeError,
      );
      await expect(auth.validateAccessToken(challengeToken)).rejects.toThrow(InvalidSessionError);
    });

    it('wrong codes count toward the lock; the correct password does NOT reset it', async () => {
      const { secret } = await createAdminWith2fa();
      const wrong = codeFor(secret) === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i += 1) {
        await auth.verifyTwoFactor(await challenge(), wrong).catch(() => undefined);
      }
      expect((await prisma.user.findFirstOrThrow()).failedLoginAttempts).toBe(4);

      await expect(auth.verifyTwoFactor(await challenge(), wrong)).rejects.toThrow(
        AccountLockedError,
      );
      await expect(auth.login('owner@alaa.test', PASSWORD)).rejects.toThrow(AccountLockedError);
    });

    it('a successful second step resets the failure counter', async () => {
      const { secret } = await createAdminWith2fa();
      await auth.verifyTwoFactor(await challenge(), '000000').catch(() => undefined);
      await auth.verifyTwoFactor(await challenge(), codeFor(secret));
      expect((await prisma.user.findFirstOrThrow()).failedLoginAttempts).toBe(0);
    });

    it('refuses the second step if the account was suspended in between', async () => {
      const { user, secret } = await createAdminWith2fa();
      const challengeToken = await challenge();
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
      await expect(auth.verifyTwoFactor(challengeToken, codeFor(secret))).rejects.toThrow(
        AccountSuspendedError,
      );
    });

    it('setting up 2FA again replaces the codes and closes open sessions', async () => {
      const { user, secret, recoveryCodes } = await createAdminWith2fa();
      await auth.verifyTwoFactor(await challenge(), codeFor(secret));

      const newSecret = generateTotpSecret();
      const newCodes = await enableTwoFactor(prisma, box, user.id, newSecret, codeFor(newSecret));
      expect(newCodes).not.toEqual(recoveryCodes);
      expect(await prisma.recoveryCode.count()).toBe(10);
      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    });
  });
  describe('audit log (ADR 0014)', () => {
    const ctx = { ip: '203.0.113.5', userAgent: 'TestBrowser/1.0' };
    // The audit log cannot be emptied (append-only): each test reads only
    // the rows written since it started.
    let since: Date;
    beforeEach(async () => {
      // A short pause, so no row of the previous test has the same millisecond.
      await new Promise((resolve) => setTimeout(resolve, 10));
      since = new Date();
    });

    async function auditRows() {
      return prisma.auditLog.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
      });
    }
    async function actions() {
      return (await auditRows()).map((row) => row.action);
    }

    it('records a successful login with the IP and the browser', async () => {
      const user = await createUser();
      await auth.login('owner@alaa.test', PASSWORD, ctx);

      const [row] = await auditRows();
      expect(row).toMatchObject({
        action: 'auth.login.succeeded',
        userId: user.id,
        ip: '203.0.113.5',
        userAgent: 'TestBrowser/1.0',
        metadata: { method: 'password' },
      });
    });

    it('records a login with an unknown email, without a user', async () => {
      await auth.login(' Nobody@Alaa.test ', PASSWORD, ctx).catch(() => undefined);
      const [row] = await auditRows();
      expect(row).toMatchObject({
        action: 'auth.login.failed',
        userId: null,
        metadata: { reason: 'unknown_email', email: 'nobody@alaa.test' },
      });
    });

    it('records each wrong password, then the lock', async () => {
      await createUser();
      for (let i = 0; i < 5; i += 1) {
        await auth.login('owner@alaa.test', 'wrong password!!', ctx).catch(() => undefined);
      }
      const rows = await auditRows();
      expect(rows.filter((row) => row.action === 'auth.login.failed')).toHaveLength(5);
      expect(rows.filter((row) => row.action === 'auth.account.locked')).toHaveLength(1);
      expect(rows.find((row) => row.action === 'auth.login.failed')?.metadata).toEqual({
        reason: 'wrong_password',
      });
    });

    it('records refused logins with their reason', async () => {
      await createUser('SUSPENDED');
      await auth.login('owner@alaa.test', PASSWORD).catch(() => undefined);
      expect((await auditRows())[0]?.metadata).toEqual({ reason: 'account_suspended' });
    });

    it('records the two login steps and the method used', async () => {
      const user = await createUser('ACTIVE', 'SUPER_ADMIN');
      const secret = generateTotpSecret();
      const [recovery = ''] = await enableTwoFactor(
        prisma,
        box,
        user.id,
        secret,
        codeFor(secret, -1),
      );

      const step1 = await auth.login('owner@alaa.test', PASSWORD, ctx);
      if (step1.status !== 'two_factor_required') throw new Error('Expected 2FA step');
      await auth.verifyTwoFactor(step1.challengeToken, '000000', ctx).catch(() => undefined);
      await auth.verifyTwoFactor(step1.challengeToken, codeFor(secret), ctx);
      await auth.verifyTwoFactor(step1.challengeToken, recovery, ctx);

      const rows = await auditRows();
      expect(rows.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'admin.two_factor.enabled',
          'auth.login.password_verified',
          'auth.two_factor.failed',
          'auth.login.succeeded',
        ]),
      );
      const methods = rows
        .filter((row) => row.action === 'auth.login.succeeded')
        .map((row) => (row.metadata as { method: string }).method)
        .sort();
      expect(methods).toEqual(['recovery_code', 'totp']);
    });

    it('records a stolen refresh token being reused', async () => {
      const user = await createUser();
      const first = await signIn();
      await auth.refresh(first.refreshToken, ctx);
      await auth.refresh(first.refreshToken, ctx).catch(() => undefined);

      const row = (await auditRows()).find((r) => r.action === 'auth.session.reuse_detected');
      expect(row?.userId).toBe(user.id);
    });

    it('records a logout once, and nothing for an unknown token', async () => {
      await createUser();
      const { refreshToken } = await signIn();
      await auth.logout(refreshToken, ctx);
      await auth.logout(refreshToken, ctx);
      await auth.logout('unknown', ctx);
      expect((await actions()).filter((a) => a === 'auth.logout')).toHaveLength(1);
    });

    it('never stores a password, token, code or secret', async () => {
      const user = await createUser('ACTIVE', 'SUPER_ADMIN');
      const secret = generateTotpSecret();
      const recoveryCodes = await enableTwoFactor(
        prisma,
        box,
        user.id,
        secret,
        codeFor(secret, -1),
      );
      await auth.login('owner@alaa.test', 'wrong password!!').catch(() => undefined);
      const step1 = await auth.login('owner@alaa.test', PASSWORD);
      if (step1.status !== 'two_factor_required') throw new Error('Expected 2FA step');
      const code = codeFor(secret);
      const tokens = await auth.verifyTwoFactor(step1.challengeToken, code);
      await auth.logout(tokens.refreshToken);

      const stored = JSON.stringify(await auditRows());
      for (const secretValue of [
        PASSWORD,
        'wrong password!!',
        secret,
        code,
        step1.challengeToken,
        tokens.accessToken,
        tokens.refreshToken,
        ...recoveryCodes,
      ]) {
        expect(stored).not.toContain(secretValue);
      }
    });
  });
});
