// Runs once before the database tests: applies pending migrations to the
// TEST database, as alaa_migrator. It never resets or drops anything.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { assertTestDatabaseUrl } from '../../src/testing/test-database';

export default function setup(): void {
  assertTestDatabaseUrl('TEST_DATABASE_URL', process.env['TEST_DATABASE_URL']);
  const migrateUrl = assertTestDatabaseUrl(
    'TEST_MIGRATE_DATABASE_URL',
    process.env['TEST_MIGRATE_DATABASE_URL'],
  );

  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
  });
}
