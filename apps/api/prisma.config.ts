import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 configuration (used by the prisma command-line tool).
// process.env is used instead of env() so that "prisma generate"
// also works before .env exists; the API itself validates DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
