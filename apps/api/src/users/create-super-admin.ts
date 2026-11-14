import { z } from 'zod';
import { hashPassword, PasswordSchema } from '../auth/password';
import type { PrismaClient } from '../generated/prisma/client';
import { normalizeEmail } from './email';

// Expected, user-facing failures (shown as-is by the command line tool).
export class SuperAdminError extends Error {}

const InputSchema = z.object({
  email: z
    .string()
    .transform(normalizeEmail)
    .pipe(z.email({ message: 'is not a valid email address' })),
  fullName: z
    .string()
    .trim()
    .min(2, { message: 'must be at least 2 characters' })
    .max(100, { message: 'must be at most 100 characters' }),
  password: PasswordSchema,
});

export type CreateSuperAdminInput = z.input<typeof InputSchema>;

export interface CreatedSuperAdmin {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

// Creates THE owner account. There is no public registration (ADR 0010):
// this function is only called by the create-super-admin command line tool.
export async function createSuperAdmin(
  prisma: PrismaClient,
  input: CreateSuperAdminInput,
): Promise<CreatedSuperAdmin> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');
    throw new SuperAdminError(`Invalid input: ${problems}`);
  }

  const { email, fullName, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.count({ where: { role: 'SUPER_ADMIN' } });
      if (existing > 0) {
        throw new SuperAdminError('A SUPER_ADMIN account already exists. Nothing was created.');
      }

      return tx.user.create({
        data: { email, fullName, passwordHash, role: 'SUPER_ADMIN' },
        // Never return the password hash
        select: { id: true, email: true, fullName: true, createdAt: true },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SuperAdminError('An account with this email already exists. Nothing was created.');
    }
    throw error;
  }
}
