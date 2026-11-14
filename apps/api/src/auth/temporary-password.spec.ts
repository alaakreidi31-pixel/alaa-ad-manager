import { describe, expect, it } from 'vitest';
import { PasswordSchema } from './password';
import { generateTemporaryPassword } from './temporary-password';

describe('temporary passwords', () => {
  it('have the xxxxx-xxxxx-xxxxx-xxxxx format, without confusing characters', () => {
    const password = generateTemporaryPassword();
    expect(password).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);
    expect(password).not.toMatch(/[0O1Il]/);
  });

  it('follow the password policy', () => {
    expect(PasswordSchema.safeParse(generateTemporaryPassword()).success).toBe(true);
  });

  it('are different every time', () => {
    const passwords = new Set(Array.from({ length: 100 }, generateTemporaryPassword));
    expect(passwords.size).toBe(100);
  });
});
