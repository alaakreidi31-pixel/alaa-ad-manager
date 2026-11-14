import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  AccountLockedError,
  AccountSuspendedError,
  ClientInactiveError,
  InvalidCredentialsError,
  InvalidPasswordChangeError,
  PasswordReusedError,
  WeakPasswordError,
  InvalidLoginChallengeError,
  InvalidTwoFactorCodeError,
  RefreshTokenReuseError,
  TwoFactorSetupRequiredError,
} from './auth.errors';
import { toHttpError } from './auth.http-errors';

function answer(error: Error) {
  const http = toHttpError(error);
  expect(http).toBeInstanceOf(HttpException);
  return {
    status: (http as HttpException).getStatus(),
    body: (http as HttpException).getResponse(),
  };
}

describe('toHttpError (auth errors to HTTP answers)', () => {
  it.each([
    [new InvalidCredentialsError(), 401, 'invalid_credentials'],
    [new RefreshTokenReuseError(), 401, 'invalid_session'],
    [new InvalidLoginChallengeError(), 401, 'login_step_expired'],
    [new InvalidTwoFactorCodeError(), 401, 'invalid_code'],
    [new AccountLockedError(), 429, 'account_locked'],
    [new AccountSuspendedError(), 403, 'account_suspended'],
    [new TwoFactorSetupRequiredError(), 403, 'two_factor_setup_required'],
    [new ClientInactiveError(), 403, 'client_inactive'],
    [new InvalidPasswordChangeError(), 401, 'password_change_expired'],
    [new WeakPasswordError('is too short'), 400, 'weak_password'],
    [new PasswordReusedError(), 400, 'password_reused'],
  ])('%s -> HTTP %i with code "%s"', (error, status, code) => {
    const result = answer(error);
    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ statusCode: status, code, message: error.message });
  });

  it('passes any other error on unchanged', () => {
    const other = new Error('boom');
    expect(toHttpError(other)).toBe(other);
  });
});
