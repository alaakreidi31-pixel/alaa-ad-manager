import type { z } from 'zod';

// Expected fee plan failures; the controller turns them into HTTP answers.

export class FeePlanValidationError extends Error {
  readonly fields: { field: string; message: string }[];

  constructor(error: z.ZodError | { field: string; message: string }) {
    super('Invalid fee plan data');
    this.fields =
      'issues' in error
        ? error.issues.map((issue) => ({
            field: issue.path.join('.') || '(body)',
            message: issue.message,
          }))
        : [error];
  }
}

export class FeePlanNotFoundError extends Error {
  constructor() {
    super('Fee plan not found for this client');
  }
}

// Two active plans of one client would cover the same month.
export class FeePlanOverlapError extends Error {
  constructor() {
    super('This client already has a fee plan for these months');
  }
}

// A change made during a month applies from the NEXT month (ADR 0019); and
// only the first plan of a client may start in a past month.
export class FeePlanStartsTooEarlyError extends Error {
  constructor() {
    super('A new fee plan must start next month at the earliest');
  }
}

// Only a plan that has not started yet can be cancelled, once.
export class FeePlanCannotCancelError extends Error {
  constructor() {
    super('Only a fee plan that has not started can be cancelled');
  }
}
