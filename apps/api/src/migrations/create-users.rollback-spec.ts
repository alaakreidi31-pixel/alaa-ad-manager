import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { assertTestDatabaseUrl } from '../testing/test-database';
import { createTestPrisma } from '../testing/test-prisma';

const MIGRATION = '20261114093306_create_users';

// Guard first: this test deletes a table, so it only ever runs on a *_test database.
const migrateUrl = assertTestDatabaseUrl(
  'TEST_MIGRATE_DATABASE_URL',
  process.env['TEST_MIGRATE_DATABASE_URL'],
);
const migrator = new PrismaClient({ adapter: new PrismaPg({ connectionString: migrateUrl }) });

function runPrisma(args: string): void {
  execSync(`pnpm exec prisma ${args}`, {
    stdio: 'inherit',
    env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
  });
}

async function usersTableExists(): Promise<boolean> {
  const rows = await migrator.$queryRaw<{ found: boolean }[]>`
    SELECT to_regclass('public.users') IS NOT NULL AS found`;
  return rows[0]?.found === true;
}

async function userEnumCount(): Promise<number> {
  const rows = await migrator.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total FROM pg_type
    WHERE typname IN ('user_role', 'user_status')`;
  return rows[0]?.total ?? -1;
}

async function migrationIsRecorded(): Promise<boolean> {
  const rows = await migrator.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total FROM "_prisma_migrations"
    WHERE migration_name = ${MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  return rows[0]?.total === 1;
}

describe(`rollback of ${MIGRATION} (test database only)`, () => {
  afterAll(async () => {
    await migrator.$disconnect();
  });

  it('down.sql removes everything, and the migration can be applied again', async () => {
    // 1) Starting point: migration applied
    expect(await usersTableExists()).toBe(true);
    expect(await userEnumCount()).toBe(2);
    expect(await migrationIsRecorded()).toBe(true);

    // 2) Roll back
    runPrisma(`db execute --file prisma/rollbacks/${MIGRATION}.down.sql`);
    expect(await usersTableExists()).toBe(false);
    expect(await userEnumCount()).toBe(0);
    expect(await migrationIsRecorded()).toBe(false);

    // 3) Apply again
    runPrisma('migrate deploy');
    expect(await usersTableExists()).toBe(true);
    expect(await userEnumCount()).toBe(2);
    expect(await migrationIsRecorded()).toBe(true);

    // 4) The application user (alaa_app) can still read the re-created table
    const app = createTestPrisma();
    try {
      expect(await app.user.count()).toBeTypeOf('number');
    } finally {
      await app.$disconnect();
    }
  });
});
