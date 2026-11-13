import { parseEnv, type Env } from './env.schema';

export type { Env };

// Validated once at startup: if anything is missing or wrong, the API refuses
// to start with a clear message instead of running in a broken state.
export const env: Env = parseEnv(process.env);
