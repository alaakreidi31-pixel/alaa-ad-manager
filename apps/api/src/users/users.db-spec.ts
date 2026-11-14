import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../testing/test-prisma';
import { normalizeEmail } from './email';

const prisma = createTestPrisma();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function newUser(email = 'owner@alaa.test') {
  return {
    email: normalizeEmail(email),
    fullName: 'Test User',
    passwordHash: 'not-a-real-hash',
    role: 'SUPER_ADMIN' as const,
  };
}

// Inserts directly with SQL, bypassing normalizeEmail(), to prove that the
// database itself rejects bad data.
function rawInsert(email: string, role = 'SUPER_ADMIN') {
  return prisma.$executeRawUnsafe(
    `INSERT INTO users (email, full_name, password_hash, role, updated_at)
     VALUES ($1, 'Raw User', 'not-a-real-hash', $2::user_role, now())`,
    email,
    role,
  );
}

describe('users table (real PostgreSQL, test database)', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a user with a database-generated UUID', async () => {
    const user = await prisma.user.create({ data: newUser() });
    expect(user.id).toMatch(UUID_PATTERN);
  });

  it('defaults status to ACTIVE', async () => {
    const user = await prisma.user.create({ data: newUser() });
    expect(user.status).toBe('ACTIVE');
  });

  it('stores timestamps as timestamptz (an exact instant, UTC)', async () => {
    const before = Date.now();
    const user = await prisma.user.create({ data: newUser() });
    expect(Math.abs(user.createdAt.getTime() - before)).toBeLessThan(60_000);

    const columns = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('created_at', 'updated_at')`;
    expect(columns).toHaveLength(2);
    for (const column of columns) {
      expect(column.data_type).toBe('timestamp with time zone');
    }
  });

  it('updates updated_at on change and keeps created_at', async () => {
    const user = await prisma.user.create({ data: newUser() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { fullName: 'Renamed User' },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(user.updatedAt.getTime());
    expect(updated.createdAt.getTime()).toBe(user.createdAt.getTime());
  });

  it('stores the normalized form of an email', async () => {
    const user = await prisma.user.create({ data: newUser('  Alaa@Example.COM ') });
    expect(user.email).toBe('alaa@example.com');
  });

  it('rejects a duplicate email', async () => {
    await prisma.user.create({ data: newUser('same@alaa.test') });
    await expect(prisma.user.create({ data: newUser('same@alaa.test') })).rejects.toThrow();
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ['uppercase letters', 'Alaa@Example.com'],
    ['surrounding spaces', ' alaa@example.com '],
    ['an empty value', ''],
  ])('database rejects an email with %s', async (_case, email) => {
    await expect(rawInsert(email)).rejects.toThrow(/users_email_normalized_check/);
    expect(await prisma.user.count()).toBe(0);
  });

  it('database rejects an unknown role', async () => {
    await expect(rawInsert('role@alaa.test', 'ADMIN')).rejects.toThrow();
    expect(await prisma.user.count()).toBe(0);
  });

  it('the application user cannot create tables', async () => {
    await expect(prisma.$executeRawUnsafe('CREATE TABLE hack_test (id int)')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('the application user cannot drop the users table', async () => {
    await expect(prisma.$executeRawUnsafe('DROP TABLE users')).rejects.toThrow(
      /must be owner|permission denied/,
    );
  });
});
