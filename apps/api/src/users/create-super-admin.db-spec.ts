import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../auth/password';
import { createTestPrisma } from '../testing/test-prisma';
import { createSuperAdmin, SuperAdminError } from './create-super-admin';

const prisma = createTestPrisma();

const VALID = {
  email: '  Owner@Alaa.TEST ',
  fullName: 'Alaa Owner',
  password: 'a long enough password',
};

describe('createSuperAdmin (real PostgreSQL, test database)', () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.recoveryCode.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an ACTIVE SUPER_ADMIN with a normalized email', async () => {
    const created = await createSuperAdmin(prisma, VALID);
    expect(created.email).toBe('owner@alaa.test');

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.role).toBe('SUPER_ADMIN');
    expect(stored.status).toBe('ACTIVE');
  });

  it('stores an argon2id hash, never the password', async () => {
    const created = await createSuperAdmin(prisma, VALID);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });

    expect(stored.passwordHash).not.toContain(VALID.password);
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored.passwordHash, VALID.password)).toBe(true);
  });

  it('writes the creation to the audit log, in the same transaction', async () => {
    const created = await createSuperAdmin(prisma, VALID);
    const rows = await prisma.auditLog.findMany({ where: { userId: created.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'admin.super_admin.created',
      metadata: { source: 'cli' },
    });
  });

  it('does not return the password hash', async () => {
    const created = await createSuperAdmin(prisma, VALID);
    expect(Object.keys(created).sort()).toEqual(['createdAt', 'email', 'fullName', 'id']);
  });

  it('refuses a second SUPER_ADMIN', async () => {
    await createSuperAdmin(prisma, VALID);
    await expect(createSuperAdmin(prisma, { ...VALID, email: 'second@alaa.test' })).rejects.toThrow(
      SuperAdminError,
    );
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses an email that already belongs to another account', async () => {
    await prisma.user.create({
      data: {
        email: 'owner@alaa.test',
        fullName: 'Existing Client',
        passwordHash: 'not-a-real-hash',
        role: 'CLIENT_USER',
      },
    });
    await expect(createSuperAdmin(prisma, VALID)).rejects.toThrow(/already exists/);
    expect(await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })).toBe(0);
  });

  it.each([
    ['a short password', { ...VALID, password: 'short' }, /password/],
    ['an invalid email', { ...VALID, email: 'not-an-email' }, /email/],
    ['an empty name', { ...VALID, fullName: '   ' }, /fullName/],
  ])('refuses %s and writes nothing', async (_case, input, message) => {
    await expect(createSuperAdmin(prisma, input)).rejects.toThrow(message);
    expect(await prisma.user.count()).toBe(0);
  });
});
