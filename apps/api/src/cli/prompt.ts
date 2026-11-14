// Terminal questions for the administrative commands.
import { stdin, stdout } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';

// Terminal output that can be muted, so passwords are not echoed while typed.
let muted = false;
const output = new Writable({
  write(chunk: string | Uint8Array, encoding: BufferEncoding, callback: () => void) {
    if (!muted) stdout.write(chunk, encoding);
    callback();
  },
});

export function createPrompt(): Interface {
  return createInterface({ input: stdin, output, terminal: true });
}

export async function ask(rl: Interface, question: string, hidden = false): Promise<string> {
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
export function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}
