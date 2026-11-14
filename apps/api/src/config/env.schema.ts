import { z } from 'zod';

// Every setting the API needs, with its rules.
// Kept separate from env.ts (which reads process.env) so it can be tested.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string({ message: 'is required (see apps/api/.env.example)' })
    .regex(/^postgres(ql)?:\/\//, 'must start with postgresql://'),
  // Signs the access tokens (JWT). Random, at least 32 characters, never shared.
  JWT_ACCESS_SECRET: z
    .string({ message: 'is required (see docs/development.md)' })
    .min(32, { message: 'must be at least 32 characters (see docs/development.md)' }),
});

export type Env = z.infer<typeof EnvSchema>;

// Returns the validated settings, or throws one clear error listing every problem.
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration in apps/api/.env:\n${problems}`);
  }
  return result.data;
}
