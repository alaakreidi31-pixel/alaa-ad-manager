import { HttpException, HttpStatus } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  ClientArchivedError,
  ClientNotFoundError,
  ClientUserNotFoundError,
  ClientValidationError,
  EmailTakenError,
  InvalidClientStatusChangeError,
  InvalidUserStatusChangeError,
} from './clients.errors';
import type { Actor } from './clients.service';

const MAPPING: [abstract new (...args: never[]) => Error, HttpStatus, string][] = [
  [ClientNotFoundError, HttpStatus.NOT_FOUND, 'client_not_found'],
  [ClientUserNotFoundError, HttpStatus.NOT_FOUND, 'user_not_found'],
  [ClientArchivedError, HttpStatus.CONFLICT, 'client_archived'],
  [InvalidClientStatusChangeError, HttpStatus.CONFLICT, 'invalid_status_change'],
  [InvalidUserStatusChangeError, HttpStatus.CONFLICT, 'invalid_status_change'],
  [EmailTakenError, HttpStatus.CONFLICT, 'email_taken'],
];

// Turns expected failures into HTTP answers with a stable "code" for the web app.
export function toHttpError(error: unknown): Error {
  if (error instanceof ClientValidationError) {
    return new HttpException(
      { statusCode: 400, message: error.message, code: 'invalid_input', fields: error.fields },
      HttpStatus.BAD_REQUEST,
    );
  }
  for (const [type, status, code] of MAPPING) {
    if (error instanceof type) {
      return new HttpException({ statusCode: status, message: error.message, code }, status);
    }
  }
  return error instanceof Error ? error : new Error('Unexpected error');
}

// The administrator doing the change, for the audit log.
export function actorOf(req: AuthenticatedRequest): Actor {
  // AccessTokenGuard always sets req.auth before a route runs.
  return { userId: req.auth?.id ?? '', ip: req.ip, userAgent: req.headers['user-agent'] };
}

export async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toHttpError(error);
  }
}
