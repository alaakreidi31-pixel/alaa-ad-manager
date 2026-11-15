// The 63 database checks of the fee plans, reviewed with the project owner
// (fee-plans.database-checks.sql). They run as alaa_app, like the API, in
// ONE transaction that is rolled back: nothing is left in the test database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../testing/test-prisma';

const prisma = createTestPrisma();
const CHECKS = readFileSync(
  // Tests run from apps/api (pnpm --filter @alaa/api ...)
  join(process.cwd(), 'src', 'fees', 'fee-plans.database-checks.sql'),
  'utf8',
)
  .split(/^-- @@\r?$/m)
  .map((statement) => statement.trim())
  .filter((statement) => statement.replace(/^--.*$/gm, '').trim() !== '');

class RollBack extends Error {}

describe('fee plans: rules enforced by PostgreSQL itself', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('passes the 63 reviewed checks (overlap, history, rounding, limits, privileges)', async () => {
    let results: { n: number; label: string; ok: boolean; detail: string }[] = [];
    await prisma
      .$transaction(
        async (tx) => {
          // "Today" is UTC in the triggers whatever the session time zone.
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
          for (const statement of CHECKS) await tx.$executeRawUnsafe(statement);
          results = await tx.$queryRawUnsafe('SELECT n, label, ok, detail FROM results ORDER BY n');
          throw new RollBack();
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof RollBack)) throw error;
      });

    const failed = results.filter((row) => !row.ok).map((row) => `${row.label}: ${row.detail}`);
    expect(failed).toEqual([]);
    expect(results).toHaveLength(63);
  });
});
