import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AccountLockedError,
  AccountSuspendedError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidSessionError,
  ClientInactiveError,
  InvalidPasswordChangeError,
  InvalidTwoFactorCodeError,
  PasswordReusedError,
  TwoFactorSetupRequiredError,
  WeakPasswordError,
} from './auth.errors';

// Stable codes for the web app: it shows a translated message per code
// (Arabic / English) instead of the English text of "message".
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'invalid_session'
  | 'login_step_expired'
  | 'invalid_code'
  | 'account_locked'
  | 'account_suspended'
  | 'two_factor_setup_required'
  | 'client_inactive'
  | 'password_change_expired'
  | 'weak_password'
  | 'password_reused';

const MAPPING: [abstract new (...args: never[]) => Error, HttpStatus, AuthErrorCode][] = [
  [InvalidCredentialsError, HttpStatus.UNAUTHORIZED, 'invalid_credentials'],
  [InvalidSessionError, HttpStatus.UNAUTHORIZED, 'invalid_session'],
  [InvalidLoginChallengeError, HttpStatus.UNAUTHORIZED, 'login_step_expired'],
  [InvalidTwoFactorCodeError, HttpStatus.UNAUTHORIZED, 'invalid_code'],
  [AccountLockedError, HttpStatus.TOO_MANY_REQUESTS, 'account_locked'],
  [AccountSuspendedError, HttpStatus.FORBIDDEN, 'account_suspended'],
  [TwoFactorSetupRequiredError, HttpStatus.FORBIDDEN, 'two_factor_setup_required'],
  [ClientInactiveError, HttpStatus.FORBIDDEN, 'client_inactive'],
  [InvalidPasswordChangeError, HttpStatus.UNAUTHORIZED, 'password_change_expired'],
  [WeakPasswordError, HttpStatus.BAD_REQUEST, 'weak_password'],
  [PasswordReusedError, HttpStatus.BAD_REQUEST, 'password_reused'],
];

// Converts expected auth failures into HTTP answers:
// { statusCode, message, code }. Anything else is passed on unchanged.
export function toHttpError(error: unknown): Error {
  for (const [type, status, code] of MAPPING) {
    if (error instanceof type) {
      return new HttpException({ statusCode: status, message: error.message, code }, status);
    }
  }
  return error instanceof Error ? error : new Error('Unexpected error');
}
