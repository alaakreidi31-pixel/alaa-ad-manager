import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AccountLockedError,
  AccountSuspendedError,
  InvalidCredentialsError,
  InvalidLoginChallengeError,
  InvalidSessionError,
  InvalidTwoFactorCodeError,
  TwoFactorSetupRequiredError,
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
  | 'two_factor_setup_required';

const MAPPING: [new () => Error, HttpStatus, AuthErrorCode][] = [
  [InvalidCredentialsError, HttpStatus.UNAUTHORIZED, 'invalid_credentials'],
  [InvalidSessionError, HttpStatus.UNAUTHORIZED, 'invalid_session'],
  [InvalidLoginChallengeError, HttpStatus.UNAUTHORIZED, 'login_step_expired'],
  [InvalidTwoFactorCodeError, HttpStatus.UNAUTHORIZED, 'invalid_code'],
  [AccountLockedError, HttpStatus.TOO_MANY_REQUESTS, 'account_locked'],
  [AccountSuspendedError, HttpStatus.FORBIDDEN, 'account_suspended'],
  [TwoFactorSetupRequiredError, HttpStatus.FORBIDDEN, 'two_factor_setup_required'],
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
