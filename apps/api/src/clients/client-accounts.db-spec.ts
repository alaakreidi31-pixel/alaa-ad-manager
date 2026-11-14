// Client login accounts (ADR 0016): temporary passwords, the forced change at
// first login, client suspension / archiving, and isolation between clients.
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import {
  AccountSuspendedError,
  ClientInactiveError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidPasswordChangeError,
  InvalidSessionError,
  PasswordReusedError,
  WeakPasswordError,
} from '../auth/auth.errors';
import { AuthService, type IssuedTokens } from '../auth/auth.service';
import { SecretBox } from '../auth/secret-box';
import type { PrismaService } from '../prisma/prisma.service';
import { createTestPrisma } from '../testing/test-prisma';
import { ClientUsersService } from './client-users.service';
import {
  ClientArchivedError,
  ClientUserNotFoundError,
  ClientValidationError,
  EmailTakenError,
} from './clients.errors';
import { ClientsService } from './clients.service';

// The real PrismaService reads .env at import time: replace it.
vi.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const prisma = createTestPrisma();
const db = prisma as unknown as PrismaService;
const jwt = new JwtService({
  secret: 'test-only-secret-at-least-32-characters-long',
  signOptions: { algorithm: 'HS256' },
  verifyOptions: { algorithms: ['HS256'] },
});
const auth = new AuthService(
  db,
  jwt,
  new SecretBox(randomBytes(32).toString('base64')),
  new AuditService(db),
);
const clients = new ClientsService(db);
const users = new ClientUsersService(db);
const admin = { userId: randomUUID(), ip: '203.0.113.7', userAgent: 'AccountsTest/1.0' };
const NEW_PASSWORD = 'my own strong password';

const uniqueEmail = () => `client-${randomUUID().slice(0, 8)}@alaa.test`;

async function newClient() {
  return clients.create({ name: `Accounts ${randomUUID().slice(0, 8)}` }, admin);
}

// A client account that already chose its own password.
async function readyAccount(clientId: string) {
  const email = uniqueEmail();
  const { temporaryPassword } = await users.create(clientId, { email, fullName: 'Sara' }, admin);
  const step = await auth.login(email, temporaryPassword);
  if (step.status !== 'password_change_required') throw new Error('Expected password change');
  const done = await auth.completePasswordChange(step.changeToken, NEW_PASSWORD);
  if (done.status !== 'authenticated') throw new Error('Expected a session');
  return { email, tokens: done.tokens };
}

async function signIn(email: string): Promise<IssuedTokens> {
  const result = await auth.login(email, NEW_PASSWORD);
  if (result.status !== 'authenticated') throw new Error('Expected direct login');
  return result.tokens;
}

