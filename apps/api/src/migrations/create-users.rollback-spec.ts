import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client';
import { assertTestDatabaseUrl } from '../testing/test-database';
import { createTestPrisma } from '../testing/test-prisma';

// Tests run from apps/api (pnpm --filter @alaa/api ...)
const PRISMA_DIR = join(process.cwd(), 'prisma');

// Every migration folder, oldest first.
const MIGRATIONS = readdirSync(join(PRISMA_DIR, 'migrations'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// Guard first: this test deletes tables, so it only ever runs on a *_test database.
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

async function projectTables(): Promise<string[]> {
  const rows = await migrator.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  return rows.map((row) => row.tablename);
}

async function projectEnumCount(): Promise<number> {
  const rows = await migrator.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'`;
  return rows[0]?.total ?? -1;
}

async function appliedMigrations(): Promise<string[]> {
  const rows = await migrator.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY migration_name`;
  return rows.map((row) => row.migration_name);
}

describe('rollback of every migration (test database only)', () => {
  afterAll(async () => {
    await migrator.$disconnect();
  });

  it('every migration has a rollback file', () => {
    const missing = MIGRATIONS.filter(
      (name) => !existsSync(join(PRISMA_DIR, 'rollbacks', `${name}.down.sql`)),
    );
    expect(missing).toEqual([]);
  });

  it('rolls back every migration (newest first), then applies them all again', async () => {
    // 1) Starting point: everything applied
    expect(await appliedMigrations()).toEqual(MIGRATIONS);
    const tablesBefore = await projectTables();
    expect(tablesBefore.length).toBeGreaterThan(0);

    // 2) Roll back, newest first
    for (const name of [...MIGRATIONS].reverse()) {
      runPrisma(`db execute --file prisma/rollbacks/${name}.down.sql`);
    }
    expect(await projectTables()).toEqual([]);
    expect(await projectEnumCount()).toBe(0);
    expect(await appliedMigrations()).toEqual([]);

    // 3) Apply again
    runPrisma('migrate deploy');
    expect(await appliedMigrations()).toEqual(MIGRATIONS);
    expect(await projectTables()).toEqual(tablesBefore);

    // 4) The application user (alaa_app) can still read the re-created tables
    const app = createTestPrisma();
    try {
      expect(await app.user.count()).toBeTypeOf('number');
      expect(await app.session.count()).toBeTypeOf('number');
      expect(await app.recoveryCode.count()).toBeTypeOf('number');
      expect(await app.auditLog.count()).toBeTypeOf('number');
      expect(await app.client.count()).toBeTypeOf('number');
      expect(await app.campaign.count()).toBeTypeOf('number');
      expect(await app.campaignDailyMetric.count()).toBeTypeOf('number');
      expect(await app.feePlan.count()).toBeTypeOf('number');
      expect(await app.currency.count()).toBe(154);
    } finally {
      await app.$disconnect();
    }
  }, 600_000); // Windows: each "prisma db execute" takes several seconds
});
