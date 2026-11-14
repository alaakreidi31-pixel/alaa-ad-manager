// Administrative command: creates the SUPER_ADMIN (owner) account.
// Run from the project root:  pnpm admin:create-super-admin
// There is no public registration (ADR 0010): this is the only way.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { stdin, stdout } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { createSuperAdmin, SuperAdminError } from '../users/create-super-admin';

// Terminal output that can be muted, so passwords are not echoed while typed.
let muted = false;
const output = new Writable({
  write(chunk: string | Uint8Array, encoding: BufferEncoding, callback: () => void) {
    if (!muted) stdout.write(chunk, encoding);
    callback();
  },
});

async function ask(rl: Interface, question: string, hidden = false): Promise<string> {
  muted = false;
  const answer = rl.question(question); // the question is printed immediately
  muted = hidden;
  try {
    return await answer;
  } finally {
    muted = false;
    if (hidden) stdout.write('\n');
  }
}

// Shows which database will be written to, without the password.
function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output, terminal: true });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    stdout.write('\nALAA AD MANAGER - create the SUPER_ADMIN account\n');
    stdout.write(`Database: ${databaseName(env.DATABASE_URL)}\n\n`);

    const email = await ask(rl, 'Email: ');
    const fullName = await ask(rl, 'Full name: ');
    const password = await ask(rl, 'Password (12+ characters, hidden): ', true);
    const confirmation = await ask(rl, 'Repeat password: ', true);
    if (password !== confirmation) {
      throw new SuperAdminError('Passwords do not match. Nothing was created.');
    }

    const created = await createSuperAdmin(prisma, { email, fullName, password });
    stdout.write(`\nSUPER_ADMIN created: ${created.email}\n`);
  } catch (error) {
    const message =
      error instanceof SuperAdminError
        ? error.message
        : 'Unexpected error. Check that the database is running.';
    stdout.write(`\nNot created: ${message}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

void main();