describe('client login accounts (real PostgreSQL, test database)', () => {
  let clientA: { id: string };
  let clientB: { id: string };

  beforeAll(async () => {
    clientA = await newClient();
    clientB = await newClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('creating an account', () => {
    it('returns a temporary password ONCE, and stores only its argon2id hash', async () => {
      const email = uniqueEmail();
      const result = await users.create(clientA.id, { email, fullName: 'Sara' }, admin);

      expect(result.temporaryPassword).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
      expect(result.user).toMatchObject({ email, mustChangePassword: true, status: 'ACTIVE' });
      expect(result.user).not.toHaveProperty('passwordHash');

      const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(stored).toMatchObject({ role: 'CLIENT_USER', clientId: clientA.id });
      expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(stored.passwordHash).not.toContain(result.temporaryPassword);
    });

    it('never writes the temporary password to the audit log', async () => {
      const { user, temporaryPassword } = await users.create(
        clientA.id,
        { email: uniqueEmail(), fullName: 'Sara' },
        admin,
      );
      const rows = await prisma.auditLog.findMany();
      const row = rows.find(
        (r) => (r.metadata as { targetUserId?: string } | null)?.targetUserId === user.id,
      );
      expect(row).toMatchObject({ action: 'admin.client_user.created', userId: admin.userId });
      expect(JSON.stringify(rows)).not.toContain(temporaryPassword);
    });

    it('refuses an email already used, invalid data, and an archived client', async () => {
      const email = uniqueEmail();
      await users.create(clientA.id, { email, fullName: 'Sara' }, admin);
      await expect(users.create(clientB.id, { email, fullName: 'Omar' }, admin)).rejects.toThrow(
        EmailTakenError,
      );
      await expect(
        users.create(clientA.id, { email: 'nope', fullName: 'Omar' }, admin),
      ).rejects.toThrow(ClientValidationError);

      const archived = await newClient();
      await clients.changeStatus(archived.id, 'archive', admin);
      await expect(
        users.create(archived.id, { email: uniqueEmail(), fullName: 'Omar' }, admin),
      ).rejects.toThrow(ClientArchivedError);
    });

    it('the database refuses a CLIENT_USER without a client, and an admin with one', async () => {
      const base = { fullName: 'Raw', passwordHash: 'x' };
      await expect(
        prisma.user.create({ data: { ...base, email: uniqueEmail(), role: 'CLIENT_USER' } }),
      ).rejects.toThrow();
      await expect(
        prisma.user.create({
          data: { ...base, email: uniqueEmail(), role: 'SUPER_ADMIN', clientId: clientA.id },
        }),
      ).rejects.toThrow();
    });
  });

  describe('first login with the temporary password', () => {
    it('opens NO session until a new password is chosen', async () => {
      const email = uniqueEmail();
      const { user, temporaryPassword } = await users.create(
        clientA.id,
        { email, fullName: 'Sara' },
        admin,
      );
      const step = await auth.login(email, temporaryPassword);
      expect(step.status).toBe('password_change_required');
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it('the new password opens a session; the temporary one stops working', async () => {
      const email = uniqueEmail();
      const { temporaryPassword } = await users.create(
        clientA.id,
        { email, fullName: 'Sara' },
        admin,
      );
      const step = await auth.login(email, temporaryPassword);
      if (step.status !== 'password_change_required') throw new Error('Expected change');

      const done = await auth.completePasswordChange(step.changeToken, NEW_PASSWORD);
      expect(done.status).toBe('authenticated');
      await expect(auth.login(email, temporaryPassword)).rejects.toThrow(InvalidCredentialsError);
      await expect(signIn(email)).resolves.toBeDefined();
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).mustChangePassword).toBe(
        false,
      );
    });

    it('the change step works only once', async () => {
      const email = uniqueEmail();
      const { temporaryPassword } = await users.create(
        clientA.id,
        { email, fullName: 'Sara' },
        admin,
      );
      const step = await auth.login(email, temporaryPassword);
      if (step.status !== 'password_change_required') throw new Error('Expected change');

      await auth.completePasswordChange(step.changeToken, NEW_PASSWORD);
      await expect(
        auth.completePasswordChange(step.changeToken, 'another strong password'),
      ).rejects.toThrow(InvalidPasswordChangeError);
    });

    it('refuses a weak password, and the temporary password itself', async () => {
      const email = uniqueEmail();
      const { temporaryPassword } = await users.create(
        clientA.id,
        { email, fullName: 'Sara' },
        admin,
      );
      const step = await auth.login(email, temporaryPassword);
      if (step.status !== 'password_change_required') throw new Error('Expected change');

      await expect(auth.completePasswordChange(step.changeToken, 'short')).rejects.toThrow(
        WeakPasswordError,
      );
      await expect(
        auth.completePasswordChange(step.changeToken, temporaryPassword),
      ).rejects.toThrow(PasswordReusedError);
    });

    it('a change token is not a 2FA challenge, and the reverse', async () => {
      const email = uniqueEmail();
      const { temporaryPassword } = await users.create(
        clientA.id,
        { email, fullName: 'Sara' },
        admin,
      );
      const step = await auth.login(email, temporaryPassword);
      if (step.status !== 'password_change_required') throw new Error('Expected change');

      await expect(auth.verifyTwoFactor(step.changeToken, '123456')).rejects.toThrow(
        InvalidLoginChallengeError,
      );
      const forged = await jwt.signAsync({ sub: randomUUID(), purpose: 'two_factor_login' });
      await expect(auth.completePasswordChange(forged, NEW_PASSWORD)).rejects.toThrow(
        InvalidPasswordChangeError,
      );
    });

    it('never writes any password to the audit log', async () => {
      const email = uniqueEmail();
      const { temporaryPassword } = await users.create(
        clientA.id,
        { email, fullName: 'Sara' },
        admin,
      );
      const step = await auth.login(email, temporaryPassword);
      if (step.status !== 'password_change_required') throw new Error('Expected change');
      await auth.completePasswordChange(step.changeToken, NEW_PASSWORD);

      const stored = JSON.stringify(await prisma.auditLog.findMany());
      expect(stored).not.toContain(temporaryPassword);
      expect(stored).not.toContain(NEW_PASSWORD);
      expect(stored).not.toContain(step.changeToken);
    });
  });

  describe('suspended or archived client', () => {
    it.each(['suspend', 'archive'] as const)(
      'after "%s": open sessions stop at once, and login is refused',
      async (action) => {
        const client = await newClient();
        const { email, tokens } = await readyAccount(client.id);
        await expect(auth.validateAccessToken(tokens.accessToken)).resolves.toBeDefined();

        await clients.changeStatus(client.id, action, admin);

        await expect(auth.validateAccessToken(tokens.accessToken)).rejects.toThrow(
          InvalidSessionError,
        );
        await expect(auth.refresh(tokens.refreshToken)).rejects.toThrow(InvalidSessionError);
        await expect(signIn(email)).rejects.toThrow(ClientInactiveError);

        await clients.changeStatus(client.id, 'activate', admin);
        await expect(signIn(email)).resolves.toBeDefined();
      },
    );

    it('even a session the database did not close is refused on the next request', async () => {
      const client = await newClient();
      const { tokens } = await readyAccount(client.id);
      // Simulates a bug elsewhere: the client is suspended without closing sessions.
      await prisma.client.update({ where: { id: client.id }, data: { status: 'SUSPENDED' } });
      await expect(auth.validateAccessToken(tokens.accessToken)).rejects.toThrow(
        InvalidSessionError,
      );
    });
  });

  describe('one account suspended, password reset', () => {
    it('suspends one account only, and closes its sessions', async () => {
      const client = await newClient();
      const first = await readyAccount(client.id);
      const second = await readyAccount(client.id);
      const firstUser = await prisma.user.findUniqueOrThrow({ where: { email: first.email } });

      await users.changeStatus(client.id, firstUser.id, 'SUSPENDED', admin);

      await expect(auth.validateAccessToken(first.tokens.accessToken)).rejects.toThrow(
        InvalidSessionError,
      );
      await expect(signIn(first.email)).rejects.toThrow(AccountSuspendedError);
      await expect(auth.validateAccessToken(second.tokens.accessToken)).resolves.toBeDefined();
    });

    it('a reset gives a new temporary password and ends every session', async () => {
      const client = await newClient();
      const { email, tokens } = await readyAccount(client.id);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });

      const { temporaryPassword } = await users.resetPassword(client.id, user.id, admin);

      await expect(auth.validateAccessToken(tokens.accessToken)).rejects.toThrow(
        InvalidSessionError,
      );
      await expect(signIn(email)).rejects.toThrow(InvalidCredentialsError);
      expect((await auth.login(email, temporaryPassword)).status).toBe('password_change_required');
    });
  });

  describe('isolation between clients (IDOR)', () => {
    it("an account of client B is 'not found' through client A", async () => {
      const { email } = await readyAccount(clientB.id);
      const userOfB = await prisma.user.findUniqueOrThrow({ where: { email } });

      await expect(users.resetPassword(clientA.id, userOfB.id, admin)).rejects.toThrow(
        ClientUserNotFoundError,
      );
      await expect(users.changeStatus(clientA.id, userOfB.id, 'SUSPENDED', admin)).rejects.toThrow(
        ClientUserNotFoundError,
      );
      expect((await users.list(clientA.id)).map((u) => u.id)).not.toContain(userOfB.id);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userOfB.id } })).status).toBe(
        'ACTIVE',
      );
    });

    it('the access token carries the client of the account', async () => {
      const { tokens } = await readyAccount(clientB.id);
      expect((await auth.validateAccessToken(tokens.accessToken)).clientId).toBe(clientB.id);
    });
  });
});
