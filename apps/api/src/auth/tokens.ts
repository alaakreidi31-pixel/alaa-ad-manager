import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes = 256 bits: cannot be guessed.
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// Only this hash is stored. A fast hash (SHA-256) is correct here because the
// token is already random and long; argon2 is for human passwords.
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Reads one cookie from the raw "Cookie" request header.
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// Reads the token from an "Authorization: Bearer <token>" header.
export function readBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : undefined;
}
