import { z } from 'zod';

// Every setting the API needs, with its rules.
// If anything is missing or wrong, the API refuses to start
// with a clear message instead of running in a broken state.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string({ message: 'is required (see apps/api/.env.example)' })
    .regex(/^postgres(ql)?:\/\//, 'must start with postgresql://'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration in apps/api/.env:\n${problems}`);
  }
  return result.data;
}

export const env: Env = loadEnv();
