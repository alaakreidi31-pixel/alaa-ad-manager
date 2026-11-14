import type { PrismaClient } from '../generated/prisma/client';
import { InvalidTwoFactorCodeError } from './auth.errors';
import { generateRecoveryCodes, hashRecoveryCode } from './recovery-codes';
import type { SecretBox } from './secret-box';
import { findTotpTimeStep } from './totp';

// Turns on two-factor authentication for one user, after checking that the
// authenticator app produces a correct code for the new secret.
// Replaces any previous secret and recovery codes, and closes every open
// session (a re-setup usually means the old phone is lost).
// Returns the new recovery codes: the ONLY time they exist in plain text.
export async function enableTwoFactor(
  prisma: PrismaClient,
  box: SecretBox,
  userId: string,
  secretBase32: string,
  code: string,
  now: Date = new Date(),
): Promise<string[]> {
  const step = findTotpTimeStep(secretBase32, code.replace(/\s/g, ''), now.getTime());
  if (step === null) throw new InvalidTwoFactorCodeError();

  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpSecretEncrypted: box.encrypt(secretBase32),
        totpEnabledAt: now,
        // The setup code cannot be reused to log in.
        totpLastUsedStep: step,
      },
    });
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: recoveryCodes.map((value) => ({ userId, codeHash: hashRecoveryCode(value) })),
    });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  });
  return recoveryCodes;
}
