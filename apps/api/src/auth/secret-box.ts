import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Encrypts small secrets (the 2FA secret) before they are stored in the
// database, with AES-256-GCM: a database leak alone does not reveal them.
// The key lives only in .env (TOTP_ENCRYPTION_KEY), never in the database.
//
// Stored format: "v1.<iv>.<tag>.<ciphertext>" (base64url parts). The version
// prefix allows changing the algorithm or the key later.

const VERSION = 'v1';
const IV_BYTES = 12; // recommended size for GCM
const KEY_BYTES = 32; // AES-256

export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error('Encryption key must be 32 bytes, base64 encoded');
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES); // new random IV every time
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  // Throws if the value was changed, or was encrypted with another key.
  decrypt(stored: string): string {
    const [version, iv, tag, ciphertext, extra] = stored.split('.');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined || extra !== undefined) {
      throw new Error('Unsupported encrypted value');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
