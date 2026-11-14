import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import {
  AccountLockedError,
  AccountSuspendedError,
  InvalidCredentialsError,
  InvalidSessionError,
  RefreshTokenReuseError,
} from './auth.errors';
import { AuthService, type AccessTokenPayload } from './auth.service';
import { hashPassword } from './password';

// The real PrismaService reads .env at import time: replace it (the test
// database client is passed in directly).
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const prisma = createTestPrisma();
const jwt = new JwtService({
  secret: 'test-only-secret-at-least-32-characters-long',
  signOptions: { algorithm: 'HS256' },
  verifyOptions: { algorithms: ['HS256'] },
});
const auth = new AuthService(prisma as unknown as PrismaService, jwt);

const PASSWORD = 'a long enough password';
let passwordHash: string;

async function createUser(status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  passwordHash ??= await hashPassword(PASSWORD);
  return prisma.user.create({
    data: {
      email: 'owner@alaa.test',
      fullName: 'Alaa Owner',
      passwordHash,
      role: 'SUPER_ADMIN',
      status,
    },
  });
}

describe('AuthService (real PostgreSQL, test database)', () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('login', () => {
    it('returns tokens and stores only the hash of the refresh token', async () => {
      const user = await createUser();
      const result = await auth.login('owner@alaa.test', PASSWORD);

      expect(result.user).toEqual({
        id: user.id,
        email: 'owner@alaa.test',
        fullName: 'Alaa Owner',
        role: 'SUPER_ADMIN',
      });
      const sessions = await prisma.session.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.refreshTokenHash).not.toBe(result.refreshToken);
      expect(sessions[0]?.refreshTokenHash).toHaveLength(64);
    });

    it('signs an access token with ids and role only (no personal data)', async () => {
      const user = await createUser();
      const { accessToken } = await auth.login('owner@alaa.test', PASSWORD);
      const payload = await jwt.verifyAsync<AccessTokenPayload & { exp: number; iat: number }>(
        accessToken,
      );
      expect(payload.sub).toBe(user.id);
      expect(payload.role).toBe('SUPER_ADMIN');
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
      await auth.login('owner@alaa.test', PASSWORD);
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
      const first = await auth.login('owner@alaa.test', PASSWORD);
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
      const first = await auth.login('owner@alaa.test', PASSWORD);
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
      const { refreshToken } = await auth.login('owner@alaa.test', PASSWORD);
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(auth.refresh(refreshToken)).rejects.toThrow(InvalidSessionError);
    });

    it('refuses and closes sessions of an account suspended after login', async () => {
      const user = await createUser();
      const { refreshToken } = await auth.login('owner@alaa.test', PASSWORD);
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

      await expect(auth.refresh(refreshToken)).rejects.toThrow(AccountSuspendedError);
      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    });
  });

  describe('access token validation and logout', () => {
    it('accepts a valid access token', async () => {
      const user = await createUser();
      const { accessToken } = await auth.login('owner@alaa.test', PASSWORD);
      await expect(auth.validateAccessToken(accessToken)).resolves.toMatchObject({ id: user.id });
    });

    it('rejects the access token immediately after logout', async () => {
      await createUser();
      const { accessToken, refreshToken } = await auth.login('owner@alaa.test', PASSWORD);
      await auth.logout(refreshToken);

      await expect(auth.validateAccessToken(accessToken)).rejects.toThrow(InvalidSessionError);
      await expect(auth.refresh(refreshToken)).rejects.toThrow(InvalidSessionError);
    });

    it('rejects the access token immediately after suspension', async () => {
      const user = await createUser();
      const { accessToken } = await auth.login('owner@alaa.test', PASSWORD);
      await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
      await expect(auth.validateAccessToken(accessToken)).rejects.toThrow(InvalidSessionError);
    });

    it('rejects a token signed with another secret', async () => {
      await createUser();
      await auth.login('owner@alaa.test', PASSWORD);
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
});
