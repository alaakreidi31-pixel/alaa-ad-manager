import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { assertTestDatabaseUrl } from './test-database';

// Prisma client for database tests. It connects as alaa_app (the same
// limited user as the running API) to the test database only.
export function createTestPrisma(): PrismaClient {
  const url = assertTestDatabaseUrl('TEST_DATABASE_URL', process.env['TEST_DATABASE_URL']);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
