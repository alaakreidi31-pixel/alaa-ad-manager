import { HttpException, HttpStatus } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  CampaignArchivedError,
  CampaignNotFoundError,
  CampaignValidationError,
  CurrencyLockedError,
  ExternalIdTakenError,
  FutureDayError,
  ImportHasErrorsError,
  InvalidCampaignStatusChangeError,
} from '../campaigns/campaigns.errors';
import {
  ClientArchivedError,
  ClientNotFoundError,
  ClientUserNotFoundError,
  ClientValidationError,
  EmailTakenError,
  InvalidClientStatusChangeError,
  InvalidUserStatusChangeError,
} from './clients.errors';
import {
  FeePlanCannotCancelError,
  FeePlanNotFoundError,
  FeePlanOverlapError,
  FeePlanStartsTooEarlyError,
  FeePlanValidationError,
} from '../fees/fee-plans.errors';
import {
  InvoiceHasPaymentsError,
  InvoiceNotFoundError,
  InvoiceStateError,
  InvoiceValidationError,
  PaymentExceedsTotalError,
  PaymentNotFoundError,
} from '../invoices/invoices.errors';
import type { Actor } from './clients.service';

const MAPPING: [abstract new (...args: never[]) => Error, HttpStatus, string][] = [
  [ClientNotFoundError, HttpStatus.NOT_FOUND, 'client_not_found'],
  [ClientUserNotFoundError, HttpStatus.NOT_FOUND, 'user_not_found'],
  [ClientArchivedError, HttpStatus.CONFLICT, 'client_archived'],
  [InvalidClientStatusChangeError, HttpStatus.CONFLICT, 'invalid_status_change'],
  [InvalidUserStatusChangeError, HttpStatus.CONFLICT, 'invalid_status_change'],
  [EmailTakenError, HttpStatus.CONFLICT, 'email_taken'],
  [CampaignNotFoundError, HttpStatus.NOT_FOUND, 'campaign_not_found'],
  [CampaignArchivedError, HttpStatus.CONFLICT, 'campaign_archived'],
  [InvalidCampaignStatusChangeError, HttpStatus.CONFLICT, 'invalid_status_change'],
  [ExternalIdTakenError, HttpStatus.CONFLICT, 'external_id_taken'],
  [CurrencyLockedError, HttpStatus.CONFLICT, 'currency_locked'],
  [FutureDayError, HttpStatus.BAD_REQUEST, 'future_day'],
  [ImportHasErrorsError, HttpStatus.CONFLICT, 'import_has_errors'],
  [FeePlanNotFoundError, HttpStatus.NOT_FOUND, 'fee_plan_not_found'],
  [FeePlanOverlapError, HttpStatus.CONFLICT, 'fee_plan_overlap'],
  [FeePlanStartsTooEarlyError, HttpStatus.CONFLICT, 'fee_plan_starts_too_early'],
  [FeePlanCannotCancelError, HttpStatus.CONFLICT, 'fee_plan_cannot_cancel'],
  [InvoiceNotFoundError, HttpStatus.NOT_FOUND, 'invoice_not_found'],
  [PaymentNotFoundError, HttpStatus.NOT_FOUND, 'payment_not_found'],
  [InvoiceStateError, HttpStatus.CONFLICT, 'invoice_state'],
  [InvoiceHasPaymentsError, HttpStatus.CONFLICT, 'invoice_has_payments'],
  [PaymentExceedsTotalError, HttpStatus.CONFLICT, 'payment_exceeds_total'],
];

// Turns expected failures into HTTP answers with a stable "code" for the web app.
export function toHttpError(error: unknown): Error {
  if (
    error instanceof ClientValidationError ||
    error instanceof CampaignValidationError ||
    error instanceof FeePlanValidationError ||
    error instanceof InvoiceValidationError
  ) {
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
