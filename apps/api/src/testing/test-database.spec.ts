import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from './test-database';

const SECRET = 'super-secret-password';

describe('assertTestDatabaseUrl (database tests safety guard)', () => {
  it('accepts a database whose name ends with _test', () => {
    const url = `postgresql://user:${SECRET}@localhost:5432/alaa_ad_manager_test`;
    expect(assertTestDatabaseUrl('TEST_DATABASE_URL', url)).toBe(url);
  });

  it('refuses the development database', () => {
    const url = `postgresql://user:${SECRET}@localhost:5432/alaa_ad_manager_dev`;
    expect(() => assertTestDatabaseUrl('TEST_DATABASE_URL', url)).toThrow(/Refusing/);
  });

  it('never shows the password in the error message', () => {
    const url = `postgresql://user:${SECRET}@localhost:5432/alaa_ad_manager_dev`;
    let message = '';
    try {
      assertTestDatabaseUrl('TEST_DATABASE_URL', url);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('alaa_ad_manager_dev');
    expect(message).not.toContain(SECRET);
  });

  it('refuses a missing value', () => {
    expect(() => assertTestDatabaseUrl('TEST_DATABASE_URL', undefined)).toThrow(/is not set/);
  });

  it('refuses a value that is not a URL', () => {
    expect(() => assertTestDatabaseUrl('TEST_DATABASE_URL', 'not a url')).toThrow(
      /not a valid database URL/,
    );
  });
});
