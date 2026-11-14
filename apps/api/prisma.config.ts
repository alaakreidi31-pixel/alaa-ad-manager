import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 configuration, used by the prisma command-line tool only
// (migrate, db execute...). The running API does NOT use this file.
//
// The CLI connects as alaa_migrator (owner of the databases, can change
// their structure). The API connects as alaa_app (data only), via
// DATABASE_URL in src/config/env.ts.
//
// process.env is used instead of env() so that "prisma generate"
// also works when MIGRATE_DATABASE_URL is not set (e.g. in CI linting).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['MIGRATE_DATABASE_URL'] ?? '',
  },
});
