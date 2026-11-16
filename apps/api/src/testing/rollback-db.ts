import type { PrismaClient } from '../generated/prisma/client';

class RollBack extends Error {}

// Runs a test inside ONE database transaction that is rolled back at the
// end, so it leaves nothing behind. Needed for tables the application user
// can never delete from (tasks, comments...), whose rows would otherwise
// block the tests that empty the users table.
//
// The services receive a client whose $transaction() becomes a SAVEPOINT:
// a refused statement rolls back to it and the test can go on, exactly like
// a failed transaction of the real API.
export async function inRollback(
  prisma: PrismaClient,
  test: (db: PrismaClient) => Promise<void>,
): Promise<void> {
  let savepoints = 0;
  await prisma
    .$transaction(
      async (tx) => {
        const db: PrismaClient = new Proxy(tx as unknown as PrismaClient, {
          get(target, key, receiver) {
            if (key !== '$transaction') {
              const value: unknown = Reflect.get(target, key, receiver);
              // $queryRaw, $executeRaw...: called on the real transaction client.
              return typeof value === 'function'
                ? (value as (...args: unknown[]) => unknown).bind(target)
                : value;
            }
            return async (work: unknown) => {
              if (Array.isArray(work)) {
                const results: unknown[] = [];
                for (const query of work) results.push(await (query as Promise<unknown>));
                return results;
              }
              const name = `test_savepoint_${++savepoints}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await (work as (client: PrismaClient) => Promise<unknown>)(db);
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
          },
        });
        await test(db);
        throw new RollBack();
      },
      { timeout: 120_000, maxWait: 30_000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) throw error;
    });
}
