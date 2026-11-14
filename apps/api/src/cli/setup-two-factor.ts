// Administrative command: turns on two-factor authentication (ADR 0013).
// Run from the project root:  pnpm admin:setup-2fa
// Required for the SUPER_ADMIN before any login. Running it again replaces
// the authenticator link and the recovery codes (for example, a new phone).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { stdout } from 'node:process';
import { toString as renderQrCode } from 'qrcode';
import { TOTP_ISSUER } from '../auth/auth.constants';
import { InvalidTwoFactorCodeError } from '../auth/auth.errors';
import { verifyPassword } from '../auth/password';
import { SecretBox } from '../auth/secret-box';
import { buildOtpAuthUri, generateTotpSecret } from '../auth/totp';
import { enableTwoFactor } from '../auth/two-factor';
import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { normalizeEmail } from '../users/email';
import { ask, createPrompt, databaseName } from './prompt';

const MAX_CODE_ATTEMPTS = 3;

// Expected, user-facing failures (shown as-is).
class SetupError extends Error {}

async function main(): Promise<void> {
  const rl = createPrompt();
  const box = new SecretBox(env.TOTP_ENCRYPTION_KEY);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    stdout.write('\nALAA AD MANAGER - two-factor authentication setup\n');
    stdout.write(`Database: ${databaseName(env.DATABASE_URL)}\n\n`);

    // The account password is required, like a login.
    const email = normalizeEmail(await ask(rl, 'Email: '));
    const password = await ask(rl, 'Password (hidden): ', true);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new SetupError('Email or password is incorrect.');
    }
    if (user.status !== 'ACTIVE') throw new SetupError('This account is suspended.');

    if (user.totpEnabledAt) {
      const answer = await ask(
        rl,
        '2FA is already enabled. Set it up again? The old app link, the recovery codes ' +
          'and every open session will stop working. Type "yes" to continue: ',
      );
      if (answer.trim().toLowerCase() !== 'yes') throw new SetupError('Cancelled.');
    }

    const secret = generateTotpSecret();
    const qr = await renderQrCode(buildOtpAuthUri(TOTP_ISSUER, user.email, secret), {
      type: 'terminal',
      small: true,
    });
    stdout.write('\n1) Open Google Authenticator, tap +, then "Scan a QR code":\n\n');
    stdout.write(qr);
    stdout.write('\n   Cannot scan? Choose "Enter a setup key" and type:\n');
    stdout.write(`   Account: ${user.email}\n`);
    stdout.write(`   Key:     ${secret.replace(/(.{4})/g, '$1 ').trim()}\n`);
    stdout.write('   Type of key: Time based\n\n');

    let recoveryCodes: string[] | undefined;
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS && !recoveryCodes; attempt += 1) {
      const code = await ask(rl, '2) Type the 6-digit code shown in the app: ');
      try {
        recoveryCodes = await enableTwoFactor(prisma, box, user.id, secret, code);
      } catch (error) {
        if (!(error instanceof InvalidTwoFactorCodeError)) throw error;
        stdout.write('   Wrong code. Check the phone time is automatic, then try again.\n');
      }
    }
    if (!recoveryCodes) throw new SetupError('Too many wrong codes. Nothing was changed.');

    stdout.write('\n2FA is now ENABLED for ' + user.email + '\n\n');
    stdout.write('3) RECOVERY CODES - shown only this once. Save them somewhere safe\n');
    stdout.write('   (password manager or printed paper). Each one works only once,\n');
    stdout.write('   if the phone is lost:\n\n');
    for (const code of recoveryCodes) stdout.write(`   ${code}\n`);
    stdout.write('\n');
  } catch (error) {
    const message =
      error instanceof SetupError
        ? error.message
        : 'Unexpected error. Check that the database is running.';
    stdout.write(`\nNot enabled: ${message}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

void main();
